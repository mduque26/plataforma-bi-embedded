import type { Env, Identity, TenantConfig } from "./types";
import { HttpError } from "./types";
import { clientCredentialToken } from "./azure";
import { correlationId, json, readJson } from "./lib/http";

const assetTypes = ["bannerLogo", "squareLogo", "squareLogoDark", "backgroundImage", "favicon", "headerLogo"] as const;
const safeImageTypes = new Set(["image/png", "image/jpeg", "image/jpg", "image/x-icon", "image/vnd.microsoft.icon"]);
type AssetType = typeof assetTypes[number];

interface BrandingAsset {
  type: AssetType;
  contentType: string;
  bytes: ArrayBuffer;
}

interface BrandingPreview {
  theme: Record<string, unknown>;
  assets: Array<{ type: AssetType; contentType: string; size: number; previewUrl?: string }>;
  notes: string[];
}

const isHex = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
const cleanText = (value: unknown, max = 120): string | undefined => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
const dataUrl = (contentType: string, bytes: ArrayBuffer): string => {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (let offset = 0; offset < view.length; offset += 0x8000) binary += String.fromCharCode(...view.subarray(offset, offset + 0x8000));
  return `data:${contentType};base64,${btoa(binary)}`;
};

export const normalizeTheme = (input: unknown, current: Record<string, unknown> = {}): Record<string, unknown> => {
  const value = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const next: Record<string, unknown> = { ...current };
  const productName = cleanText(value.productName, 80);
  const logoText = cleanText(value.logoText, 4)?.toUpperCase();
  const signInPageText = cleanText(value.signInPageText, 280);
  const radius = Number(value.radius);
  if (productName) next.productName = productName;
  if (logoText) next.logoText = logoText;
  if (signInPageText) next.signInPageText = signInPageText; else delete next.signInPageText;
  for (const key of ["accent", "canvas", "surface", "text", "muted"] as const) if (isHex(value[key])) next[key] = value[key];
  if (Number.isFinite(radius)) next.radius = Math.min(24, Math.max(4, Math.round(radius)));
  return next;
};

