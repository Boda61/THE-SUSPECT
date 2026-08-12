-- ============================================================
-- Migration: 20240013_puzzle_security_fix.sql
-- Project: THE SUSPECT
-- Fixes:
--   1. Add puzzle_answers JSONB column to case_secrets
--      (stores puzzle_id → answer mapping, never sent to client)
--   2. Replace solve_clue_puzzle RPC with server-side answer validation
--   3. Replace search_location RPC — server resolves clue_ids from case data
--      instead of trusting client-supplied p_unlocked_clue_ids
-- ============================================================

-- ------------------------------------------------------------
-- 1. Add puzzle_answers column to case_secrets
--    Format: {"puz-1": "القهوة", "puz-phone-1": "الموبايل"}
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'case_secrets'
      AND column_name = 'puzzle_answers'
  ) THEN
    ALTER TABLE public.case_secrets ADD COLUMN puzzle_answers JSONB NOT NULL DEFAULT '{}';
  END IF;
END $$;

-- Seed puzzle answers (server-side only, never returned to client)
UPDATE public.case_secrets SET puzzle_answers = '{"puz-1": "القهوة"}'
  WHERE case_id = 'case-coffee';

UPDATE public.case_secrets SET puzzle_answers = '{"puz-phone-1": "الموبايل"}'
  WHERE case_id = 'case-phone';

-- Other cases have no puzzles — empty object is fine

-- ------------------------------------------------------------
-- 2. Add clue_locations JSONB column to case_secrets
--    Format: {"loc-kitchen": ["c1","c2"], "loc-cafe": ["c3","c6",...]}
--    Server uses this to resolve which clues unlock when a location is searched.
--    Client never controls which clues get unlocked.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'case_secrets'
      AND column_name = 'clue_locations'
  ) THEN
    ALTER TABLE public.case_secrets ADD COLUMN clue_locations JSONB NOT NULL DEFAULT '{}';
  END IF;
END $$;

-- Seed clue_locations for case-coffee
UPDATE public.case_secrets SET clue_locations = '{
  "loc-kitchen": ["c1","c2","c4"],
  "loc-cafe":    ["c3","c6","c9"],
  "loc-market":  ["c5","c8"],
  "loc-office":  ["c7","c10"]
}'::jsonb WHERE case_id = 'case-coffee';

-- Seed clue_locations for case-phone
UPDATE public.case_secrets SET clue_locations = '{
  "loc-bedroom": ["c1","c6","c7"],
  "loc-living":  ["c2","c3","c5","c9"],
  "loc-kitchen": [],
  "loc-work":    ["c4","c8","c10"]
}'::jsonb WHERE case_id = 'case-phone';

-- Seed clue_locations for case-microbus
UPDATE public.case_secrets SET clue_locations = '{
  "loc-station":     ["c3","c5","c10"],
  "loc-last-seat":   ["c6","c7"],
  "loc-driver-side": ["c2","c4","c8","c9"],
  "loc-drop-off":    ["c1"]
}'::jsonb WHERE case_id = 'case-microbus';

-- Seed clue_locations for case-summer
UPDATE public.case_secrets SET clue_locations = '{
  "loc-beach":  ["c1","c2","c7"],
  "loc-hotel":  ["c5","c6"],
  "loc-walk":   ["c3","c4","c9"],
  "loc-party":  ["c8","c10"]
}'::jsonb WHERE case_id = 'case-summer';

-- Seed clue_locations for case-koshary
UPDATE public.case_secrets SET clue_locations = '{
  "loc-koshary-shop": ["c1"],
  "loc-kitchen-k":    ["c2"]
}'::jsonb WHERE case_id = 'case-koshary';

-- Seed clue_locations for case-derby
UPDATE public.case_secrets SET clue_locations = '{
  "loc-ahwa":   ["c1"],
  "loc-stadium":["c2"]
}'::jsonb WHERE case_id = 'case-derby';

