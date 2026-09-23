import { describe, expect, it } from "vitest";
import { accessRulesAuditDetails, catalogAuditDetails, safeAuditDetails } from "../src/lib/audit";

describe("audit detail minimization", () => {
  it("exposes only allowlisted catalog fields", () => {
    const details = catalogAuditDetails("catalog_updated", { name: "Antes", workspaceId: "private" }, { name: "Depois", workspaceId: "private-2" });
    expect(details.changes).toEqual([{ field: "name", before: "Antes", after: "Depois" }]);
  });

  it("describes access additions, removals and RLS changes without IDs", () => {
    const details = accessRulesAuditDetails(
      [{ principalId: "secret-a", principalType: "entra_user", principalName: "Leitor", rlsRoles: ["Brasil"] }],
      [
        { principalId: "secret-a", principalType: "entra_user", principalName: "Leitor", rlsRoles: ["Brasil", "Financeiro"] },
        { principalId: "secret-b", principalType: "entra_group", principalName: "Gestores", rlsRoles: ["Gestores"] },
      ],
    );
    expect(JSON.stringify(details)).not.toContain("secret-");
    expect(details.accessRules.added).toHaveLength(1);
    expect(details.accessRules.updated[0].afterRlsRoles).toEqual(["Brasil", "Financeiro"]);
  });

  it("rejects arbitrary raw detail objects", () => {
    expect(safeAuditDetails({ token: "private", workspaceId: "private" })).toEqual({ kind: "generic" });
  });
});
