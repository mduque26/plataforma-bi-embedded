import type { Env, Identity, TenantConfig } from "./types";
import { HttpError } from "./types";
import { diagnosePowerBiRlsBypass, generateEmbedConfig, graphGroupsForUser, inspectPowerBiRls, listPowerBiReports, listPowerBiWorkspaces, searchGraphPrincipals } from "./azure";
import { correlationId, json, readJson, requiredString } from "./lib/http";
import { mergeRlsRoles } from "./lib/rls";
import { accessRulesAuditDetails, catalogAuditDetails, safeAuditDetails, type PublicAccessRule } from "./lib/audit";

interface CatalogRow {
  id: number; department_id: number | null; department_name: string | null; department_slug: string | null;
  workspace_id: string; report_id: string; dataset_id: string | null; embed_url: string;
  name: string; description: string | null; is_active: number; metadata_json: string;
}

interface AccessRuleRow {
  principal_id: string;
  principal_type: "entra_group" | "entra_user";
  principal_name: string;
  rls_roles_json: string;
}

const parseMetadata = (value: string): Record<string, unknown> => { try { return JSON.parse(value); } catch { return {}; } };
const publicItem = (row: CatalogRow) => ({
  id: row.id,
  departmentId: row.department_id,
  department: row.department_name ? { name: row.department_name, slug: row.department_slug } : null,
  workspaceId: row.workspace_id,
  reportId: row.report_id,
  datasetId: row.dataset_id,
  embedUrl: row.embed_url,
  name: row.name,
  description: row.description,
  isActive: row.is_active === 1,
  metadata: parseMetadata(row.metadata_json),
});

const queryCatalog = `SELECT c.*, c.pbi_workspace_id workspace_id, c.pbi_report_id report_id, c.pbi_dataset_id dataset_id, d.name department_name, d.slug department_slug
  FROM reports c LEFT JOIN bi_departments d ON d.id=c.department_id
  WHERE c.tenant_id=?`;

