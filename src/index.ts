import type { Env } from "./types";
import { HttpError } from "./types";
import { handleAuth, requireIdentity } from "./auth";
import { handleBi } from "./bi";
import { publicConfig, resolveTenant } from "./lib/config";
import { errorResponse, json } from "./lib/http";
import { getBrandAsset, handleBranding } from "./branding";

const assertTrustedMutation = (request: Request, env: Env): void => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  if (!origin) return;
  const allowedOrigins = new Set([new URL(env.APP_BASE_URL || request.url).origin]);
  if (env.APP_ENV !== "production") allowedOrigins.add(new URL(request.url).origin);
  if (!allowedOrigins.has(origin)) throw new HttpError(403, "origin_not_allowed", "Origem não autorizada.");
};

const securityHeaders = (response: Response): Response => {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://api.powerbi.com https://graph.microsoft.com https://login.microsoftonline.com; frame-src https://app.powerbi.com; frame-ancestors 'self'; base-uri 'self'; form-action 'self' https://login.microsoftonline.com");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (!url.pathname.startsWith("/api/")) return securityHeaders(await env.ASSETS.fetch(request));
      assertTrustedMutation(request, env);
      const tenant = await resolveTenant(request, env);
      if (url.pathname === "/api/health") return securityHeaders(json({ ok: true, service: "shipbi" }));
      if (url.pathname === "/api/config") return securityHeaders(json(publicConfig(tenant, env)));
      const brandAsset = await getBrandAsset(url, env, tenant);
      if (brandAsset) return securityHeaders(brandAsset);
      const auth = await handleAuth(request, url, env, tenant);
      if (auth) return securityHeaders(auth);
      const identity = await requireIdentity(request, env, tenant);
      const branding = await handleBranding(request, url, env, tenant, identity);
      if (branding) return securityHeaders(branding);
      const bi = await handleBi(request, url, env, tenant, identity);
      return securityHeaders(bi || json({ error: { code: "not_found", message: "Rota não encontrada." } }, 404));
    } catch (error) {
      return securityHeaders(errorResponse(error, request));
    }
  },
} satisfies ExportedHandler<Env>;
