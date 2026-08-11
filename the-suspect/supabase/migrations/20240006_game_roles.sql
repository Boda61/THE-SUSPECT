-- ============================================================
-- Migration: Game Roles & Phase Progression
-- Project: THE SUSPECT
-- ============================================================

DROP FUNCTION IF EXISTS public.get_my_role(uuid);

-- 1. Add role column to room_players if it does not exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'room_players' AND column_name = 'role'
  ) THEN
    ALTER TABLE public.room_players ADD COLUMN role TEXT DEFAULT NULL;
  END IF;
END $$;

-- 2. Update rooms_status_check constraint to include new phases
ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS rooms_status_check;
ALTER TABLE public.rooms ADD CONSTRAINT rooms_status_check
  CHECK (status IN ('waiting', 'starting', 'role_assignment', 'investigation', 'in_game', 'finished', 'closed'));

-- 3. Update start_game RPC to perform secure role assignment
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
    v_suspect_id UUID;
    v_player_count INT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Lock room row for update
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

    -- Check connected players
    SELECT COUNT(*) INTO v_player_count
    FROM public.room_players
    WHERE room_id = p_room_id AND is_connected = TRUE;

    IF v_player_count < 1 THEN
        RAISE EXCEPTION 'No connected players in room';
    END IF;

    -- Assign default 'detective' role to all connected players in room
    UPDATE public.room_players
    SET role = 'detective'
    WHERE room_id = p_room_id AND is_connected = TRUE;

    -- Select 1 random connected player to be the suspect
    SELECT id INTO v_suspect_id
    FROM public.room_players
    WHERE room_id = p_room_id AND is_connected = TRUE
    ORDER BY random()
    LIMIT 1;

    IF v_suspect_id IS NOT NULL THEN
        UPDATE public.room_players
        SET role = 'suspect'
        WHERE id = v_suspect_id;
    END IF;

    -- Update room status to starting
    UPDATE public.rooms
    SET status = 'starting', updated_at = NOW()
    WHERE id = p_room_id;

    RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_game(UUID) TO authenticated;

-- 4. Create get_my_role RPC (returns ONLY current user's role in a room)
CREATE OR REPLACE FUNCTION public.get_my_role(p_room_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_role TEXT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT role INTO v_role
    FROM public.room_players
    WHERE room_id = p_room_id AND user_id = v_user_id;

    RETURN v_role;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_role(UUID) TO authenticated;

-- 5. Create advance_room_status RPC for host room control
CREATE OR REPLACE FUNCTION public.advance_room_status(p_room_id UUID, p_next_status TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
        RAISE EXCEPTION 'Only host can advance room status';
    END IF;

    UPDATE public.rooms
    SET status = p_next_status, updated_at = NOW()
    WHERE id = p_room_id;

    RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.advance_room_status(UUID, TEXT) TO authenticated;