const audit = async (env: Env, identity: Identity, request: Request, action: string, targetType: string, targetId: string | null, details: unknown, before: unknown = null, after: unknown = null) => {
  await env.DB.prepare(`INSERT INTO audit_logs
    (tenant_id,user_id,actor_object_id,actor_upn,action,target_type,target_id,details_json,before_json,after_json,correlation_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(identity.tenantId, identity.userId, identity.objectId, identity.upn, action, targetType, targetId, JSON.stringify(details), before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, correlationId(request)).run();
};

const accessRuleView = (row: AccessRuleRow): PublicAccessRule & { principalId: string } => ({
  principalId: row.principal_id,
  principalType: row.principal_type,
  principalName: row.principal_name,
  rlsRoles: mergeRlsRoles([row.rls_roles_json]),
});

const requireAdmin = (identity: Identity) => {
  if (!identity.isAdmin) throw new HttpError(403, "admin_required", "Esta operação exige perfil administrador.");
};

const identityPrincipals = async (env: Env, tenant: TenantConfig, identity: Identity): Promise<string[]> => {
  const groups = await graphGroupsForUser(env, tenant, identity);
  return [identity.objectId, ...groups];
};

const canAccess = async (env: Env, tenant: TenantConfig, identity: Identity, itemId: number): Promise<{ allowed: boolean; roles: string[] }> => {
  if (identity.isAdmin) return { allowed: true, roles: [] };
  const principals = await identityPrincipals(env, tenant, identity);
  if (!principals.length) return { allowed: false, roles: [] };
  const placeholders = principals.map(() => "?").join(",");
  const rules = await env.DB.prepare(
    `SELECT rls_roles_json FROM access_rules WHERE tenant_id=? AND report_id=? AND principal_id IN (${placeholders})`,
  ).bind(tenant.id, itemId, ...principals).all<{ rls_roles_json: string }>();
  return { allowed: rules.results.length > 0, roles: mergeRlsRoles(rules.results.map((rule) => rule.rls_roles_json)) };
};

export const handleBi = async (request: Request, url: URL, env: Env, tenant: TenantConfig, identity: Identity): Promise<Response | null> => {
  const base = "/api/bi";

  if (url.pathname === `${base}/departments` && request.method === "GET") {
    const rows = await env.DB.prepare("SELECT id,name,slug,description,display_order displayOrder,is_active isActive FROM bi_departments WHERE tenant_id=? ORDER BY display_order,name")
      .bind(tenant.id).all();
    return json({ items: rows.results });
  }

  if (url.pathname === `${base}/catalog` && request.method === "GET") {
    const rows = await env.DB.prepare(`${queryCatalog} AND c.is_active=1 ORDER BY d.display_order,c.name`).bind(tenant.id).all<CatalogRow>();
    if (identity.isAdmin) return json({ items: rows.results.map(publicItem) });
    const visible = [];
    for (const row of rows.results) if ((await canAccess(env, tenant, identity, row.id)).allowed) visible.push(publicItem(row));
    return json({ items: visible });
  }

  const embed = url.pathname.match(/^\/api\/bi\/reports\/(\d+)\/embed-config$/);
  if (embed && request.method === "GET") {
    const id = Number(embed[1]);
    const row = await env.DB.prepare(`${queryCatalog} AND c.id=? AND c.is_active=1`).bind(tenant.id, id).first<CatalogRow>();
    if (!row) throw new HttpError(404, "report_not_found", "Relatório não encontrado.");
    const access = await canAccess(env, tenant, identity, id);
    if (!access.allowed) throw new HttpError(403, "report_forbidden", "Você não tem acesso a este relatório.");
    if (publicItem(row).metadata.rlsRequired === true && access.roles.length === 0) {
      throw new HttpError(403, "rls_role_required", "Este relatório exige um papel RLS explícito.");
    }
    await audit(env, identity, request, "dashboard.accessed", "catalog_item", String(id), { kind: "generic" });
    if (env.APP_ENV !== "production" && row.report_id.startsWith("demo-")) return json({ demo: true, report: publicItem(row) });
    const config = await generateEmbedConfig(env, tenant, row, identity, access.roles);
    return json(config);
  }

  if (url.pathname === `${base}/admin/catalog` && request.method === "GET") {
    requireAdmin(identity);
    const rows = await env.DB.prepare(`${queryCatalog} ORDER BY c.updated_at DESC`).bind(tenant.id).all<CatalogRow>();
    return json({ items: rows.results.map(publicItem) });
  }

  if (url.pathname === `${base}/admin/catalog` && request.method === "POST") {
    requireAdmin(identity);
    const body = await readJson<Record<string, unknown>>(request);
    const input = {
      name: requiredString(body.name, "name"), workspaceId: requiredString(body.workspaceId, "workspaceId"),
      reportId: requiredString(body.reportId, "reportId"), embedUrl: requiredString(body.embedUrl, "embedUrl", 2000),
      datasetId: typeof body.datasetId === "string" ? body.datasetId.trim() : null,
      description: typeof body.description === "string" ? body.description.trim() : null,
      departmentId: Number.isInteger(Number(body.departmentId)) && Number(body.departmentId) > 0 ? Number(body.departmentId) : null,
      label: body.label === "confidential" ? "confidential" : "standard",
    };
    const inspection = await inspectPowerBiRls(env,tenant,input.workspaceId,input.reportId,input.datasetId);
    const metadata = { label: input.label, confidential: input.label === "confidential", rls: inspection.rlsConfigured ? { mode: "static_roles", roles: inspection.roles.map((role) => role.name) } : { mode: "none", roles: [] } };
    const result = await env.DB.prepare(`INSERT INTO reports
      (tenant_id,department_id,pbi_workspace_id,pbi_report_id,pbi_dataset_id,embed_url,name,description,metadata_json)
      VALUES(?,?,?,?,?,?,?,?,?)`).bind(tenant.id,input.departmentId,input.workspaceId,input.reportId,inspection.datasetId || input.datasetId,input.embedUrl,input.name,input.description,JSON.stringify(metadata)).run();
    const selectedDepartment = input.departmentId ? await env.DB.prepare("SELECT name FROM bi_departments WHERE tenant_id=? AND id=?").bind(tenant.id,input.departmentId).first<{name:string}>() : null;
    const publicInput = { name: input.name, description: input.description, departmentName: selectedDepartment?.name || null, isActive: true, label: input.label };
    await audit(env, identity, request, "catalog.created", "catalog_item", String(result.meta.last_row_id), catalogAuditDetails("catalog_created", null, publicInput), null, publicInput);
    return json({ id: result.meta.last_row_id }, 201);
  }

  const catalogItem = url.pathname.match(/^\/api\/bi\/admin\/catalog\/(\d+)$/);
  if (catalogItem && request.method === "PATCH") {
    requireAdmin(identity);
    const id = Number(catalogItem[1]);
    const previous = await env.DB.prepare(`${queryCatalog} AND c.id=?`).bind(tenant.id, id).first<CatalogRow>();
    if (!previous) throw new HttpError(404, "report_not_found", "Relatório não encontrado.");
    const body = await readJson<Record<string, unknown>>(request);
    const name = requiredString(body.name, "name");
    const description = typeof body.description === "string" ? body.description.trim() : null;
    const active = body.isActive === false ? 0 : 1;
    const workspaceId = typeof body.workspaceId === "string" ? requiredString(body.workspaceId, "workspaceId") : previous.workspace_id;
    const reportId = typeof body.reportId === "string" ? requiredString(body.reportId, "reportId") : previous.report_id;
    const datasetId = typeof body.datasetId === "string" ? body.datasetId.trim() || null : previous.dataset_id;
    const embedUrl = typeof body.embedUrl === "string" ? requiredString(body.embedUrl, "embedUrl", 2000) : previous.embed_url;
    const departmentId = Object.hasOwn(body,"departmentId") ? (Number.isInteger(Number(body.departmentId)) && Number(body.departmentId) > 0 ? Number(body.departmentId) : null) : previous.department_id;
    const referenceChanged = workspaceId !== previous.workspace_id || reportId !== previous.report_id || datasetId !== previous.dataset_id;
    if (referenceChanged) {
      const rule = await env.DB.prepare("SELECT id FROM access_rules WHERE tenant_id=? AND report_id=? LIMIT 1").bind(tenant.id,id).first();
      if (rule) throw new HttpError(409, "catalog_reference_has_access_rules", "Remova todas as regras de acesso antes de alterar workspace, relatório ou dataset.");
    }
    const metadata = parseMetadata(previous.metadata_json);
    const label = body.label === "confidential" ? "confidential" : body.label === "standard" ? "standard" : metadata.label || "standard";
    const nextMetadata: Record<string,unknown> = { ...metadata, label, confidential: label === "confidential" };
    if (referenceChanged) {
      const inspection = await inspectPowerBiRls(env,tenant,workspaceId,reportId,datasetId);
      nextMetadata.rls = inspection.rlsConfigured ? { mode: "static_roles", roles: inspection.roles.map((role) => role.name) } : { mode: "none", roles: [] };
    }
    const result = await env.DB.prepare("UPDATE reports SET name=?,description=?,department_id=?,pbi_workspace_id=?,pbi_report_id=?,pbi_dataset_id=?,embed_url=?,is_active=?,metadata_json=?,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND id=?")
      .bind(name, description, departmentId, workspaceId, reportId, datasetId, embedUrl, active, JSON.stringify(nextMetadata), tenant.id, id).run();
    if (!result.meta.changes) throw new HttpError(404, "report_not_found", "Relatório não encontrado.");
    const before = { name: previous.name, description: previous.description, departmentName: previous.department_name, isActive: previous.is_active === 1, label: parseMetadata(previous.metadata_json).label ?? null };
    const department = departmentId ? await env.DB.prepare("SELECT name FROM bi_departments WHERE tenant_id=? AND id=?").bind(tenant.id,departmentId).first<{name:string}>() : null;
    const after = { ...before, name, description, departmentName: department?.name || null, isActive: Boolean(active), label };
    await audit(env, identity, request, "catalog.updated", "catalog_item", String(id), catalogAuditDetails("catalog_updated", before, after), before, after);
    return json({ ok: true });
  }

  const ruleRoute = url.pathname.match(/^\/api\/bi\/admin\/catalog\/(\d+)\/access-rules$/);
  if (ruleRoute && request.method === "GET") {
    requireAdmin(identity);
    const rows = await env.DB.prepare("SELECT id,principal_id principalId,principal_type principalType,principal_name principalName,rls_roles_json rlsRolesJson FROM access_rules WHERE tenant_id=? AND report_id=? ORDER BY principal_name")
      .bind(tenant.id, Number(ruleRoute[1])).all<Record<string, unknown>>();
    return json({ items: rows.results.map((row) => ({ ...row, rlsRoles: JSON.parse(String(row.rlsRolesJson || "[]")), rlsRolesJson: undefined })) });
  }

  if (ruleRoute && request.method === "PUT") {
    requireAdmin(identity);
    const itemId = Number(ruleRoute[1]);
    const body = await readJson<{ rules?: Array<Record<string, unknown>> }>(request);
    if (!Array.isArray(body.rules) || body.rules.length > 200) throw new HttpError(400, "invalid_rules", "Informe até 200 regras de acesso.");
    const catalog = await env.DB.prepare(`${queryCatalog} AND c.id=?`).bind(tenant.id,itemId).first<CatalogRow>();
    if (!catalog) throw new HttpError(404,"report_not_found","Relatório não encontrado.");
    const inspection = await inspectPowerBiRls(env,tenant,catalog.workspace_id,catalog.report_id,catalog.dataset_id);
    const allowedRoles = new Set(inspection.roles.map((role) => role.name));
    const existing = await env.DB.prepare("SELECT principal_id,principal_type,principal_name,rls_roles_json FROM access_rules WHERE tenant_id=? AND report_id=?")
      .bind(tenant.id, itemId).all<AccessRuleRow>();
    const statements = [env.DB.prepare("DELETE FROM access_rules WHERE tenant_id=? AND report_id=?").bind(tenant.id,itemId)];
    const nextRules: Array<PublicAccessRule & { principalId: string }> = [];
    for (const rule of body.rules) {
      const type = rule.principalType === "entra_group" ? "entra_group" : "entra_user";
      const roles = Array.isArray(rule.rlsRoles) ? rule.rlsRoles.filter((role): role is string => typeof role === "string").slice(0, 50) : [];
      if (inspection.rlsConfigured && !roles.length) throw new HttpError(400,"rls_role_required","Relatórios com RLS exigem ao menos um papel por principal.");
      if (roles.some((role) => !allowedRoles.has(role))) throw new HttpError(400,"rls_role_invalid","Um papel selecionado não existe no modelo semântico atual.");
      statements.push(env.DB.prepare(`INSERT INTO access_rules
        (tenant_id,report_id,principal_id,principal_type,principal_name,rls_roles_json,entra_group_id,entra_user_id,rls_role) VALUES(?,?,?,?,?,?,?,?,?)`)
        .bind(tenant.id,itemId,requiredString(rule.principalId,"principalId"),type,requiredString(rule.principalName,"principalName"),JSON.stringify(roles),type === "entra_group" ? rule.principalId : null,type === "entra_user" ? rule.principalId : null,roles[0] || null));
      nextRules.push({ principalId: String(rule.principalId), principalType: type, principalName: String(rule.principalName), rlsRoles: roles });
    }
    await env.DB.batch(statements);
    const previousRules = existing.results.map(accessRuleView);
    await audit(env, identity, request, "access_rules.replaced", "catalog_item", String(itemId), accessRulesAuditDetails(previousRules, nextRules), previousRules, nextRules);
    return json({ ok: true });
  }

  if (url.pathname === `${base}/admin/workspaces` && request.method === "GET") {
    requireAdmin(identity);
    return json({ items: await listPowerBiWorkspaces(env, tenant) });
  }
  if (url.pathname === `${base}/admin/reports/rls-inspection` && request.method === "POST") {
    requireAdmin(identity);
    const body = await readJson<Record<string, unknown>>(request);
    const result = await inspectPowerBiRls(env, tenant, requiredString(body.workspaceId,"workspaceId"), requiredString(body.reportId,"reportId"), typeof body.datasetId === "string" ? body.datasetId.trim() || null : null);
    return json(result, 200, { "cache-control": "private, no-store" });
  }
  const reports = url.pathname.match(/^\/api\/bi\/admin\/workspaces\/([^/]+)\/reports$/);
  if (reports && request.method === "GET") {
    requireAdmin(identity);
    return json({ items: await listPowerBiReports(env, tenant, decodeURIComponent(reports[1])) });
  }
  if (url.pathname === `${base}/admin/principals` && request.method === "GET") {
    requireAdmin(identity);
    const q = url.searchParams.get("q")?.trim() || "";
    if (q.length < 2) return json({ items: [] });
    const like = `%${q.toLowerCase()}%`;
    const local = await env.DB.prepare("SELECT entra_object_id id,display_name displayName,upn FROM users WHERE tenant_id=? AND (lower(display_name) LIKE ? OR lower(upn) LIKE ?) LIMIT 10")
      .bind(tenant.id,like,like).all<Record<string,string>>();
    if (!tenant.entraTenantId || !tenant.entraClientId || !env.ENTRA_CLIENT_SECRET) return json({ items: local.results.map((item) => ({...item,type:"entra_user"})), directorySource: "local" });
    const graph = await searchGraphPrincipals(env, tenant, q);
    const merged = new Map<string,Record<string,unknown>>();
    for (const item of local.results) merged.set(item.id,{...item,type:"entra_user"});
    for (const item of graph) merged.set(item.id,item);
    return json({ items: [...merged.values()], directorySource: "graph" });
  }
  if (url.pathname === `${base}/admin/departments` && request.method === "GET") {
    requireAdmin(identity);
    const rows = await env.DB.prepare("SELECT id,name,slug,description,display_order displayOrder,is_active isActive FROM bi_departments WHERE tenant_id=? ORDER BY display_order,name").bind(tenant.id).all();
    return json({ items: rows.results });
  }
  if (url.pathname === `${base}/admin/departments` && request.method === "POST") {
    requireAdmin(identity);
    const body = await readJson<Record<string, unknown>>(request);
    const name = requiredString(body.name,"name");
    const existing = await env.DB.prepare("SELECT id,name,slug,description,display_order displayOrder,is_active isActive FROM bi_departments WHERE tenant_id=? AND lower(name)=lower(?) LIMIT 1").bind(tenant.id,name).first();
    if (existing) return json({ item: existing });
    const normalizedSlug = name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"").slice(0,80);
    const slug = normalizedSlug || `area-${crypto.randomUUID().slice(0,8)}`;
    const result = await env.DB.prepare("INSERT INTO bi_departments(tenant_id,name,slug,description,display_order) VALUES(?,?,?,?,?)")
      .bind(tenant.id,name,slug,typeof body.description === "string" ? body.description.trim() : null,100).run();
    return json({ item: { id: result.meta.last_row_id, name, slug, description: body.description || null, displayOrder: 100, isActive: 1 } },201);
  }
  const rolesRoute = url.pathname.match(/^\/api\/bi\/admin\/catalog\/(\d+)\/rls-roles$/);
  if (rolesRoute && request.method === "GET") {
    requireAdmin(identity);
    const item = await env.DB.prepare(`${queryCatalog} AND c.id=?`).bind(tenant.id,Number(rolesRoute[1])).first<CatalogRow>();
    if (!item) throw new HttpError(404,"report_not_found","Relatório não encontrado.");
    const result = await inspectPowerBiRls(env,tenant,item.workspace_id,item.report_id,item.dataset_id);
    return json({ roles: result.roles, rlsConfigured: result.rlsConfigured, source: result.source },200,{"cache-control":"private, no-store"});
  }
  if (url.pathname === `${base}/admin/audit` && request.method === "GET") {
    requireAdmin(identity);
    const limit = Number(url.searchParams.get("limit") || "100");
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new HttpError(400, "audit_limit_invalid", "O limite deve estar entre 1 e 500.");
    const filters = ["tenant_id=?"];
    const bindings: Array<string | number> = [tenant.id];
    const addFilter = (parameter: string, column: string) => {
      const value = url.searchParams.get(parameter)?.trim();
      if (value) { filters.push(`${column}=?`); bindings.push(value); }
    };
    addFilter("action", "action"); addFilter("targetId", "target_id"); addFilter("actorObjectId", "actor_object_id");
    const rows = await env.DB.prepare(`SELECT id,actor_object_id actorObjectId,actor_upn actorUpn,action,target_type targetType,target_id targetId,details_json detailsJson,correlation_id correlationId,timestamp createdAt FROM audit_logs WHERE ${filters.join(" AND ")} ORDER BY timestamp DESC,id DESC LIMIT ?`)
      .bind(...bindings, limit).all<Record<string, unknown>>();
    return json({ items: rows.results.map((row) => ({ ...row, details: safeAuditDetails(parseMetadata(String(row.detailsJson))), detailsJson: undefined })) });
  }
  if (url.pathname === `${base}/admin/access-overview` && request.method === "GET") {
    requireAdmin(identity);
    const rows = await env.DB.prepare(`SELECT ar.report_id catalogItemId,ar.principal_id principalId,ar.principal_type principalType,
      ar.principal_name principalName,ar.rls_roles_json rlsRolesJson,c.name dashboardName,d.name departmentName
      FROM access_rules ar JOIN reports c ON c.id=ar.report_id AND c.tenant_id=ar.tenant_id
      LEFT JOIN bi_departments d ON d.id=c.department_id
      WHERE ar.tenant_id=? ORDER BY ar.principal_name,c.name`).bind(tenant.id).all<Record<string, unknown>>();
    const principals = new Map<string, Record<string, unknown>>();
    const dashboards = new Map<number, Record<string, unknown>>();
    for (const row of rows.results) {
      const key = `${row.principalType}:${row.principalId}`;
      const principal = principals.get(key) || { principalId: row.principalId, principalType: row.principalType, principalName: row.principalName, dashboards: [] };
      (principal.dashboards as unknown[]).push({ catalogItemId: row.catalogItemId, dashboardName: row.dashboardName, departmentName: row.departmentName, rlsRoles: mergeRlsRoles([String(row.rlsRolesJson)]) });
      principals.set(key, principal);
      const dashboardId = Number(row.catalogItemId);
      const dashboard = dashboards.get(dashboardId) || { catalogItemId: dashboardId, dashboardName: row.dashboardName, departmentName: row.departmentName, principals: [] };
      (dashboard.principals as unknown[]).push({ principalId: row.principalId, principalType: row.principalType, principalName: row.principalName, rlsRoles: mergeRlsRoles([String(row.rlsRolesJson)]) });
      dashboards.set(dashboardId, dashboard);
    }
    return json({ principals: [...principals.values()], dashboards: [...dashboards.values()] });
  }
  const diagnostics = url.pathname.match(/^\/api\/bi\/admin\/reports\/(\d+)\/rls-diagnostics$/);
  if (diagnostics && request.method === "GET") {
    requireAdmin(identity);
    const item = await env.DB.prepare(`${queryCatalog} AND c.id=?`).bind(tenant.id, Number(diagnostics[1])).first<CatalogRow>();
    if (!item) throw new HttpError(404, "report_not_found", "Relatório não encontrado.");
    return json(await diagnosePowerBiRlsBypass(env, tenant, item.workspace_id));
  }
  return null;
};
