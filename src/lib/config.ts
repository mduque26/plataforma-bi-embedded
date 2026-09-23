import type { Env, TenantConfig } from "../types";

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  entra_tenant_id: string | null;
  entra_client_id: string | null;
  theme_json: string;
}

export const resolveTenant = async (request: Request, env: Env): Promise<TenantConfig> => {
  const requested = request.headers.get("x-tenant")?.trim() || env.DEFAULT_TENANT_SLUG || "empresa-alfa";
  const row = await env.DB.prepare(
    "SELECT id, name, slug, entra_tenant_id, entra_client_id, theme_json FROM tenants WHERE slug = ? OR id = ? LIMIT 1",
  ).bind(requested, requested).first<TenantRow>();
  if (!row) throw new Error(`Unknown tenant: ${requested}`);
  let theme: Record<string, unknown> = {};
  try { theme = JSON.parse(row.theme_json); } catch { theme = {}; }
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    entraTenantId: row.entra_tenant_id || env.ENTRA_TENANT_ID || "",
    entraClientId: row.entra_client_id || env.ENTRA_CLIENT_ID || "",
    theme,
  };
};

export const publicConfig = (tenant: TenantConfig, env: Env) => ({
  tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, theme: tenant.theme },
  auth: {
    devEnabled: env.APP_ENV !== "production" && env.DEV_AUTH_ENABLED === "true",
    azureConfigured: Boolean(tenant.entraTenantId && tenant.entraClientId && env.ENTRA_CLIENT_SECRET),
  },
  powerBi: { strategy: env.POWERBI_TOKEN_STRATEGY || "service_principal" },
});
