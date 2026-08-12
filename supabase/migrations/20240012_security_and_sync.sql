-- ============================================================
-- Migration: 20240012_security_and_sync.sql
-- Project: THE SUSPECT
-- Features:
--   1. case_secrets table (server-side secret/undercover words)
--   2. get_my_secret_word RPC (role-based, never leaks the other word)
--   3. submit_final_escape_guess RPC (server-side comparison)
--   4. rooms table: add case_id, phase_started_at columns
--   5. suspicion_scores table (shared suspicion state)
--   6. update start_game to persist case_id
-- ============================================================

-- ------------------------------------------------------------
-- 1. case_secrets table
--    Stores secret_word and undercover_word server-side only.
--    No client ever reads both columns at once.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.case_secrets (
  case_id        TEXT PRIMARY KEY,
  secret_word    TEXT NOT NULL,
  undercover_word TEXT NOT NULL
);

-- RLS: no direct client access — only via SECURITY DEFINER RPCs
ALTER TABLE public.case_secrets ENABLE ROW LEVEL SECURITY;

-- No SELECT policy for authenticated users — access only through RPCs
-- (SECURITY DEFINER functions bypass RLS)

-- Seed the case secrets (matches cases.js case ids)
INSERT INTO public.case_secrets (case_id, secret_word, undercover_word) VALUES
  ('case-coffee',    'القهوة',                  'الشاي'),
  ('case-phone',     'الموبايل',                'التلفزيون'),
  ('case-microbus',  'المواصلات العامة',         'أوبر والتاكسي'),
  ('case-summer',    'الساحل والصيف',            'رأس البر والجمصة'),
  ('case-koshary',   'الكشري',                  'الفتة والمحشي'),
  ('case-derby',     'مباراة القمة والديربي',    'مباراة المنتخب والدوري')
ON CONFLICT (case_id) DO UPDATE SET
  secret_word     = EXCLUDED.secret_word,
  undercover_word = EXCLUDED.undercover_word;

-- ------------------------------------------------------------
-- 2. Add case_id and phase_started_at to rooms table
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rooms' AND column_name = 'case_id'
  ) THEN
    ALTER TABLE public.rooms ADD COLUMN case_id TEXT DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rooms' AND column_name = 'phase_started_at'
  ) THEN
    ALTER TABLE public.rooms ADD COLUMN phase_started_at TIMESTAMPTZ DEFAULT NULL;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3. suspicion_scores table (shared suspicion state)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.suspicion_scores (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id      UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  round_number INT NOT NULL DEFAULT 1,
  target_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  score        INT NOT NULL DEFAULT 50,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT suspicion_scores_room_round_target_key UNIQUE (room_id, round_number, target_id)
);

