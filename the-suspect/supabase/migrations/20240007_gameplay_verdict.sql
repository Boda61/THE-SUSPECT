-- Migration: 20240007_gameplay_verdict.sql
-- Description: Add accusation_data column, update room status constraint, add submit_accusation & reset_room_for_new_game RPCs

-- 1. Add accusation_data column to rooms
ALTER TABLE public.rooms 
ADD COLUMN IF NOT EXISTS accusation_data JSONB DEFAULT NULL;

-- 2. Drop existing constraint & add updated rooms_status_check
ALTER TABLE public.rooms 
DROP CONSTRAINT IF EXISTS rooms_status_check;

ALTER TABLE public.rooms 
ADD CONSTRAINT rooms_status_check 
CHECK (status = ANY (ARRAY[
  'waiting'::text, 
  'starting'::text, 
  'role_assignment'::text, 
  'investigation'::text, 
  'accusation'::text, 
  'verdict'::text, 
  'results'::text, 
  'in_game'::text, 
  'finished'::text, 
  'closed'::text
]));

-- 3. Create submit_accusation RPC
CREATE OR REPLACE FUNCTION public.submit_accusation(
    p_room_id UUID,
    p_accused_user_id UUID,
    p_accused_name TEXT,
    p_evidence_ids TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_host_id UUID;
    v_actual_suspect_id UUID;
    v_actual_suspect_name TEXT;
    v_is_correct BOOLEAN;
    v_score INT := 0;
    v_result JSONB;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Verify room & host
    SELECT host_id INTO v_host_id
    FROM public.rooms
    WHERE id = p_room_id;

    IF v_host_id IS NULL THEN
        RAISE EXCEPTION 'Room not found';
    END IF;

    IF v_host_id != v_user_id THEN
        RAISE EXCEPTION 'Only the host/lead investigator can submit the final accusation';
    END IF;

    -- Get actual suspect player in room
    SELECT user_id, display_name INTO v_actual_suspect_id, v_actual_suspect_name
    FROM public.room_players
    WHERE room_id = p_room_id AND role = 'suspect' AND is_connected = TRUE
    LIMIT 1;

    -- Fallback if no specific player suspect role exists
    IF v_actual_suspect_id IS NULL THEN
        SELECT user_id, display_name INTO v_actual_suspect_id, v_actual_suspect_name
        FROM public.room_players
        WHERE room_id = p_room_id AND is_connected = TRUE
        ORDER BY joined_at DESC
        LIMIT 1;
    END IF;

    -- Determine correctness
    IF p_accused_user_id = v_actual_suspect_id THEN
        v_is_correct := TRUE;
        v_score := 500 + (COALESCE(array_length(p_evidence_ids, 1), 0) * 150) + 200;
    ELSE
        v_is_correct := FALSE;
        v_score := COALESCE(array_length(p_evidence_ids, 1), 0) * 50;
    END IF;

    -- Build json result payload
    v_result := jsonb_build_object(
        'accused_id', p_accused_user_id,
        'accused_name', p_accused_name,
        'evidence_ids', p_evidence_ids,
        'is_correct', v_is_correct,
        'actual_suspect_id', v_actual_suspect_id,
        'actual_suspect_name', v_actual_suspect_name,
        'score', v_score,
        'submitted_at', NOW()
    );

    -- Update room record with accusation data and set status to results
    UPDATE public.rooms
    SET status = 'results',
        accusation_data = v_result,
        updated_at = NOW()
    WHERE id = p_room_id;

    RETURN v_result;
END;
$$;

-- 4. Create reset_room_for_new_game RPC
CREATE OR REPLACE FUNCTION public.reset_room_for_new_game(p_room_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_host_id UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT host_id INTO v_host_id
    FROM public.rooms
    WHERE id = p_room_id;

    IF v_host_id != v_user_id THEN
        RAISE EXCEPTION 'Only host can reset the room';
    END IF;

    -- Reset room_players role to null
    UPDATE public.room_players
    SET role = NULL
    WHERE room_id = p_room_id;

    -- Reset room status and accusation data
    UPDATE public.rooms
    SET status = 'waiting',
        accusation_data = NULL,
        updated_at = NOW()
    WHERE id = p_room_id;

    RETURN TRUE;
END;
$$;
