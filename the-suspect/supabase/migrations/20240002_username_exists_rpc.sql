-- ============================================================
-- Migration: username availability check RPC
-- Project: THE SUSPECT
-- 
-- What this does:
--   Adds a single SECURITY DEFINER function that lets the
--   frontend check username availability BEFORE signup.
--   This bypasses RLS safely (returns boolean only, no user data).
--
-- What this does NOT touch:
--   - profiles table structure
--   - profiles_username_key UNIQUE constraint
--   - existing trigger / handle_new_user function
--   - existing RLS policies
--   - any existing data
-- ============================================================

CREATE OR REPLACE FUNCTION public.username_exists(username TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.username = TRIM(username)
  );
$$;

-- Allow anon and authenticated roles to call this function
GRANT EXECUTE ON FUNCTION public.username_exists(TEXT) TO anon, authenticated;
