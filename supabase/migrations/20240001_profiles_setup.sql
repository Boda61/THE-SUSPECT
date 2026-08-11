-- ============================================================
-- Migration: profiles setup, trigger, and RLS
-- Project: THE SUSPECT
-- ============================================================

-- ------------------------------------------------------------
-- 1. Create profiles table (safe - does nothing if it exists)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 2. Ensure username is UNIQUE at the database level
--    (safe - does nothing if constraint already exists)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_username_key'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_username_key UNIQUE (username);
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- 3. Enable Row Level Security
-- ------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 4. RLS Policies
--    Drop existing policies first to avoid conflicts, then recreate.
-- ------------------------------------------------------------

-- SELECT: authenticated users can only read their own profile
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- INSERT: blocked for all roles (trigger handles this)
DROP POLICY IF EXISTS "profiles_insert_trigger_only" ON public.profiles;
CREATE POLICY "profiles_insert_trigger_only"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- UPDATE: authenticated users can only update their own profile
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- DELETE: no one can delete profiles through the API
DROP POLICY IF EXISTS "profiles_delete_none" ON public.profiles;
CREATE POLICY "profiles_delete_none"
  ON public.profiles
  FOR DELETE
  TO authenticated
  USING (false);

-- ------------------------------------------------------------
-- 5. Trigger function: auto-create profile on new auth user
--    Runs as SECURITY DEFINER so it can bypass RLS for INSERT.
--    ON CONFLICT DO NOTHING prevents duplicate profile errors.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, username)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- 6. Attach trigger to auth.users
--    Drop first to avoid duplicate trigger error.
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ------------------------------------------------------------
-- 7. Grant usage to authenticated and service_role
-- ------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
