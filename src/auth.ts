import type { Env, Identity, TenantConfig } from "./types";
import { HttpError } from "./types";
import { json, randomToken, readJson, sha256 } from "./lib/http";

const COOKIE = "bi_session";
const cookieValue = (request: Request, name: string): string | null => {
  const entry = (request.headers.get("cookie") || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null;
};

const sessionCookie = (token: string, secure: boolean, maxAge = 28_800): string =>
  `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;

export const sessionTokenHash = async (env: Env, token: string): Promise<string> => {
  if (!env.SESSION_SECRET) {
    if (env.APP_ENV === "production") throw new HttpError(500, "session_secret_missing", "SESSION_SECRET não configurado.");
    return sha256(token);
  }
  if (env.SESSION_SECRET.length < 32) throw new HttpError(500, "session_secret_weak", "SESSION_SECRET deve ter ao menos 32 caracteres.");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const getIdentity = async (request: Request, env: Env, tenant: TenantConfig): Promise<Identity | null> => {
  const token = cookieValue(request, COOKIE);
  if (!token) return null;
  const hash = await sessionTokenHash(env, token);
  const row = await env.DB.prepare(`
    SELECT u.id user_id, u.entra_object_id, u.upn, u.display_name, u.is_admin
    FROM sessions s JOIN users u ON u.id=s.user_id AND u.tenant_id=s.tenant_id
    WHERE s.id_hash=? AND s.tenant_id=? AND s.expires_at > CURRENT_TIMESTAMP
  `).bind(hash, tenant.id).first<Record<string, string | number>>();
  if (!row) return null;
  return {
    tenantId: tenant.id,
    userId: Number(row.user_id),
    objectId: String(row.entra_object_id),
    upn: String(row.upn),
    displayName: String(row.display_name),
    isAdmin: Number(row.is_admin) === 1,
    groupIds: [],
  };
};

export const requireIdentity = async (request: Request, env: Env, tenant: TenantConfig): Promise<Identity> => {
  const identity = await getIdentity(request, env, tenant);
  if (!identity) throw new HttpError(401, "authentication_required", "Entre para continuar.");
  return identity;
};

const issueSession = async (env: Env, tenantId: string, userId: number): Promise<string> => {
  const token = randomToken(40);
  await env.DB.prepare(
    "INSERT INTO sessions(id_hash, tenant_id, user_id, expires_at) VALUES(?, ?, ?, datetime('now', '+8 hours'))",
  ).bind(await sessionTokenHash(env, token), tenantId, userId).run();
  return token;
};

const upsertUser = async (env: Env, tenantId: string, profile: { id: string; upn: string; displayName: string }, admin: boolean): Promise<number> => {
  await env.DB.prepare(`
    INSERT INTO users(tenant_id, entra_object_id, upn, display_name, is_admin, last_login_at)
    VALUES(?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(tenant_id, entra_object_id) DO UPDATE SET
      upn=excluded.upn, display_name=excluded.display_name, last_login_at=CURRENT_TIMESTAMP
  `).bind(tenantId, profile.id, profile.upn, profile.displayName, admin ? 1 : 0).run();
  const user = await env.DB.prepare("SELECT id FROM users WHERE tenant_id=? AND entra_object_id=?").bind(tenantId, profile.id).first<{ id: number }>();
  if (!user) throw new Error("Failed to create user");
  return user.id;
};

export const pkceChallenge = async (verifier: string): Promise<string> => {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

export const exchangeAuthorizationCode = async (
  env: Env,
  tenant: TenantConfig,
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<{ access_token: string }> => {
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant.entraTenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: tenant.entraClientId,
      client_secret: env.ENTRA_CLIENT_SECRET || "",
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      scope: "openid profile email User.Read GroupMember.Read.All",
    }),
  });
  if (!response.ok) throw new HttpError(502, "azure_token_failed", "O Microsoft Entra ID recusou a troca do código.");
  return response.json<{ access_token: string }>();
};

export const handleAuth = async (request: Request, url: URL, env: Env, tenant: TenantConfig): Promise<Response | null> => {
  if (url.pathname === "/api/auth/me" && request.method === "GET") {
    return json({ user: await getIdentity(request, env, tenant) });
  }

  if (url.pathname === "/api/auth/dev" && request.method === "POST") {
    if (env.APP_ENV === "production" || env.DEV_AUTH_ENABLED !== "true") throw new HttpError(404, "not_found", "Rota indisponível.");
    const body = await readJson<{ role?: string }>(request);
    const admin = body.role !== "viewer";
    const userId = await upsertUser(env, tenant.id, {
      id: admin ? "local-admin" : "local-viewer",
      upn: admin ? "admin@local.test" : "viewer@local.test",
      displayName: admin ? "Administrador local" : "Leitor local",
    }, admin);
    const token = await issueSession(env, tenant.id, userId);
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(token, false) });
  }

  if (url.pathname === "/api/auth/login" && request.method === "GET") {
    if (!tenant.entraTenantId || !tenant.entraClientId || !env.ENTRA_CLIENT_SECRET) {
      throw new HttpError(503, "azure_not_configured", "Configure o Microsoft Entra ID para habilitar o login.");
    }
    const state = randomToken();
    const verifier = randomToken(64);
    const returnTo = url.searchParams.get("returnTo")?.startsWith("/") ? url.searchParams.get("returnTo")! : "/";
    await env.DB.prepare(
      "INSERT INTO oauth_states(state_hash, tenant_id, code_verifier, return_to, expires_at) VALUES(?, ?, ?, ?, datetime('now', '+10 minutes'))",
    ).bind(await sha256(state), tenant.id, verifier, returnTo).run();
    const redirectUri = `${env.APP_BASE_URL || url.origin}/api/auth/callback`;
    const authorize = new URL(`https://login.microsoftonline.com/${encodeURIComponent(tenant.entraTenantId)}/oauth2/v2.0/authorize`);
    authorize.search = new URLSearchParams({
      client_id: tenant.entraClientId,
      response_type: "code",
      redirect_uri: redirectUri,
      response_mode: "query",
      scope: "openid profile email User.Read GroupMember.Read.All",
      state,
      code_challenge: await pkceChallenge(verifier),
      code_challenge_method: "S256",
    }).toString();
    return Response.redirect(authorize.toString(), 302);
  }

  if (url.pathname === "/api/auth/callback" && request.method === "GET") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) throw new HttpError(400, "oauth_callback_invalid", "Retorno do Microsoft Entra ID inválido.");
    const stateHash = await sha256(state);
    const saved = await env.DB.prepare(
      "SELECT code_verifier, return_to FROM oauth_states WHERE state_hash=? AND tenant_id=? AND expires_at > CURRENT_TIMESTAMP",
    ).bind(stateHash, tenant.id).first<{ code_verifier: string; return_to: string }>();
    if (!saved) throw new HttpError(400, "oauth_state_invalid", "A tentativa de login expirou. Inicie novamente.");
    await env.DB.prepare("DELETE FROM oauth_states WHERE state_hash=?").bind(stateHash).run();
    const tokens = await exchangeAuthorizationCode(env, tenant, code, saved.code_verifier, `${env.APP_BASE_URL || url.origin}/api/auth/callback`);
    const graphEndpoint = env.GRAPH_API_ENDPOINT || "https://graph.microsoft.com/v1.0";
    const graph = await fetch(`${graphEndpoint}/me?$select=id,displayName,userPrincipalName,mail`, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    if (!graph.ok) throw new HttpError(502, "graph_profile_failed", "Não foi possível carregar o perfil no Microsoft Graph.");
    const me = await graph.json<{ id: string; displayName: string; userPrincipalName?: string; mail?: string }>();
    const userId = await upsertUser(env, tenant.id, { id: me.id, upn: me.userPrincipalName || me.mail || me.id, displayName: me.displayName }, false);
    const token = await issueSession(env, tenant.id, userId);
    return new Response(null, { status: 302, headers: { location: saved.return_to, "set-cookie": sessionCookie(token, env.APP_ENV === "production") } });
  }

  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    const token = cookieValue(request, COOKIE);
    if (token) await env.DB.prepare("DELETE FROM sessions WHERE id_hash=?").bind(await sessionTokenHash(env, token)).run();
    return json({ ok: true }, 200, { "set-cookie": sessionCookie("", env.APP_ENV === "production", 0) });
  }
  return null;
};
