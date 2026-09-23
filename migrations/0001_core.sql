PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  entra_tenant_id TEXT,
  entra_client_id TEXT,
  primary_color TEXT NOT NULL DEFAULT '#1F4E78',
  accent_color TEXT NOT NULL DEFAULT '#2F6FA7',
  logo_url TEXT,
  custom_css TEXT,
  theme_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(theme_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entra_object_id TEXT NOT NULL,
  upn TEXT NOT NULL,
  display_name TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0 CHECK(is_admin IN (0, 1)),
  last_login_at TEXT,
  UNIQUE(tenant_id, entra_object_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code_verifier TEXT NOT NULL,
  return_to TEXT NOT NULL DEFAULT '/',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bi_departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  display_order INTEGER NOT NULL DEFAULT 100,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, slug)
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  department_id INTEGER REFERENCES bi_departments(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  pbi_workspace_id TEXT NOT NULL,
  pbi_report_id TEXT NOT NULL,
  pbi_dataset_id TEXT,
  embed_url TEXT NOT NULL,
  description TEXT,
  category TEXT,
  icon TEXT NOT NULL DEFAULT 'analytics',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, pbi_workspace_id, pbi_report_id),
  UNIQUE(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS access_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  report_id INTEGER NOT NULL,
  entra_group_id TEXT,
  entra_user_id TEXT,
  rls_role TEXT,
  rls_expression TEXT,
  principal_id TEXT NOT NULL,
  principal_type TEXT NOT NULL CHECK(principal_type IN ('entra_group', 'entra_user')),
  principal_name TEXT NOT NULL,
  rls_roles_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(rls_roles_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id, report_id) REFERENCES reports(tenant_id, id) ON DELETE CASCADE,
  CHECK(
    (principal_type = 'entra_group' AND entra_group_id IS NOT NULL AND entra_user_id IS NULL) OR
    (principal_type = 'entra_user' AND entra_user_id IS NOT NULL AND entra_group_id IS NULL)
  ),
  UNIQUE(tenant_id, report_id, principal_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_object_id TEXT,
  actor_upn TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(details_json)),
  correlation_id TEXT NOT NULL,
  timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expiry ON oauth_states(expires_at);
CREATE INDEX IF NOT EXISTS idx_reports_tenant_active ON reports(tenant_id, is_active, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_principal ON access_rules(tenant_id, principal_type, principal_id);
CREATE INDEX IF NOT EXISTS idx_access_rules_tenant_report ON access_rules(tenant_id, report_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_timestamp ON audit_logs(tenant_id, timestamp DESC);
