ALTER TABLE audit_logs ADD COLUMN before_json TEXT CHECK(before_json IS NULL OR json_valid(before_json));
ALTER TABLE audit_logs ADD COLUMN after_json TEXT CHECK(after_json IS NULL OR json_valid(after_json));

CREATE INDEX IF NOT EXISTS idx_audit_tenant_action_date
  ON audit_logs(tenant_id, action, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_audit_tenant_target_date
  ON audit_logs(tenant_id, target_id, timestamp DESC);
