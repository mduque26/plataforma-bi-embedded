export interface PublicAccessRule {
  principalType: "entra_group" | "entra_user";
  principalName: string;
  rlsRoles: string[];
}

type JsonObject = Record<string, unknown>;

const text = (value: unknown): string | null => typeof value === "string" ? value : null;
const bool = (value: unknown): boolean | null => typeof value === "boolean" ? value : null;

const ruleKey = (rule: PublicAccessRule & { principalId?: string }): string =>
  `${rule.principalType}:${rule.principalId || rule.principalName}`;

export const catalogAuditDetails = (
  kind: "catalog_created" | "catalog_updated" | "catalog_deleted",
  before: JsonObject | null,
  after: JsonObject | null,
) => {
  const fields = [
    ["name", "name", text],
    ["description", "description", text],
    ["departmentName", "departmentName", text],
    ["isActive", "isActive", bool],
    ["label", "label", text],
  ] as const;
  const changes = fields.flatMap(([field, key, normalize]) => {
    const previous = normalize(before?.[key]);
    const next = normalize(after?.[key]);
    return previous === next ? [] : [{ field, before: previous, after: next }];
  });
  return { kind, changes };
};

export const accessRulesAuditDetails = (
  before: Array<PublicAccessRule & { principalId?: string }>,
  after: Array<PublicAccessRule & { principalId?: string }>,
) => {
  const previous = new Map(before.map((rule) => [ruleKey(rule), rule]));
  const next = new Map(after.map((rule) => [ruleKey(rule), rule]));
  const clean = (rule: PublicAccessRule): PublicAccessRule => ({
    principalType: rule.principalType,
    principalName: rule.principalName,
    rlsRoles: [...new Set(rule.rlsRoles)].sort(),
  });
  const added = [...next].filter(([key]) => !previous.has(key)).map(([, rule]) => clean(rule));
  const removed = [...previous].filter(([key]) => !next.has(key)).map(([, rule]) => clean(rule));
  const updated = [...next].flatMap(([key, rule]) => {
    const old = previous.get(key);
    if (!old) return [];
    const beforeRoles = [...new Set(old.rlsRoles)].sort();
    const afterRoles = [...new Set(rule.rlsRoles)].sort();
    if (JSON.stringify(beforeRoles) === JSON.stringify(afterRoles)) return [];
    return [{
      principalType: rule.principalType,
      principalName: rule.principalName,
      beforeRlsRoles: beforeRoles,
      afterRlsRoles: afterRoles,
    }];
  });
  return { kind: "access_rules_replaced", accessRules: { added, removed, updated } };
};

export const safeAuditDetails = (value: unknown): JsonObject => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { kind: "generic" };
  const record = value as JsonObject;
  if (["catalog_created", "catalog_updated", "catalog_deleted"].includes(String(record.kind))) {
    const allowed = new Set(["name", "description", "departmentName", "isActive", "label"]);
    const changes = Array.isArray(record.changes) ? record.changes.filter((entry): entry is JsonObject => Boolean(entry && typeof entry === "object" && !Array.isArray(entry)))
      .filter((entry) => allowed.has(String(entry.field)))
      .map((entry) => ({ field: entry.field, before: entry.before ?? null, after: entry.after ?? null })) : [];
    return { kind: record.kind, changes };
  }
  if (record.kind === "access_rules_replaced" && record.accessRules && typeof record.accessRules === "object") {
    const groups = record.accessRules as JsonObject;
    const cleanRules = (items: unknown) => Array.isArray(items) ? items.map((entry) => {
      const rule = entry as JsonObject;
      return { principalType: rule.principalType, principalName: rule.principalName, rlsRoles: Array.isArray(rule.rlsRoles) ? rule.rlsRoles : [] };
    }) : [];
    const cleanUpdates = (items: unknown) => Array.isArray(items) ? items.map((entry) => {
      const rule = entry as JsonObject;
      return { principalType: rule.principalType, principalName: rule.principalName, beforeRlsRoles: Array.isArray(rule.beforeRlsRoles) ? rule.beforeRlsRoles : [], afterRlsRoles: Array.isArray(rule.afterRlsRoles) ? rule.afterRlsRoles : [] };
    }) : [];
    return { kind: record.kind, accessRules: { added: cleanRules(groups.added), removed: cleanRules(groups.removed), updated: cleanUpdates(groups.updated) } };
  }
  return { kind: "generic" };
};
