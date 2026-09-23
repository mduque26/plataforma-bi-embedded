PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_sessions_tenant_expiry ON sessions(tenant_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_users_tenant_upn ON users(tenant_id, upn);
CREATE INDEX IF NOT EXISTS idx_departments_tenant_order ON bi_departments(tenant_id, display_order, name);
