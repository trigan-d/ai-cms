-- ===========================================================================
-- ai-cms control-plane — schema
-- ===========================================================================
-- Tables only. RLS + triggers in 0002.
-- Pattern mirrors kv12chat: profiles 1:1 with auth.users, owner-scoped resources.

-- ---------------------------------------------------------------------------
-- profiles: 1-to-1 with auth.users (the site owners / clients)
-- ---------------------------------------------------------------------------
CREATE TABLE public.profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- tenants: one small website per row, owned by one profile.
--   subdomain is the 3rd-level label (acme -> acme.platform.ru), globally unique.
--   The site's files live in a git repo on disk keyed by tenant id (not in PG).
-- ---------------------------------------------------------------------------
CREATE TABLE public.tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subdomain   text NOT NULL UNIQUE
              CHECK (subdomain ~ '^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$'),
  owner_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title       text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tenants_owner ON public.tenants(owner_id);
