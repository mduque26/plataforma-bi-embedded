import type { Env, Identity, TenantConfig } from "./types";
import { HttpError } from "./types";

interface TokenCacheEntry { token: string; expiresAt: number }
const tokenCache = new Map<string, TokenCacheEntry>();
const graphEndpoint = (env: Env) => (env.GRAPH_API_ENDPOINT || "https://graph.microsoft.com/v1.0").replace(/\/$/, "");
const powerBiEndpoint = (env: Env) => (env.POWERBI_API_ENDPOINT || "https://api.powerbi.com/v1.0/myorg").replace(/\/$/, "");

export const clientCredentialToken = async (env: Env, tenant: TenantConfig, scope: string): Promise<string> => {
  if (!tenant.entraTenantId || !tenant.entraClientId || !env.ENTRA_CLIENT_SECRET) {
    throw new HttpError(503, "azure_not_configured", "Credenciais Azure não configuradas para este tenant.");
  }
  const key = `${tenant.id}:${scope}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant.entraTenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: tenant.entraClientId,
      client_secret: env.ENTRA_CLIENT_SECRET,
      grant_type: "client_credentials",
      scope,
    }),
  });
  if (!response.ok) throw new HttpError(502, "azure_app_token_failed", "A Azure recusou a autenticação da aplicação.");
  const payload = await response.json<{ access_token: string; expires_in: number }>();
  tokenCache.set(key, { token: payload.access_token, expiresAt: Date.now() + payload.expires_in * 1000 });
  return payload.access_token;
};

const providerJson = async <T>(url: string, token: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers || {}) },
  });
  if (!response.ok) {
    const providerText = (await response.text()).slice(0, 500);
    console.error("azure_provider_error", { status: response.status, url, providerText });
    throw new HttpError(502, "azure_provider_failed", "A Azure ou o Power BI recusou a operação.");
  }
  return response.json<T>();
};

export const graphGroupsForUser = async (env: Env, tenant: TenantConfig, identity: Identity): Promise<string[]> => {
  if (env.APP_ENV !== "production" && identity.objectId.startsWith("local-")) return [];
  const token = await clientCredentialToken(env, tenant, "https://graph.microsoft.com/.default");
  const result = await providerJson<{ value: Array<{ id: string }> }>(
    `${graphEndpoint(env)}/users/${encodeURIComponent(identity.objectId)}/transitiveMemberOf/microsoft.graph.group?$select=id`, token,
  );
  return result.value.map((entry) => entry.id);
};

export const searchGraphPrincipals = async (env: Env, tenant: TenantConfig, query: string) => {
  const token = await clientCredentialToken(env, tenant, "https://graph.microsoft.com/.default");
  const safe = query.replaceAll("'", "''");
  const [users, groups] = await Promise.all([
    providerJson<{ value: Array<Record<string, string>> }>(
      `${graphEndpoint(env)}/users?$select=id,displayName,userPrincipalName,mail&$top=10&$filter=startswith(displayName,'${encodeURIComponent(safe)}')`, token,
    ),
    providerJson<{ value: Array<Record<string, string>> }>(
      `${graphEndpoint(env)}/groups?$select=id,displayName&$top=10&$filter=startswith(displayName,'${encodeURIComponent(safe)}')`, token,
    ),
  ]);
  return [
    ...users.value.map((item) => ({ id: item.id, displayName: item.displayName, type: "entra_user", upn: item.userPrincipalName || item.mail })),
    ...groups.value.map((item) => ({ id: item.id, displayName: item.displayName, type: "entra_group" })),
  ];
};

const powerBiToken = (env: Env, tenant: TenantConfig) => clientCredentialToken(env, tenant, "https://analysis.windows.net/powerbi/api/.default");

export const listPowerBiWorkspaces = async (env: Env, tenant: TenantConfig) => {
  const token = await powerBiToken(env, tenant);
  const result = await providerJson<{ value: Array<{ id: string; name: string }> }>(`${powerBiEndpoint(env)}/groups?$top=5000`, token);
  return result.value;
};

export const listPowerBiReports = async (env: Env, tenant: TenantConfig, workspaceId: string) => {
  const token = await powerBiToken(env, tenant);
  const result = await providerJson<{ value: Array<{ id: string; name: string; embedUrl: string; datasetId?: string; webUrl?: string }> }>(
    `${powerBiEndpoint(env)}/groups/${encodeURIComponent(workspaceId)}/reports`, token,
  );
  return result.value;
};

export const diagnosePowerBiRlsBypass = async (env: Env, tenant: TenantConfig, workspaceId: string) => {
  if (env.APP_ENV !== "production" && workspaceId === "demo-workspace") return { supported: true, warnings: [] };
  const token = await powerBiToken(env, tenant);
  const result = await providerJson<{ value: Array<{ identifier?: string; displayName?: string; groupUserAccessRight?: string; principalType?: string }> }>(
    `${powerBiEndpoint(env)}/groups/${encodeURIComponent(workspaceId)}/users`, token,
  );
  const elevated = new Set(["Admin", "Member", "Contributor"]);
  return {
    supported: true,
    warnings: result.value.filter((entry) => elevated.has(entry.groupUserAccessRight || "")).map((entry) => ({
      code: "rls_workspace_role_bypass",
      accessRight: entry.groupUserAccessRight,
      principalName: entry.displayName || entry.identifier || "Principal do workspace",
      principalType: entry.principalType || null,
    })),
  };
};

export const inspectPowerBiRls = async (env: Env, tenant: TenantConfig, workspaceId: string, reportId: string, datasetId: string | null) => {
  if (env.APP_ENV !== "production" && workspaceId === "demo-workspace") {
    return { workspaceId, reportId, datasetId, rlsConfigured: true, roles: [{ name: "DemoManager" }, { name: "DemoReader" }], source: "powerbi" };
  }
  const reports = await listPowerBiReports(env, tenant, workspaceId);
  const report = reports.find((entry) => entry.id === reportId);
  if (!report) throw new HttpError(404, "powerbi_report_not_found", "O relatório não foi encontrado no workspace selecionado.");
  if (report.datasetId && datasetId && report.datasetId !== datasetId) throw new HttpError(409, "powerbi_dataset_mismatch", "O dataset informado não pertence ao relatório selecionado.");
  const effectiveDatasetId = report.datasetId || datasetId;
  if (!effectiveDatasetId) throw new HttpError(409, "rls_dataset_required", "O dataset é obrigatório para inspecionar RLS.");
  const token = await powerBiToken(env, tenant);
  const dataset = await providerJson<{ isEffectiveIdentityRolesRequired?: boolean }>(
    `${powerBiEndpoint(env)}/groups/${encodeURIComponent(workspaceId)}/datasets/${encodeURIComponent(effectiveDatasetId)}`, token,
  );
  if (dataset.isEffectiveIdentityRolesRequired === false) {
    return { workspaceId, reportId, datasetId: effectiveDatasetId, rlsConfigured: false, roles: [], source: "powerbi" };
  }
  if (dataset.isEffectiveIdentityRolesRequired !== true) throw new HttpError(503, "rls_discovery_unavailable", "O Power BI não confirmou o estado de RLS do modelo.");
  const query = await providerJson<{ results?: Array<{ tables?: Array<{ rows?: Array<Record<string, unknown>> }> }> }>(
    `${powerBiEndpoint(env)}/groups/${encodeURIComponent(workspaceId)}/datasets/${encodeURIComponent(effectiveDatasetId)}/executeQueries`,
    token,
    { method: "POST", body: JSON.stringify({ queries: [{ query: 'EVALUATE SELECTCOLUMNS(INFO.ROLES(), "RoleName", [Name])' }], serializerSettings: { includeNulls: true } }) },
  );
  const names = new Set<string>();
  for (const row of query.results?.[0]?.tables?.[0]?.rows || []) {
    const value = row.RoleName ?? row["[RoleName]"];
    if (typeof value === "string" && value.trim()) names.add(value.trim());
  }
  if (!names.size) throw new HttpError(503, "rls_roles_unavailable", "O modelo exige RLS, mas nenhum papel pôde ser confirmado.");
  return { workspaceId, reportId, datasetId: effectiveDatasetId, rlsConfigured: true, roles: [...names].sort().map((name) => ({ name })), source: "powerbi" };
};

export const generateEmbedConfig = async (
  env: Env,
  tenant: TenantConfig,
  report: { workspace_id: string; report_id: string; dataset_id: string | null; embed_url: string },
  identity: Identity,
  rlsRoles: string[],
) => {
  const token = await powerBiToken(env, tenant);
  const body = buildEmbedTokenRequest(report.dataset_id, identity.upn, rlsRoles);
  const generated = await providerJson<{ token: string; expiration: string }>(
    `${powerBiEndpoint(env)}/groups/${encodeURIComponent(report.workspace_id)}/reports/${encodeURIComponent(report.report_id)}/GenerateToken`,
    token,
    { method: "POST", body: JSON.stringify(body) },
  );
  return {
    type: "report",
    tokenType: "Embed",
    reportId: report.report_id,
    workspaceId: report.workspace_id,
    embedUrl: report.embed_url,
    accessToken: generated.token,
    expiration: generated.expiration,
    settings: { panes: { filters: { visible: false }, pageNavigation: { visible: true } }, background: "Transparent" },
  };
};

export const buildEmbedTokenRequest = (datasetId: string | null, username: string, rlsRoles: string[]): Record<string, unknown> => {
  const body: Record<string, unknown> = { accessLevel: "View" };
  if (datasetId && rlsRoles.length) body.identities = [{ username, roles: [...rlsRoles], datasets: [datasetId] }];
  return body;
};
