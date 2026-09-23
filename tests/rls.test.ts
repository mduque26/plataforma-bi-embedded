import { describe, expect, it } from "vitest";
import { mergeRlsRoles } from "../src/lib/rls";

describe("mergeRlsRoles", () => {
  it("combines roles from user and group rules without duplicates", () => {
    expect(mergeRlsRoles(['["Financeiro","Brasil"]', '["Brasil","Gestores"]'])).toEqual([
      "Brasil", "Financeiro", "Gestores",
    ]);
  });

  it("ignores malformed input and blank roles", () => {
    expect(mergeRlsRoles(["invalid", '["", "  ", 12, "Leitores"]'])).toEqual(["Leitores"]);
  });
});
