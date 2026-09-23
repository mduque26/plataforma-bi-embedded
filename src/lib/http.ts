import { HttpError } from "../types";

export const json = (body: unknown, status = 200, headers: HeadersInit = {}): Response =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });

export const readJson = async <T>(request: Request): Promise<T> => {
  const type = request.headers.get("content-type") || "";
  if (!type.includes("application/json")) throw new HttpError(415, "invalid_content_type", "Envie JSON válido.");
  try {
    return await request.json<T>();
  } catch {
    throw new HttpError(400, "invalid_json", "O corpo da requisição não é um JSON válido.");
  }
};

export const requiredString = (value: unknown, field: string, max = 250): string => {
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, "invalid_field", `O campo ${field} é obrigatório.`);
  return value.trim().slice(0, max);
};

export const randomToken = (size = 32): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

export const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const correlationId = (request: Request): string => request.headers.get("cf-ray") || crypto.randomUUID();

export const errorResponse = (error: unknown, request: Request): Response => {
  const id = correlationId(request);
  if (error instanceof HttpError) return json({ error: { code: error.code, message: error.message, correlationId: id } }, error.status);
  console.error("unhandled_request_error", { correlationId: id, error });
  return json({ error: { code: "internal_error", message: "Não foi possível concluir a solicitação.", correlationId: id } }, 500);
};
