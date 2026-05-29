-- ===========================================================================
-- ai-cms control-plane — RLS, helper trigger
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Auto-create a profile row when a new auth user signs up.
-- (Self-signup is allowed: clients register to build their own sites.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants  ENABLE ROW LEVEL SECURITY;

-- profiles: a user sees and edits only their own row.
-- (Inserts come from the SECURITY DEFINER trigger / service role, not clients.)
CREATE POLICY profiles_select_self ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY profiles_update_self ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- tenants: an owner fully manages only their own tenants.
CREATE POLICY tenants_select_own ON public.tenants
  FOR SELECT TO authenticated
  USING (auth.uid() = owner_id);

CREATE POLICY tenants_insert_own ON public.tenants
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY tenants_update_own ON public.tenants
  FOR UPDATE TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY tenants_delete_own ON public.tenants
  FOR DELETE TO authenticated
  USING (auth.uid() = owner_id);
