import { describe, expect, it } from "vitest";
import { requiredString, sha256 } from "../src/lib/http";

describe("HTTP helpers", () => {
  it("normalizes required strings", () => expect(requiredString("  Relatório  ", "name")).toBe("Relatório"));
  it("rejects missing required strings", () => expect(() => requiredString(" ", "name")).toThrow("name"));
  it("hashes deterministically", async () => expect(await sha256("session")).toHaveLength(64));
});
