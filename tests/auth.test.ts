import { afterEach, describe, expect, it, vi } from "vitest";
import { exchangeAuthorizationCode, pkceChallenge, sessionTokenHash } from "../src/auth";
import type { Env, TenantConfig } from "../src/types";

const tenant: TenantConfig = {
  id: "tenant-a",
  slug: "tenant-a",
  name: "Tenant A",
  entraTenantId: "YOUR_TENANT_ID",
  entraClientId: "YOUR_CLIENT_ID",
  theme: {},
};

describe("OAuth 2.0 Authorization Code with PKCE", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("generates the RFC 7636 S256 challenge", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    await expect(pkceChallenge(verifier)).resolves.toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("exchanges the code using the stored verifier and confidential client", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code_verifier")).toBe("verifier-123");
      expect(body.get("client_id")).toBe("YOUR_CLIENT_ID");
      expect(body.get("client_secret")).toBe("YOUR_CLIENT_SECRET");
      expect(body.get("redirect_uri")).toBe("https://portal.example.test/api/auth/callback");
      return Response.json({ access_token: "token" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await exchangeAuthorizationCode(
      { ENTRA_CLIENT_SECRET: "YOUR_CLIENT_SECRET" } as Env,
      tenant,
      "authorization-code",
      "verifier-123",
      "https://portal.example.test/api/auth/callback",
    );

    expect(result.access_token).toBe("token");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toContain("YOUR_TENANT_ID/oauth2/v2.0/token");
  });

  it("peppers session identifiers with the deployment secret", async () => {
    const first = await sessionTokenHash({ SESSION_SECRET: "a".repeat(32) } as Env, "session-token");
    const second = await sessionTokenHash({ SESSION_SECRET: "b".repeat(32) } as Env, "session-token");
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toBe(second);
  });
});
