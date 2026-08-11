-- ============================================================
-- Migration: 20240009_mvp_complete.sql
-- Project: THE SUSPECT
-- Features:
--   1. Realtime Chat / Discussion (room_messages table, RLS, RPC)
--   2. Multiplayer Voting System (room_votes table, RLS, RPCs)
--   3. Extended rooms_status_check constraint with 'voting' phase
--   4. Role Privacy Security (Secure role view / RPCs)
-- ============================================================

-- ------------------------------------------------------------
-- 1. Update rooms_status_check constraint to include 'voting'
-- ------------------------------------------------------------
ALTER TABLE public.rooms 
DROP CONSTRAINT IF EXISTS rooms_status_check;

ALTER TABLE public.rooms 
ADD CONSTRAINT rooms_status_check 
CHECK (status = ANY (ARRAY[
  'waiting'::text, 
  'starting'::text, 
  'role_assignment'::text, 
  'investigation'::text, 
  'voting'::text,
  'accusation'::text, 
  'verdict'::text, 
  'results'::text, 
  'in_game'::text, 
  'finished'::text, 
  'closed'::text
]));

-- ------------------------------------------------------------
-- 2. Create room_messages table (Realtime Chat / Discussion)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.room_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  round_number INT NOT NULL DEFAULT 1,
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS on room_messages
ALTER TABLE public.room_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies for room_messages
DROP POLICY IF EXISTS "Users can view room_messages in their room" ON public.room_messages;
CREATE POLICY "Users can view room_messages in their room"
  ON public.room_messages FOR SELECT
  TO authenticated
  USING (
    room_id IN (
      SELECT room_id FROM public.room_players WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert room_messages in their room" ON public.room_messages;
CREATE POLICY "Users can insert room_messages in their room"
  ON public.room_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid() AND
    room_id IN (
      SELECT room_id FROM public.room_players WHERE user_id = auth.uid()
    )
  );

-- RPC: send_room_message
CREATE OR REPLACE FUNCTION public.send_room_message(
  p_room_id UUID,
  p_message TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_display_name TEXT;
  v_current_round INT;
  v_msg_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT display_name INTO v_display_name
  FROM public.room_players
  WHERE room_id = p_room_id AND user_id = v_user_id AND is_connected = TRUE;

  IF v_display_name IS NULL THEN
    RAISE EXCEPTION 'User is not a connected player in this room';
  END IF;

  SELECT COALESCE(current_round, 1) INTO v_current_round
  FROM public.rooms
  WHERE id = p_room_id;

  INSERT INTO public.room_messages (room_id, round_number, user_id, display_name, message)
  VALUES (p_room_id, v_current_round, v_user_id, v_display_name, TRIM(p_message))
  RETURNING id INTO v_msg_id;

  RETURN v_msg_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_room_message(UUID, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 3. Create room_votes table (Multiplayer Secret Voting)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.room_votes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  round_number  INT NOT NULL DEFAULT 1,
  voter_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  voter_name    TEXT NOT NULL,
  suspect_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  suspect_name  TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT room_votes_room_round_voter_key UNIQUE (room_id, round_number, voter_id)
);

-- Enable RLS on room_votes
ALTER TABLE public.room_votes ENABLE ROW LEVEL SECURITY;

-- RLS Policies for room_votes
DROP POLICY IF EXISTS "Users can view votes in their room" ON public.room_votes;
CREATE POLICY "Users can view votes in their room"
  ON public.room_votes FOR SELECT
  TO authenticated
  USING (
    room_id IN (
      SELECT room_id FROM public.room_players WHERE user_id = auth.uid()
    )
  );

-- RPC: submit_vote
CREATE OR REPLACE FUNCTION public.submit_vote(
  p_room_id UUID,
  p_suspect_user_id UUID,
  p_suspect_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_voter_id UUID;
  v_voter_name TEXT;
  v_current_round INT;
  v_room_status TEXT;
  v_total_players INT;
  v_votes_count INT;
  v_top_suspect_id UUID;
  v_top_suspect_name TEXT;
  v_is_all_voted BOOLEAN := FALSE;
BEGIN
  v_voter_id := auth.uid();
  IF v_voter_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Prevent voting for oneself
  IF v_voter_id = p_suspect_user_id THEN
    RAISE EXCEPTION 'You cannot vote for yourself';
  END IF;

  SELECT status, COALESCE(current_round, 1) INTO v_room_status, v_current_round
  FROM public.rooms
  WHERE id = p_room_id;

  IF v_room_status != 'voting' AND v_room_status != 'investigation' AND v_room_status != 'accusation' THEN
    RAISE EXCEPTION 'Room is not in voting phase';
  END IF;

  SELECT display_name INTO v_voter_name
  FROM public.room_players
  WHERE room_id = p_room_id AND user_id = v_voter_id;

  IF v_voter_name IS NULL THEN
    RAISE EXCEPTION 'User is not in room';
  END IF;

  -- Record vote (upsert for round)
  INSERT INTO public.room_votes (room_id, round_number, voter_id, voter_name, suspect_id, suspect_name)
  VALUES (p_room_id, v_current_round, v_voter_id, v_voter_name, p_suspect_user_id, p_suspect_name)
  ON CONFLICT (room_id, round_number, voter_id)
  DO UPDATE SET suspect_id = EXCLUDED.suspect_id, suspect_name = EXCLUDED.suspect_name, created_at = NOW();

  -- Calculate vote counts
  SELECT COUNT(*) INTO v_total_players
  FROM public.room_players
  WHERE room_id = p_room_id AND is_connected = TRUE;

  SELECT COUNT(*) INTO v_votes_count
  FROM public.room_votes
  WHERE room_id = p_room_id AND round_number = v_current_round;

  IF v_votes_count >= v_total_players THEN
    v_is_all_voted := TRUE;
  END IF;

  -- Get current leading suspect from votes
  SELECT suspect_id, suspect_name INTO v_top_suspect_id, v_top_suspect_name
  FROM public.room_votes
  WHERE room_id = p_room_id AND round_number = v_current_round
  GROUP BY suspect_id, suspect_name
  ORDER BY COUNT(*) DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'success', TRUE,
    'votes_count', v_votes_count,
    'total_players', v_total_players,
    'is_all_voted', v_is_all_voted,
    'top_suspect_id', v_top_suspect_id,
    'top_suspect_name', v_top_suspect_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_vote(UUID, UUID, TEXT) TO authenticated;

-- RPC: get_room_votes_summary
CREATE OR REPLACE FUNCTION public.get_room_votes_summary(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_round INT;
  v_total_players INT;
  v_votes_count INT;
  v_my_vote_suspect_id UUID;
  v_votes_array JSONB;
BEGIN
  SELECT COALESCE(current_round, 1) INTO v_current_round
  FROM public.rooms
  WHERE id = p_room_id;

  SELECT COUNT(*) INTO v_total_players
  FROM public.room_players
  WHERE room_id = p_room_id AND is_connected = TRUE;

  SELECT COUNT(*) INTO v_votes_count
  FROM public.room_votes
  WHERE room_id = p_room_id AND round_number = v_current_round;

  SELECT suspect_id INTO v_my_vote_suspect_id
  FROM public.room_votes
  WHERE room_id = p_room_id AND round_number = v_current_round AND voter_id = auth.uid();

  SELECT jsonb_agg(
    jsonb_build_object(
      'suspect_id', suspect_id,
      'suspect_name', suspect_name,
      'vote_count', vote_cnt
    )
  ) INTO v_votes_array
  FROM (
    SELECT suspect_id, suspect_name, COUNT(*) as vote_cnt
    FROM public.room_votes
    WHERE room_id = p_room_id AND round_number = v_current_round
    GROUP BY suspect_id, suspect_name
    ORDER BY vote_cnt DESC
  ) sub;

  RETURN jsonb_build_object(
    'total_players', v_total_players,
    'votes_count', v_votes_count,
    'my_vote_suspect_id', v_my_vote_suspect_id,
    'tally', COALESCE(v_votes_array, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_room_votes_summary(UUID) TO authenticated;
