import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(":memory:");
for (const file of readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort()) {
  db.exec(readFileSync(`migrations/${file}`, "utf8"));
}
db.exec(readFileSync("seed.sql", "utf8"));

const requiredTables = ["access_rules", "audit_logs", "reports", "tenant_brand_assets", "tenants"];
const actualTables = db.prepare(`
  SELECT name FROM sqlite_master
  WHERE type = 'table' AND name IN (${requiredTables.map(() => "?").join(",")})
  ORDER BY name
`).all(...requiredTables).map((row) => row.name);

if (JSON.stringify(actualTables) !== JSON.stringify([...requiredTables].sort())) {
  throw new Error(`Schema incompleto: ${actualTables.join(", ")}`);
}

const tenants = db.prepare("SELECT slug FROM tenants ORDER BY slug").all();
const reports = db.prepare("SELECT tenant_id, count(*) AS total FROM reports GROUP BY tenant_id ORDER BY tenant_id").all();
if (tenants.length !== 2 || reports.length !== 2) throw new Error("O seed deve criar dois tenants isolados com relatórios.");

console.log(JSON.stringify({ tables: actualTables, tenants, reports }, null, 2));
db.close();
