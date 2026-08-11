-- ============================================================
-- Migration: 20240010_interactive_investigation.sql
-- Project: THE SUSPECT
-- Features:
--   1. investigation_progress table (Persists locations searched, clues discovered, puzzles solved, connections made, contradictions recorded)
--   2. RLS policies for investigation_progress
--   3. RPCs: search_location, solve_clue_puzzle, create_clue_connection, record_contradiction, get_investigation_progress
-- ============================================================

-- ------------------------------------------------------------
-- 1. Create investigation_progress table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.investigation_progress (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id                 UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  round_number            INT NOT NULL DEFAULT 1,
  searched_locations      TEXT[] NOT NULL DEFAULT '{}',
  discovered_clues        TEXT[] NOT NULL DEFAULT '{}',
  solved_puzzles          TEXT[] NOT NULL DEFAULT '{}',
  discovered_connections  TEXT[] NOT NULL DEFAULT '{}',
  recorded_contradictions TEXT[] NOT NULL DEFAULT '{}',
  case_theory             JSONB DEFAULT NULL,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT investigation_progress_room_round_key UNIQUE (room_id, round_number)
);

-- Enable RLS
ALTER TABLE public.investigation_progress ENABLE ROW LEVEL SECURITY;

-- RLS Policies for investigation_progress
DROP POLICY IF EXISTS "Users can view investigation_progress in their room" ON public.investigation_progress;
CREATE POLICY "Users can view investigation_progress in their room"
  ON public.investigation_progress FOR SELECT
  TO authenticated
  USING (
    room_id IN (
      SELECT room_id FROM public.room_players WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update investigation_progress in their room" ON public.investigation_progress;
CREATE POLICY "Users can update investigation_progress in their room"
  ON public.investigation_progress FOR ALL
  TO authenticated
  USING (
    room_id IN (
      SELECT room_id FROM public.room_players WHERE user_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- 2. RPC: get_investigation_progress
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
  SELECT COALESCE(current_round, 1) INTO v_current_round
  FROM public.rooms
  WHERE id = p_room_id;

  SELECT searched_locations, discovered_clues, solved_puzzles, discovered_connections, recorded_contradictions, case_theory
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
    'searched_locations', to_jsonb(COALESCE(v_row.searched_locations, '{}')),
    'discovered_clues', to_jsonb(COALESCE(v_row.discovered_clues, '{}')),
    'solved_puzzles', to_jsonb(COALESCE(v_row.solved_puzzles, '{}')),
    'discovered_connections', to_jsonb(COALESCE(v_row.discovered_connections, '{}')),
    'recorded_contradictions', to_jsonb(COALESCE(v_row.recorded_contradictions, '{}')),
    'case_theory', v_row.case_theory
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_investigation_progress(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 3. RPC: search_location
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_location(
  p_room_id UUID,
  p_location_id TEXT,
  p_unlocked_clue_ids TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_current_round INT;
  v_result JSONB;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT COALESCE(current_round, 1) INTO v_current_round
  FROM public.rooms
  WHERE id = p_room_id;

  INSERT INTO public.investigation_progress (room_id, round_number, searched_locations, discovered_clues)
  VALUES (p_room_id, v_current_round, ARRAY[p_location_id], p_unlocked_clue_ids)
  ON CONFLICT (room_id, round_number)
  DO UPDATE SET
    searched_locations = (
      SELECT array_agg(DISTINCT elem)
      FROM unnest(public.investigation_progress.searched_locations || p_location_id) elem
    ),
    discovered_clues = (
      SELECT array_agg(DISTINCT elem)
      FROM unnest(public.investigation_progress.discovered_clues || p_unlocked_clue_ids) elem
    ),
    updated_at = NOW();

  RETURN public.get_investigation_progress(p_room_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_location(UUID, TEXT, TEXT[]) TO authenticated;

-- ------------------------------------------------------------
-- 4. RPC: solve_clue_puzzle
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.solve_clue_puzzle(
  p_room_id UUID,
  p_puzzle_id TEXT,
  p_unlocked_clue_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_round INT;
BEGIN
  SELECT COALESCE(current_round, 1) INTO v_current_round
  FROM public.rooms
  WHERE id = p_room_id;

  INSERT INTO public.investigation_progress (room_id, round_number, solved_puzzles, discovered_clues)
  VALUES (p_room_id, v_current_round, ARRAY[p_puzzle_id], ARRAY[p_unlocked_clue_id])
  ON CONFLICT (room_id, round_number)
  DO UPDATE SET
    solved_puzzles = (
      SELECT array_agg(DISTINCT elem)
      FROM unnest(public.investigation_progress.solved_puzzles || p_puzzle_id) elem
    ),
    discovered_clues = (
      SELECT array_agg(DISTINCT elem)
      FROM unnest(public.investigation_progress.discovered_clues || p_unlocked_clue_id) elem
    ),
    updated_at = NOW();

  RETURN public.get_investigation_progress(p_room_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.solve_clue_puzzle(UUID, TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 5. RPC: create_clue_connection
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_clue_connection(
  p_room_id UUID,
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
  SELECT COALESCE(current_round, 1) INTO v_current_round
  FROM public.rooms
  WHERE id = p_room_id;

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

-- ------------------------------------------------------------
-- 6. RPC: record_contradiction
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_contradiction(
  p_room_id UUID,
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
  SELECT COALESCE(current_round, 1) INTO v_current_round
  FROM public.rooms
  WHERE id = p_room_id;

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
