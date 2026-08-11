-- Migration: 20240008_round_scores_leaderboard.sql
-- Description: Add current_round column to rooms, create round_scores table, RLS policies, and leaderboard RPCs

-- 1. Add current_round column to rooms
ALTER TABLE public.rooms 
ADD COLUMN IF NOT EXISTS current_round INT NOT NULL DEFAULT 1;

-- 2. Create round_scores table
CREATE TABLE IF NOT EXISTS public.round_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
    round_number INT NOT NULL DEFAULT 1,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role TEXT,
    points INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT round_scores_room_round_user_key UNIQUE (room_id, round_number, user_id)
);

-- Enable RLS on round_scores
ALTER TABLE public.round_scores ENABLE ROW LEVEL SECURITY;

-- Drop policy if exists & recreate read policy
DROP POLICY IF EXISTS "Users can view scores for their rooms" ON public.round_scores;

CREATE POLICY "Users can view scores for their rooms" 
ON public.round_scores 
FOR SELECT 
TO authenticated 
USING (
    room_id IN (
        SELECT room_id FROM public.room_players WHERE user_id = auth.uid()
    )
);

-- 3. Update submit_accusation RPC to calculate and persist per-player round scores
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
    v_current_round INT;
    v_actual_suspect_id UUID;
    v_actual_suspect_name TEXT;
    v_is_correct BOOLEAN;
    v_evidence_count INT;
    v_detective_pts INT;
    v_suspect_pts INT;
    v_player RECORD;
    v_result JSONB;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Verify room & host
    SELECT host_id, COALESCE(current_round, 1) INTO v_host_id, v_current_round
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

    v_evidence_count := COALESCE(array_length(p_evidence_ids, 1), 0);

    -- Determine correctness & scoring model
    IF p_accused_user_id = v_actual_suspect_id THEN
        v_is_correct := TRUE;
        v_detective_pts := 500 + (v_evidence_count * 100);
        v_suspect_pts := 0;
    ELSE
        v_is_correct := FALSE;
        v_detective_pts := -100;
        v_suspect_pts := 600;
    END IF;

    -- Insert/Update scores for each player in room
    FOR v_player IN (SELECT user_id, role FROM public.room_players WHERE room_id = p_room_id AND is_connected = TRUE) LOOP
        INSERT INTO public.round_scores (room_id, round_number, user_id, role, points)
        VALUES (
            p_room_id,
            v_current_round,
            v_player.user_id,
            v_player.role,
            CASE WHEN v_player.user_id = v_actual_suspect_id THEN v_suspect_pts ELSE v_detective_pts END
        )
        ON CONFLICT (room_id, round_number, user_id) 
        DO UPDATE SET 
            points = EXCLUDED.points,
            role = EXCLUDED.role;
    END LOOP;

    -- Build json result payload
    v_result := jsonb_build_object(
        'accused_id', p_accused_user_id,
        'accused_name', p_accused_name,
        'evidence_ids', p_evidence_ids,
        'is_correct', v_is_correct,
        'actual_suspect_id', v_actual_suspect_id,
        'actual_suspect_name', v_actual_suspect_name,
        'round_number', v_current_round,
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

-- 4. Create get_room_leaderboard RPC
CREATE OR REPLACE FUNCTION public.get_room_leaderboard(p_room_id UUID)
RETURNS TABLE (
    user_id UUID,
    display_name TEXT,
    role TEXT,
    round_points INT,
    total_points INT,
    rank BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    WITH current_rd AS (
        SELECT COALESCE(current_round, 1) as rd FROM public.rooms WHERE id = p_room_id
    ),
    rd_pts AS (
        SELECT rs.user_id, rs.points as round_pts, rs.role
        FROM public.round_scores rs, current_rd
        WHERE rs.room_id = p_room_id AND rs.round_number = current_rd.rd
    ),
    tot_pts AS (
        SELECT rs.user_id, SUM(rs.points)::INT as total_pts
        FROM public.round_scores rs
        WHERE rs.room_id = p_room_id
        GROUP BY rs.user_id
    )
    SELECT 
        rp.user_id,
        rp.display_name,
        COALESCE(rd.role, rp.role, 'detective') as role,
        COALESCE(rd.round_pts, 0) as round_points,
        COALESCE(tot.total_pts, 0) as total_points,
        DENSE_RANK() OVER (ORDER BY COALESCE(tot.total_pts, 0) DESC, COALESCE(rd.round_pts, 0) DESC) as rank
    FROM public.room_players rp
    LEFT JOIN rd_pts rd ON rp.user_id = rd.user_id
    LEFT JOIN tot_pts tot ON rp.user_id = tot.user_id
    WHERE rp.room_id = p_room_id AND rp.is_connected = TRUE
    ORDER BY rank ASC, rp.display_name ASC;
END;
$$;

-- 5. Create start_next_round RPC
CREATE OR REPLACE FUNCTION public.start_next_round(p_room_id UUID)
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
        RAISE EXCEPTION 'Only host can start the next round';
    END IF;

    -- Increment round counter & reset room status
    UPDATE public.rooms
    SET current_round = COALESCE(current_round, 1) + 1,
        status = 'waiting',
        accusation_data = NULL,
        updated_at = NOW()
    WHERE id = p_room_id;

    -- Reset room_players role for the new round
    UPDATE public.room_players
    SET role = NULL
    WHERE room_id = p_room_id;

    RETURN TRUE;
END;
$$;
