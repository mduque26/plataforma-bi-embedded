export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_ENV?: string;
  APP_BASE_URL?: string;
  DEV_AUTH_ENABLED?: string;
  DEFAULT_TENANT_SLUG?: string;
  SESSION_SECRET?: string;
  ENTRA_TENANT_ID?: string;
  ENTRA_CLIENT_ID?: string;
  ENTRA_CLIENT_SECRET?: string;
  GRAPH_API_ENDPOINT?: string;
  POWERBI_API_ENDPOINT?: string;
  POWERBI_TOKEN_STRATEGY?: "service_principal" | "delegated";
}

export interface Identity {
  tenantId: string;
  userId: number;
  objectId: string;
  upn: string;
  displayName: string;
  isAdmin: boolean;
  groupIds: string[];
}

export interface TenantConfig {
  id: string;
  name: string;
  slug: string;
  entraTenantId: string;
  entraClientId: string;
  theme: Record<string, unknown>;
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}
