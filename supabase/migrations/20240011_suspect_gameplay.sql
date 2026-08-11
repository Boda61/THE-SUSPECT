-- ============================================================
-- Migration: 20240011_suspect_gameplay.sql
-- Project: THE SUSPECT
-- Features:
--   1. suspect_alibis table
--   2. suspect_defenses table
--   3. interrogation_sessions table
--   4. RPCs for Suspect HQ
-- ============================================================

-- ------------------------------------------------------------
-- 1. Create suspect_alibis table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.suspect_alibis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  round_number INT NOT NULL DEFAULT 1,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alibi_text TEXT NOT NULL,
  is_published BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT suspect_alibis_room_round_user_key UNIQUE (room_id, round_number, user_id)
);

ALTER TABLE public.suspect_alibis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Suspects can view and update their own alibi"
  ON public.suspect_alibis FOR ALL
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Anyone in room can view published alibis"
  ON public.suspect_alibis FOR SELECT
  TO authenticated
  USING (
    is_published = true AND
    room_id IN (
      SELECT room_id FROM public.room_players WHERE user_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- 2. Create suspect_defenses table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.suspect_defenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  round_number INT NOT NULL DEFAULT 1,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  clue_id TEXT NOT NULL,
  defense_text TEXT NOT NULL,
  is_published BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT suspect_defenses_room_round_user_clue_key UNIQUE (room_id, round_number, user_id, clue_id)
);

ALTER TABLE public.suspect_defenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Suspects can view and update their own defenses"
  ON public.suspect_defenses FOR ALL
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Anyone in room can view published defenses"
  ON public.suspect_defenses FOR SELECT
  TO authenticated
  USING (
    is_published = true AND
    room_id IN (
      SELECT room_id FROM public.room_players WHERE user_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- 3. Create interrogation_sessions table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.interrogation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  round_number INT NOT NULL DEFAULT 1,
  detective_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  suspect_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  response_text TEXT,
  is_answered BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  answered_at TIMESTAMPTZ
);

ALTER TABLE public.interrogation_sessions ENABLE ROW LEVEL SECURITY;

-- Everyone in the room can see the interrogations
CREATE POLICY "Anyone in room can view interrogations"
  ON public.interrogation_sessions FOR SELECT
  TO authenticated
  USING (
    room_id IN (
      SELECT room_id FROM public.room_players WHERE user_id = auth.uid()
    )
  );

-- Detectives can insert questions
CREATE POLICY "Detectives can insert interrogations"
  ON public.interrogation_sessions FOR INSERT
  TO authenticated
  WITH CHECK (
    detective_id = auth.uid() AND
    room_id IN (
      SELECT room_id FROM public.room_players WHERE user_id = auth.uid()
    )
  );

-- Suspects can update their responses
CREATE POLICY "Suspects can answer interrogations"
  ON public.interrogation_sessions FOR UPDATE
  TO authenticated
  USING (suspect_id = auth.uid());

-- ------------------------------------------------------------
-- 4. RPCs for Suspect HQ
-- ------------------------------------------------------------

-- Submit Alibi
CREATE OR REPLACE FUNCTION public.submit_suspect_alibi(
  p_room_id UUID,
  p_alibi_text TEXT,
  p_is_published BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_current_round INT;
  v_role TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Ensure user is the suspect
  SELECT role INTO v_role FROM public.room_players WHERE room_id = p_room_id AND user_id = v_user_id;
  IF v_role != 'suspect' THEN RAISE EXCEPTION 'Only the suspect can submit an alibi'; END IF;

  SELECT COALESCE(current_round, 1) INTO v_current_round FROM public.rooms WHERE id = p_room_id;

  INSERT INTO public.suspect_alibis (room_id, round_number, user_id, alibi_text, is_published, updated_at)
  VALUES (p_room_id, v_current_round, v_user_id, p_alibi_text, p_is_published, NOW())
  ON CONFLICT (room_id, round_number, user_id)
  DO UPDATE SET
    alibi_text = p_alibi_text,
    is_published = p_is_published,
    updated_at = NOW();

  RETURN public.get_suspect_hq(p_room_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_suspect_alibi(UUID, TEXT, BOOLEAN) TO authenticated;

-- Submit Defense
CREATE OR REPLACE FUNCTION public.submit_suspect_defense(
  p_room_id UUID,
  p_clue_id TEXT,
  p_defense_text TEXT,
  p_is_published BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_current_round INT;
  v_role TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Ensure user is the suspect
  SELECT role INTO v_role FROM public.room_players WHERE room_id = p_room_id AND user_id = v_user_id;
  IF v_role != 'suspect' THEN RAISE EXCEPTION 'Only the suspect can submit a defense'; END IF;

  SELECT COALESCE(current_round, 1) INTO v_current_round FROM public.rooms WHERE id = p_room_id;

  INSERT INTO public.suspect_defenses (room_id, round_number, user_id, clue_id, defense_text, is_published, updated_at)
  VALUES (p_room_id, v_current_round, v_user_id, p_clue_id, p_defense_text, p_is_published, NOW())
  ON CONFLICT (room_id, round_number, user_id, clue_id)
  DO UPDATE SET
    defense_text = p_defense_text,
    is_published = p_is_published,
    updated_at = NOW();

  RETURN public.get_suspect_hq(p_room_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_suspect_defense(UUID, TEXT, TEXT, BOOLEAN) TO authenticated;

-- Submit Interrogation Question (Detectives)
CREATE OR REPLACE FUNCTION public.submit_interrogation_question(
  p_room_id UUID,
  p_question_text TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_suspect_id UUID;
  v_current_round INT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT user_id INTO v_suspect_id FROM public.room_players WHERE room_id = p_room_id AND role = 'suspect' LIMIT 1;
  IF v_suspect_id IS NULL THEN RAISE EXCEPTION 'No suspect found in this room'; END IF;

  SELECT COALESCE(current_round, 1) INTO v_current_round FROM public.rooms WHERE id = p_room_id;

  INSERT INTO public.interrogation_sessions (room_id, round_number, detective_id, suspect_id, question_text)
  VALUES (p_room_id, v_current_round, v_user_id, v_suspect_id, p_question_text);

  RETURN jsonb_build_object('status', 'success');
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_interrogation_question(UUID, TEXT) TO authenticated;


-- Submit Interrogation Response (Suspect)
CREATE OR REPLACE FUNCTION public.submit_interrogation_response(
  p_session_id UUID,
  p_response_text TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_room_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  
  -- Find the session
  SELECT room_id INTO v_room_id FROM public.interrogation_sessions WHERE id = p_session_id AND suspect_id = v_user_id;
  IF v_room_id IS NULL THEN RAISE EXCEPTION 'Interrogation session not found or you are not the suspect'; END IF;

  UPDATE public.interrogation_sessions
  SET response_text = p_response_text, is_answered = true, answered_at = NOW()
  WHERE id = p_session_id;

  RETURN public.get_suspect_hq(v_room_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_interrogation_response(UUID, TEXT) TO authenticated;

-- Get Suspect HQ Data
CREATE OR REPLACE FUNCTION public.get_suspect_hq(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_current_round INT;
  v_alibi RECORD;
  v_defenses JSONB;
  v_interrogations JSONB;
BEGIN
  v_user_id := auth.uid();
  SELECT COALESCE(current_round, 1) INTO v_current_round FROM public.rooms WHERE id = p_room_id;

  -- Fetch Alibi
  SELECT alibi_text, is_published, updated_at INTO v_alibi
  FROM public.suspect_alibis
  WHERE room_id = p_room_id AND round_number = v_current_round AND user_id = v_user_id;

  -- Fetch Defenses
  SELECT COALESCE(jsonb_agg(jsonb_build_object('clue_id', clue_id, 'defense_text', defense_text, 'is_published', is_published, 'updated_at', updated_at)), '[]'::jsonb)
  INTO v_defenses
  FROM public.suspect_defenses
  WHERE room_id = p_room_id AND round_number = v_current_round AND user_id = v_user_id;

  -- Fetch Interrogations
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 
      'detective_id', detective_id, 
      'question_text', question_text, 
      'response_text', response_text, 
      'is_answered', is_answered, 
      'created_at', created_at, 
      'answered_at', answered_at
    )), '[]'::jsonb)
  INTO v_interrogations
  FROM public.interrogation_sessions
  WHERE room_id = p_room_id AND round_number = v_current_round AND suspect_id = v_user_id;

  RETURN jsonb_build_object(
    'alibi', CASE WHEN v_alibi IS NOT NULL THEN jsonb_build_object('text', v_alibi.alibi_text, 'is_published', v_alibi.is_published, 'updated_at', v_alibi.updated_at) ELSE NULL END,
    'defenses', v_defenses,
    'interrogations', v_interrogations
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_suspect_hq(UUID) TO authenticated;

-- Get Public Suspect Data (For Detectives)
CREATE OR REPLACE FUNCTION public.get_public_suspect_data(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_round INT;
  v_alibi RECORD;
  v_defenses JSONB;
  v_interrogations JSONB;
BEGIN
  SELECT COALESCE(current_round, 1) INTO v_current_round FROM public.rooms WHERE id = p_room_id;

  -- Fetch Published Alibi
  SELECT alibi_text, updated_at INTO v_alibi
  FROM public.suspect_alibis
  WHERE room_id = p_room_id AND round_number = v_current_round AND is_published = true;

  -- Fetch Published Defenses
  SELECT COALESCE(jsonb_agg(jsonb_build_object('clue_id', clue_id, 'defense_text', defense_text, 'updated_at', updated_at)), '[]'::jsonb)
  INTO v_defenses
  FROM public.suspect_defenses
  WHERE room_id = p_room_id AND round_number = v_current_round AND is_published = true;

  -- Fetch Interrogations
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 
      'detective_id', detective_id, 
      'question_text', question_text, 
      'response_text', response_text, 
      'is_answered', is_answered, 
      'created_at', created_at, 
      'answered_at', answered_at
    )), '[]'::jsonb)
  INTO v_interrogations
  FROM public.interrogation_sessions
  WHERE room_id = p_room_id AND round_number = v_current_round;

  RETURN jsonb_build_object(
    'alibi', CASE WHEN v_alibi IS NOT NULL THEN jsonb_build_object('text', v_alibi.alibi_text, 'updated_at', v_alibi.updated_at) ELSE NULL END,
    'defenses', v_defenses,
    'interrogations', v_interrogations
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_public_suspect_data(UUID) TO authenticated;
