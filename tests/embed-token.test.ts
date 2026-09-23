import { describe, expect, it } from "vitest";
import { buildEmbedTokenRequest } from "../src/azure";

describe("Power BI embed token payload", () => {
  it("includes EffectiveIdentity for a semantic model protected by RLS", () => {
    expect(buildEmbedTokenRequest("dataset-1", "person@example.test", ["Brasil", "Gestores"])).toEqual({
      accessLevel: "View",
      identities: [{
        username: "person@example.test",
        roles: ["Brasil", "Gestores"],
        datasets: ["dataset-1"],
      }],
    });
  });

  it("does not invent an identity when no RLS role was authorized", () => {
    expect(buildEmbedTokenRequest("dataset-1", "person@example.test", [])).toEqual({ accessLevel: "View" });
  });
});