-- ------------------------------------------------------------
-- 3. Replace search_location RPC
--    Server resolves clue_ids from case_secrets.clue_locations.
--    Client only sends p_location_id — cannot inject arbitrary clue IDs.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_location(
  p_room_id     UUID,
  p_location_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id        UUID;
  v_current_round  INT;
  v_case_id        TEXT;
  v_clue_ids       TEXT[];
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Must be in room
  IF NOT EXISTS (
    SELECT 1 FROM public.room_players WHERE room_id = p_room_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Player not in room';
  END IF;

  SELECT COALESCE(current_round, 1), case_id
  INTO v_current_round, v_case_id
  FROM public.rooms WHERE id = p_room_id;

  -- Resolve clue IDs server-side from case_secrets
  SELECT ARRAY(
    SELECT jsonb_array_elements_text(
      COALESCE(clue_locations -> p_location_id, '[]'::jsonb)
    )
  )
  INTO v_clue_ids
  FROM public.case_secrets
  WHERE case_id = v_case_id;

  -- Upsert investigation_progress
  INSERT INTO public.investigation_progress (room_id, round_number, searched_locations, discovered_clues)
  VALUES (p_room_id, v_current_round, ARRAY[p_location_id], COALESCE(v_clue_ids, '{}'))
  ON CONFLICT (room_id, round_number)
  DO UPDATE SET
    searched_locations = (
      SELECT array_agg(DISTINCT elem)
      FROM unnest(public.investigation_progress.searched_locations || p_location_id) elem
    ),
    discovered_clues = (
      SELECT array_agg(DISTINCT elem)
      FROM unnest(public.investigation_progress.discovered_clues || COALESCE(v_clue_ids, '{}')) elem
    ),
    updated_at = NOW();

  RETURN public.get_investigation_progress(p_room_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_location(UUID, TEXT) TO authenticated;

-- Drop old 3-argument version to prevent client from calling it
DROP FUNCTION IF EXISTS public.search_location(UUID, TEXT, TEXT[]);

-- ------------------------------------------------------------
-- 4. Replace solve_clue_puzzle RPC
--    Server validates answer against case_secrets.puzzle_answers.
--    Client sends p_puzzle_id + p_answer — server compares, never returns correct answer.
--    Client cannot unlock a clue by sending arbitrary p_unlocked_clue_id.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.solve_clue_puzzle(
  p_room_id   UUID,
  p_puzzle_id TEXT,
  p_answer    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id        UUID;
  v_current_round  INT;
  v_case_id        TEXT;
  v_correct_answer TEXT;
  v_is_correct     BOOLEAN;
  v_unlocked_clue  TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Must be in room
  IF NOT EXISTS (
    SELECT 1 FROM public.room_players WHERE room_id = p_room_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Player not in room';
  END IF;

  SELECT COALESCE(current_round, 1), case_id
  INTO v_current_round, v_case_id
  FROM public.rooms WHERE id = p_room_id;

  -- Server-side answer lookup — never returned to client
  SELECT puzzle_answers ->> p_puzzle_id
  INTO v_correct_answer
  FROM public.case_secrets
  WHERE case_id = v_case_id;

  IF v_correct_answer IS NULL THEN
    RAISE EXCEPTION 'Puzzle not found for this case';
  END IF;

  v_is_correct := (TRIM(LOWER(p_answer)) = TRIM(LOWER(v_correct_answer)));

  IF NOT v_is_correct THEN
    -- Return error signal — client shows "wrong answer"
    RAISE EXCEPTION 'Wrong answer';
  END IF;

  -- Find the clue that requires this puzzle (from clue_locations — all clues for this case)
  -- We mark the puzzle as solved; the client derives which clue unlocks from local case data
  -- (clue metadata like title/text is not secret — only the answer is)
  INSERT INTO public.investigation_progress (room_id, round_number, solved_puzzles)
  VALUES (p_room_id, v_current_round, ARRAY[p_puzzle_id])
  ON CONFLICT (room_id, round_number)
  DO UPDATE SET
    solved_puzzles = (
      SELECT array_agg(DISTINCT elem)
      FROM unnest(public.investigation_progress.solved_puzzles || p_puzzle_id) elem
    ),
    updated_at = NOW();

  RETURN public.get_investigation_progress(p_room_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.solve_clue_puzzle(UUID, TEXT, TEXT) TO authenticated;

-- Drop old 3-argument version that accepted p_unlocked_clue_id from client
DROP FUNCTION IF EXISTS public.solve_clue_puzzle(UUID, TEXT, TEXT, TEXT);

-- ------------------------------------------------------------
-- 5. Fix get_investigation_progress — remove p_round_number param
--    (was inconsistent: RPC fetched round from DB anyway)
--    Keep backward compat by also keeping the 2-arg version
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_investigation_progress(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_round INT;
  v_row RECORD;
BEGIN
  -- Must be in room
  IF NOT EXISTS (
    SELECT 1 FROM public.room_players WHERE room_id = p_room_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Player not in room';
  END IF;

  SELECT COALESCE(current_round, 1) INTO v_current_round
  FROM public.rooms WHERE id = p_room_id;

  SELECT searched_locations, discovered_clues, solved_puzzles,
         discovered_connections, recorded_contradictions, case_theory
  INTO v_row
  FROM public.investigation_progress
  WHERE room_id = p_room_id AND round_number = v_current_round;

  IF v_row IS NULL THEN
    RETURN jsonb_build_object(
      'searched_locations', '[]'::jsonb,
      'discovered_clues', '[]'::jsonb,
      'solved_puzzles', '[]'::jsonb,
      'discovered_connections', '[]'::jsonb,
      'recorded_contradictions', '[]'::jsonb,
      'case_theory', NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'searched_locations',      to_jsonb(COALESCE(v_row.searched_locations, '{}')),
    'discovered_clues',        to_jsonb(COALESCE(v_row.discovered_clues, '{}')),
    'solved_puzzles',          to_jsonb(COALESCE(v_row.solved_puzzles, '{}')),
    'discovered_connections',  to_jsonb(COALESCE(v_row.discovered_connections, '{}')),
    'recorded_contradictions', to_jsonb(COALESCE(v_row.recorded_contradictions, '{}')),
    'case_theory', v_row.case_theory
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_investigation_progress(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 6. Fix record_contradiction — add room membership check
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_contradiction(
  p_room_id          UUID,
  p_contradiction_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_round INT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.room_players WHERE room_id = p_room_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Player not in room';
  END IF;

  SELECT COALESCE(current_round, 1) INTO v_current_round FROM public.rooms WHERE id = p_room_id;

  INSERT INTO public.investigation_progress (room_id, round_number, recorded_contradictions)
  VALUES (p_room_id, v_current_round, ARRAY[p_contradiction_id])
  ON CONFLICT (room_id, round_number)
  DO UPDATE SET
    recorded_contradictions = (
      SELECT array_agg(DISTINCT elem)
      FROM unnest(public.investigation_progress.recorded_contradictions || p_contradiction_id) elem
    ),
    updated_at = NOW();

  RETURN public.get_investigation_progress(p_room_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_contradiction(UUID, TEXT) TO authenticated;

-- Drop old 4-argument version
DROP FUNCTION IF EXISTS public.record_contradiction(UUID, TEXT, TEXT, TEXT);

-- ------------------------------------------------------------
-- 7. Fix create_clue_connection — add room membership check
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_clue_connection(
  p_room_id      UUID,
  p_connection_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_round INT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.room_players WHERE room_id = p_room_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Player not in room';
  END IF;

  SELECT COALESCE(current_round, 1) INTO v_current_round FROM public.rooms WHERE id = p_room_id;

  INSERT INTO public.investigation_progress (room_id, round_number, discovered_connections)
  VALUES (p_room_id, v_current_round, ARRAY[p_connection_id])
  ON CONFLICT (room_id, round_number)
  DO UPDATE SET
    discovered_connections = (
      SELECT array_agg(DISTINCT elem)
      FROM unnest(public.investigation_progress.discovered_connections || p_connection_id) elem
    ),
    updated_at = NOW();

  RETURN public.get_investigation_progress(p_room_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_clue_connection(UUID, TEXT) TO authenticated;

-- Drop old 4-argument version
DROP FUNCTION IF EXISTS public.create_clue_connection(UUID, TEXT, TEXT, TEXT);
