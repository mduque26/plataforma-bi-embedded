export const mergeRlsRoles = (serializedRules: string[]): string[] => {
  const roles = new Set<string>();
  for (const value of serializedRules) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (!Array.isArray(parsed)) continue;
      for (const role of parsed) if (typeof role === "string" && role.trim()) roles.add(role.trim());
    } catch {
      // Ignore malformed legacy data instead of granting broader access.
    }
  }
  return [...roles].sort((left, right) => left.localeCompare(right));
};
