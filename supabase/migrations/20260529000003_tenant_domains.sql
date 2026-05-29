-- ===========================================================================
-- ai-cms — custom domains (R5)
-- ===========================================================================
-- A tenant can attach custom domains (e.g. www.acme-shop.ru) in addition to its
-- platform subdomain. Caddy issues certs on-demand only for VERIFIED domains
-- (see /api/tls/allowed). Verification + serving resolution use the service role.

CREATE TABLE public.tenant_domains (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  host        text NOT NULL UNIQUE CHECK (host = lower(host)),
  verified    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tenant_domains_tenant ON public.tenant_domains(tenant_id);

ALTER TABLE public.tenant_domains ENABLE ROW LEVEL SECURITY;

-- Owner manages domains of their own tenants. (verified flips via service role.)
CREATE POLICY tenant_domains_select_own ON public.tenant_domains
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = tenant_id AND t.owner_id = auth.uid()));

CREATE POLICY tenant_domains_insert_own ON public.tenant_domains
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = tenant_id AND t.owner_id = auth.uid()));

CREATE POLICY tenant_domains_delete_own ON public.tenant_domains
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = tenant_id AND t.owner_id = auth.uid()));
