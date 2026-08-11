-- ============================================================
-- Migration: rooms, room_players tables, RLS policies, and RPCs
-- Project: THE SUSPECT
-- ============================================================

-- ------------------------------------------------------------
-- 1. Create rooms table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rooms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,
  host_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status      TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'starting', 'in_game', 'finished', 'closed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 2. Create room_players table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.room_players (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  display_name  TEXT NOT NULL,
  is_ready      BOOLEAN NOT NULL DEFAULT FALSE,
  is_connected  BOOLEAN NOT NULL DEFAULT TRUE,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT room_players_room_id_user_id_key UNIQUE (room_id, user_id)
);

-- ------------------------------------------------------------
-- 3. Enable RLS
-- ------------------------------------------------------------
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_players ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 4. RLS Policies for rooms
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view rooms they belong to" ON public.rooms;
CREATE POLICY "Users can view rooms they belong to"
  ON public.rooms FOR SELECT
  TO authenticated
  USING (
    host_id = auth.uid() OR
    id IN (SELECT room_id FROM public.room_players WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Host can update their rooms" ON public.rooms;
CREATE POLICY "Host can update their rooms"
  ON public.rooms FOR UPDATE
  TO authenticated
  USING (host_id = auth.uid());

-- ------------------------------------------------------------
-- 5. RLS Policies for room_players
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view room players in their rooms" ON public.room_players;
CREATE POLICY "Users can view room players in their rooms"
  ON public.room_players FOR SELECT
  TO authenticated
  USING (
    room_id IN (SELECT room_id FROM public.room_players WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can update own room player status" ON public.room_players;
CREATE POLICY "Users can update own room player status"
  ON public.room_players FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

-- ------------------------------------------------------------
-- 6. RPC: create_room
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_room(p_code TEXT, p_display_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_room_id UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Create room
    INSERT INTO public.rooms (code, host_id)
    VALUES (p_code, v_user_id)
    RETURNING id INTO v_room_id;

    -- Add host as player
    INSERT INTO public.room_players (room_id, user_id, display_name)
    VALUES (v_room_id, v_user_id, p_display_name);

    RETURN v_room_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_room(TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 7. RPC: join_room
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_room(p_code TEXT, p_display_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_room_id UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT id INTO v_room_id FROM public.rooms WHERE code = p_code AND status = 'waiting';
    IF v_room_id IS NULL THEN
        RAISE EXCEPTION 'Room not found or not in waiting status';
    END IF;

    INSERT INTO public.room_players (room_id, user_id, display_name)
    VALUES (v_room_id, v_user_id, p_display_name)
    ON CONFLICT (room_id, user_id) DO UPDATE SET is_connected = TRUE, display_name = p_display_name;

    RETURN v_room_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_room(TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 8. RPC: leave_room
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.leave_room(p_room_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    UPDATE public.room_players SET is_connected = FALSE WHERE room_id = p_room_id AND user_id = v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.leave_room(UUID) TO authenticated;
