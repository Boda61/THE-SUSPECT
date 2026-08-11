-- ============================================================
-- Migration: Secure start_game RPC function
-- Project: THE SUSPECT
-- ============================================================

CREATE OR REPLACE FUNCTION public.start_game(p_room_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_host_id UUID;
    v_status TEXT;
    v_player_count INT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Lock room row for update to prevent race conditions
    SELECT host_id, status INTO v_host_id, v_status
    FROM public.rooms
    WHERE id = p_room_id
    FOR UPDATE;

    IF v_host_id IS NULL THEN
        RAISE EXCEPTION 'Room not found';
    END IF;

    IF v_host_id != v_user_id THEN
        RAISE EXCEPTION 'Only the host can start the game';
    END IF;

    IF v_status != 'waiting' THEN
        RAISE EXCEPTION 'Room is not in waiting status';
    END IF;

    -- Ensure at least one connected player exists
    SELECT COUNT(*) INTO v_player_count
    FROM public.room_players
    WHERE room_id = p_room_id AND is_connected = TRUE;

    IF v_player_count < 1 THEN
        RAISE EXCEPTION 'No connected players in room';
    END IF;

    -- Atomically update room status
    UPDATE public.rooms
    SET status = 'starting', updated_at = NOW()
    WHERE id = p_room_id;

    RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_game(UUID) TO authenticated;
