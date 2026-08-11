-- ============================================================
-- Migration: fix username_exists RPC + fix RLS SELECT policy
-- Project: THE SUSPECT
--
-- Problems found:
--   1. username_exists() returns true for everything because
--      the parameter name 'username' collides with the column
--      name 'profiles.username' in the WHERE clause.
--      PostgreSQL resolves the ambiguity by comparing the column
--      to itself → EXISTS always returns true.
--      Fix: rename parameter to p_username.
--
--   2. RLS SELECT policy allows authenticated users to read ALL
--      profiles instead of only their own.
--      Fix: replace the policy with auth.uid() = id.
--
-- What this does NOT touch:
--   - profiles table structure
--   - profiles_username_key UNIQUE constraint
--   - existing trigger / handle_new_user function
--   - existing data
--   - INSERT / UPDATE / DELETE policies
-- ============================================================

-- ── 1. Fix username_exists RPC ──────────────────────────────
CREATE OR REPLACE FUNCTION public.username_exists(p_username TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.username = TRIM(p_username)
  );
$$;

GRANT EXECUTE ON FUNCTION public.username_exists(TEXT) TO anon, authenticated;

-- ── 2. Fix RLS SELECT policy ────────────────────────────────
-- Drop whatever SELECT policy currently exists and replace it
-- with one that restricts each user to their own profile only.
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'profiles'
      AND cmd        = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles', pol.policyname);
  END LOOP;
END;
$$;

CREATE POLICY "profiles_select_own"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);
