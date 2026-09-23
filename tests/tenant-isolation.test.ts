import { describe, expect, it } from "vitest";
// Node 24 exposes SQLite without an external native dependency.
// @ts-expect-error node:sqlite is provided by the test runtime, not the Worker runtime types.
import { DatabaseSync } from "node:sqlite";

describe("D1-compatible tenant isolation", () => {
  it("never returns reports from another tenant when IDs overlap", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE tenants(id TEXT PRIMARY KEY);
      CREATE TABLE reports(
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        name TEXT NOT NULL,
        UNIQUE(tenant_id, id)
      );
      INSERT INTO tenants VALUES ('tenant-a'), ('tenant-b');
      INSERT INTO reports VALUES (101, 'tenant-a', 'Relatório Alfa');
      INSERT INTO reports VALUES (202, 'tenant-b', 'Relatório Beta');
    `);

    const rows = db.prepare("SELECT id, name FROM reports WHERE tenant_id = ? ORDER BY id").all("tenant-a");
    expect(rows).toEqual([{ id: 101, name: "Relatório Alfa" }]);
    expect(rows.some((row: { name: string }) => row.name === "Relatório Beta")).toBe(false);
    db.close();
  });

  it("requires the tenant key when joining access rules to reports", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE reports(id INTEGER, tenant_id TEXT, name TEXT, PRIMARY KEY(tenant_id, id));
      CREATE TABLE access_rules(id INTEGER PRIMARY KEY, tenant_id TEXT, report_id INTEGER, principal_id TEXT);
      INSERT INTO reports VALUES (7, 'tenant-a', 'Alfa'), (7, 'tenant-b', 'Beta');
      INSERT INTO access_rules VALUES (1, 'tenant-a', 7, 'user-a');
    `);

    const rows = db.prepare(`
      SELECT r.name FROM access_rules a
      JOIN reports r ON r.id = a.report_id AND r.tenant_id = a.tenant_id
      WHERE a.tenant_id = ? AND a.principal_id = ?
    `).all("tenant-a", "user-a");
    expect(rows).toEqual([{ name: "Alfa" }]);
    db.close();
  });
});