ALTER TABLE public.suspicion_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players in room can view suspicion scores"
  ON public.suspicion_scores FOR SELECT
  TO authenticated
  USING (
    room_id IN (
      SELECT room_id FROM public.room_players WHERE user_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- 4. Update start_game RPC to assign a random case_id
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_game(p_room_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id      UUID;
  v_host_id      UUID;
  v_status       TEXT;
  v_suspect_id   UUID;
  v_player_count INT;
  v_case_id      TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT host_id, status INTO v_host_id, v_status
  FROM public.rooms WHERE id = p_room_id FOR UPDATE;

  IF v_host_id IS NULL THEN RAISE EXCEPTION 'Room not found'; END IF;
  IF v_host_id != v_user_id THEN RAISE EXCEPTION 'Only the host can start the game'; END IF;
  IF v_status != 'waiting' THEN RAISE EXCEPTION 'Room is not in waiting status'; END IF;

  SELECT COUNT(*) INTO v_player_count
  FROM public.room_players WHERE room_id = p_room_id AND is_connected = TRUE;

  IF v_player_count < 1 THEN RAISE EXCEPTION 'No connected players in room'; END IF;

  -- Assign roles
  UPDATE public.room_players SET role = 'detective'
  WHERE room_id = p_room_id AND is_connected = TRUE;

  SELECT id INTO v_suspect_id
  FROM public.room_players
  WHERE room_id = p_room_id AND is_connected = TRUE
  ORDER BY random() LIMIT 1;

  IF v_suspect_id IS NOT NULL THEN
    UPDATE public.room_players SET role = 'suspect' WHERE id = v_suspect_id;
  END IF;

  -- Pick a random case
  SELECT case_id INTO v_case_id FROM public.case_secrets ORDER BY random() LIMIT 1;

  -- Update room
  UPDATE public.rooms
  SET status = 'starting', case_id = v_case_id, phase_started_at = NOW(), updated_at = NOW()
  WHERE id = p_room_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_game(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 5. get_my_secret_word RPC
--    Returns ONLY the word the calling player should see.
--    Detective → secret_word
--    Suspect   → undercover_word
--    Never returns both.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_secret_word(p_room_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_role    TEXT;
  v_case_id TEXT;
  v_word    TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT role INTO v_role
  FROM public.room_players
  WHERE room_id = p_room_id AND user_id = v_user_id;

  IF v_role IS NULL THEN RAISE EXCEPTION 'Player not in room'; END IF;

  SELECT case_id INTO v_case_id FROM public.rooms WHERE id = p_room_id;
  IF v_case_id IS NULL THEN RETURN NULL; END IF;

  IF v_role = 'suspect' THEN
    SELECT undercover_word INTO v_word FROM public.case_secrets WHERE case_id = v_case_id;
  ELSE
    SELECT secret_word INTO v_word FROM public.case_secrets WHERE case_id = v_case_id;
  END IF;

  RETURN v_word;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_secret_word(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 6. submit_final_escape_guess RPC
--    Server-side comparison — never returns secret_word to client.
--    Prevents: double submission, non-suspect calling, wrong phase.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.escape_attempts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id      UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  round_number INT NOT NULL DEFAULT 1,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_correct   BOOLEAN NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT escape_attempts_room_round_user_key UNIQUE (room_id, round_number, user_id)
);

ALTER TABLE public.escape_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players in room can view escape attempts"
  ON public.escape_attempts FOR SELECT
  TO authenticated
  USING (
    room_id IN (
      SELECT room_id FROM public.room_players WHERE user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.submit_final_escape_guess(
  p_room_id UUID,
  p_guess   TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id      UUID;
  v_role         TEXT;
  v_room_status  TEXT;
  v_current_round INT;
  v_case_id      TEXT;
  v_secret_word  TEXT;
  v_is_correct   BOOLEAN;
  v_already_tried BOOLEAN := FALSE;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Must be the suspect
  SELECT role INTO v_role
  FROM public.room_players WHERE room_id = p_room_id AND user_id = v_user_id;

  IF v_role != 'suspect' THEN
    RAISE EXCEPTION 'Only the suspect can attempt a final escape';
  END IF;

  -- Must be in investigation or undercover phase
  SELECT status, COALESCE(current_round, 1), case_id
  INTO v_room_status, v_current_round, v_case_id
  FROM public.rooms WHERE id = p_room_id;

  IF v_room_status NOT IN ('investigation', 'in_game') THEN
    RAISE EXCEPTION 'Final escape is not available in this phase';
  END IF;

  -- Prevent double attempt
  SELECT EXISTS(
    SELECT 1 FROM public.escape_attempts
    WHERE room_id = p_room_id AND round_number = v_current_round AND user_id = v_user_id
  ) INTO v_already_tried;

  IF v_already_tried THEN
    RAISE EXCEPTION 'You have already used your final escape attempt this round';
  END IF;

  -- Server-side comparison — secret_word never leaves the server
  SELECT secret_word INTO v_secret_word
  FROM public.case_secrets WHERE case_id = v_case_id;

  v_is_correct := (TRIM(LOWER(p_guess)) = TRIM(LOWER(v_secret_word)));

  -- Record the attempt
  INSERT INTO public.escape_attempts (room_id, round_number, user_id, is_correct)
  VALUES (p_room_id, v_current_round, v_user_id, v_is_correct);

  -- Return result WITHOUT the secret_word
  RETURN jsonb_build_object(
    'is_correct', v_is_correct,
    'round_number', v_current_round
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_final_escape_guess(UUID, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 7. update_suspicion_score RPC
--    Validates delta (+10 or -10 only), clamps 0-100.
--    Prevents arbitrary client values.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_suspicion_score(
  p_room_id   UUID,
  p_target_id UUID,
  p_delta     INT  -- must be +10 or -10
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id      UUID;
  v_current_round INT;
  v_current_score INT;
  v_new_score    INT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Validate delta
  IF p_delta NOT IN (10, -10) THEN
    RAISE EXCEPTION 'Invalid delta: only +10 or -10 allowed';
  END IF;

  -- Cannot adjust own score
  IF v_user_id = p_target_id THEN
    RAISE EXCEPTION 'Cannot adjust your own suspicion score';
  END IF;

  -- Must be in room
  IF NOT EXISTS (
    SELECT 1 FROM public.room_players WHERE room_id = p_room_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Player not in room';
  END IF;

  SELECT COALESCE(current_round, 1) INTO v_current_round FROM public.rooms WHERE id = p_room_id;

  -- Get current score (default 50)
  SELECT COALESCE(score, 50) INTO v_current_score
  FROM public.suspicion_scores
  WHERE room_id = p_room_id AND round_number = v_current_round AND target_id = p_target_id;

  v_new_score := GREATEST(0, LEAST(100, COALESCE(v_current_score, 50) + p_delta));

  INSERT INTO public.suspicion_scores (room_id, round_number, target_id, score, updated_at)
  VALUES (p_room_id, v_current_round, p_target_id, v_new_score, NOW())
  ON CONFLICT (room_id, round_number, target_id)
  DO UPDATE SET score = v_new_score, updated_at = NOW();

  RETURN jsonb_build_object(
    'target_id', p_target_id,
    'score', v_new_score
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_suspicion_score(UUID, UUID, INT) TO authenticated;

-- ------------------------------------------------------------
-- 8. get_room_suspicion_scores RPC
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_room_suspicion_scores(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_round INT;
  v_scores JSONB;
BEGIN
  SELECT COALESCE(current_round, 1) INTO v_current_round FROM public.rooms WHERE id = p_room_id;

  SELECT COALESCE(jsonb_object_agg(target_id::TEXT, score), '{}'::jsonb)
  INTO v_scores
  FROM public.suspicion_scores
  WHERE room_id = p_room_id AND round_number = v_current_round;

  RETURN v_scores;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_room_suspicion_scores(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 9. set_phase_timer RPC (host only)
--    Sets phase_started_at to NOW() — clients calculate remaining time
--    from this single source of truth.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_phase_timer(p_room_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_host_id UUID;
  v_now     TIMESTAMPTZ;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT host_id INTO v_host_id FROM public.rooms WHERE id = p_room_id;
  IF v_host_id != v_user_id THEN RAISE EXCEPTION 'Only host can set phase timer'; END IF;

  v_now := NOW();
  UPDATE public.rooms SET phase_started_at = v_now, updated_at = v_now WHERE id = p_room_id;

  RETURN v_now;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_phase_timer(UUID) TO authenticated;