const graphGet = async (url: string, token: string): Promise<Response> => fetch(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json, image/*" } });

const readEntraBranding = async (env: Env, tenant: TenantConfig): Promise<{ preview: BrandingPreview; assets: BrandingAsset[] }> => {
  if (!tenant.entraTenantId || !tenant.entraClientId || !env.ENTRA_CLIENT_SECRET) throw new HttpError(503, "azure_not_configured", "Configure o Microsoft Entra antes de importar a identidade visual.");
  const token = await clientCredentialToken(env, tenant, "https://graph.microsoft.com/.default");
  const brandingUrl = `${env.GRAPH_API_ENDPOINT || "https://graph.microsoft.com/v1.0"}/organization/${encodeURIComponent(tenant.entraTenantId)}/branding`;
  const brandingResponse = await graphGet(brandingUrl, token);
  if (brandingResponse.status === 404) throw new HttpError(404, "entra_branding_not_found", "Este tenant ainda não possui identidade visual configurada no Microsoft Entra.");
  if (!brandingResponse.ok) throw new HttpError(502, "entra_branding_failed", "O Microsoft Graph recusou a leitura da identidade. Conceda OrganizationalBranding.Read.All ao aplicativo.");
  const branding = await brandingResponse.json<Record<string, unknown>>();
  let organizationName = tenant.name;
  const organizationResponse = await graphGet(`${env.GRAPH_API_ENDPOINT || "https://graph.microsoft.com/v1.0"}/organization?$select=displayName`, token);
  if (organizationResponse.ok) {
    const organization = await organizationResponse.json<{ value?: Array<{ displayName?: string }> }>();
    organizationName = cleanText(organization.value?.[0]?.displayName, 80) || organizationName;
  }
  const theme = normalizeTheme({
    productName: organizationName,
    logoText: organizationName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join(""),
    accent: isHex(branding.headerBackgroundColor) ? branding.headerBackgroundColor : branding.backgroundColor,
    signInPageText: branding.signInPageText,
  }, tenant.theme);
  theme.brandingSource = "entra";
  theme.brandingSyncedAt = new Date().toISOString();
  const assets: BrandingAsset[] = [];
  const notes: string[] = [];
  await Promise.all(assetTypes.map(async (type) => {
    const response = await graphGet(`${brandingUrl}/localizations/default/${type}`, token);
    if (response.status === 404 || response.status === 204) return;
    if (!response.ok) { notes.push(`${type}: indisponível`); return; }
    const contentType = response.headers.get("content-type")?.split(";")[0] || "application/octet-stream";
    if (!safeImageTypes.has(contentType.toLowerCase())) { notes.push(`${type}: formato ignorado`); return; }
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength) return;
    if (bytes.byteLength > 1_500_000) { notes.push(`${type}: excede 1,5 MB`); return; }
    assets.push({ type, contentType, bytes });
  }));
  const available = new Set(assets.map((asset) => asset.type));
  if (available.has("squareLogo")) theme.logoAsset = "squareLogo";
  else if (available.has("bannerLogo")) theme.logoAsset = "bannerLogo";
  if (available.has("squareLogoDark")) theme.logoDarkAsset = "squareLogoDark";
  if (available.has("backgroundImage")) theme.backgroundAsset = "backgroundImage";
  if (available.has("favicon")) theme.faviconAsset = "favicon";
  return {
    preview: {
      theme,
      assets: assets.map((asset) => ({
        type: asset.type,
        contentType: asset.contentType,
        size: asset.bytes.byteLength,
        previewUrl: ["squareLogo", "bannerLogo", "headerLogo"].includes(asset.type) && asset.bytes.byteLength <= 512_000 ? dataUrl(asset.contentType, asset.bytes) : undefined,
      })),
      notes,
    },
    assets,
  };
};

const auditBranding = async (env: Env, identity: Identity, request: Request, source: string) => {
  await env.DB.prepare(`INSERT INTO audit_logs
    (tenant_id,user_id,actor_object_id,actor_upn,action,target_type,target_id,details_json,correlation_id)
    VALUES(?,?,?,?,?,?,?,?,?)`).bind(identity.tenantId, identity.userId, identity.objectId, identity.upn, "tenant.branding_updated", "tenant", identity.tenantId, JSON.stringify({ kind: "branding_updated", source }), correlationId(request)).run();
};

export const getBrandAsset = async (url: URL, env: Env, tenant: TenantConfig): Promise<Response | null> => {
  const match = url.pathname.match(/^\/api\/branding\/assets\/([A-Za-z]+)$/);
  if (!match || !assetTypes.includes(match[1] as AssetType)) return null;
  const row = await env.DB.prepare("SELECT content_type contentType, content FROM tenant_brand_assets WHERE tenant_id=? AND asset_type=?")
    .bind(tenant.id, match[1]).first<{ contentType: string; content: ArrayBuffer }>();
  if (!row) throw new HttpError(404, "brand_asset_not_found", "Ativo visual não encontrado.");
  return new Response(row.content, { headers: { "content-type": row.contentType, "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" } });
};

export const handleBranding = async (request: Request, url: URL, env: Env, tenant: TenantConfig, identity: Identity): Promise<Response | null> => {
  if (!url.pathname.startsWith("/api/admin/branding")) return null;
  if (!identity.isAdmin) throw new HttpError(403, "admin_required", "Esta operação exige perfil administrador.");
  if (url.pathname === "/api/admin/branding" && request.method === "PATCH") {
    const body = await readJson<{ theme?: unknown }>(request);
    const theme = normalizeTheme(body.theme, tenant.theme);
    theme.brandingSource = "manual";
    theme.brandingSyncedAt = new Date().toISOString();
    await env.DB.prepare("UPDATE tenants SET theme_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(JSON.stringify(theme), tenant.id).run();
    await auditBranding(env, identity, request, "manual");
    return json({ theme });
  }
  if (url.pathname === "/api/admin/branding/import-entra" && request.method === "POST") {
    const { preview, assets } = await readEntraBranding(env, tenant);
    if (url.searchParams.get("mode") === "preview") return json(preview, 200, { "cache-control": "private, no-store" });
    const statements = [
      env.DB.prepare("UPDATE tenants SET theme_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(JSON.stringify(preview.theme), tenant.id),
      env.DB.prepare("DELETE FROM tenant_brand_assets WHERE tenant_id=?").bind(tenant.id),
      ...assets.map((asset) => env.DB.prepare("INSERT INTO tenant_brand_assets(tenant_id,asset_type,content_type,content) VALUES(?,?,?,?)")
        .bind(tenant.id, asset.type, asset.contentType, asset.bytes)),
    ];
    await env.DB.batch(statements);
    await auditBranding(env, identity, request, "entra");
    return json({ theme: preview.theme, assets: preview.assets.map(({ previewUrl: _previewUrl, ...asset }) => asset), notes: preview.notes });
  }
  return null;
};
