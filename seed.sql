PRAGMA foreign_keys = ON;

INSERT OR REPLACE INTO tenants(
  id, slug, name, entra_tenant_id, entra_client_id, primary_color, accent_color, logo_url, custom_css, theme_json
) VALUES
  ('tenant-alfa', 'empresa-alfa', 'Empresa Alfa', NULL, NULL, '#17365D', '#2F6FA7', NULL, NULL,
   '{"productName":"Alfa Intelligence","logoText":"AI","accent":"#17365D","canvas":"#F1F5F9","surface":"#FFFFFF","text":"#172235","muted":"#66758A"}'),
  ('tenant-beta', 'empresa-beta', 'Empresa Beta', NULL, NULL, '#065F46', '#10B981', NULL, NULL,
   '{"productName":"Beta Insights","logoText":"BI","accent":"#065F46","canvas":"#ECFDF5","surface":"#FFFFFF","text":"#16332B","muted":"#60756E"}');

INSERT OR IGNORE INTO bi_departments(tenant_id, name, slug, description, display_order) VALUES
  ('tenant-alfa', 'Executivo', 'executivo', 'Indicadores estratégicos e acompanhamento de metas.', 10),
  ('tenant-alfa', 'Operações', 'operacoes', 'Qualidade, capacidade e eficiência operacional.', 20),
  ('tenant-beta', 'Comercial', 'comercial', 'Desempenho de vendas e carteira.', 10);

INSERT OR IGNORE INTO reports(
  tenant_id, department_id, pbi_workspace_id, pbi_report_id, pbi_dataset_id, embed_url,
  name, description, category, icon, is_active, metadata_json
)
SELECT 'tenant-alfa', id, 'demo-workspace', 'demo-alfa-executive', 'demo-alfa-dataset', 'about:blank',
       'Visão executiva', 'Resumo corporativo para acompanhamento da liderança.', 'Estratégia', 'monitoring', 1,
       '{"featured":true,"refreshStatus":"Completed"}'
FROM bi_departments WHERE tenant_id='tenant-alfa' AND slug='executivo';

INSERT OR IGNORE INTO reports(
  tenant_id, department_id, pbi_workspace_id, pbi_report_id, pbi_dataset_id, embed_url,
  name, description, category, icon, is_active, metadata_json
)
SELECT 'tenant-beta', id, 'demo-workspace', 'demo-beta-commercial', 'demo-beta-dataset', 'about:blank',
       'Performance comercial', 'Pipeline, conversão e receita recorrente.', 'Vendas', 'query_stats', 1,
       '{"featured":true,"refreshStatus":"Completed"}'
FROM bi_departments WHERE tenant_id='tenant-beta' AND slug='comercial';

INSERT OR IGNORE INTO users(tenant_id, entra_object_id, upn, display_name, is_admin)
VALUES
  ('tenant-alfa', 'local-viewer-alfa', 'viewer.alfa@example.test', 'Leitor Alfa', 0),
  ('tenant-beta', 'local-viewer-beta', 'viewer.beta@example.test', 'Leitor Beta', 0);

INSERT OR IGNORE INTO access_rules(
  tenant_id, report_id, principal_id, principal_type, principal_name, rls_roles_json,
  entra_user_id, rls_role
)
SELECT 'tenant-alfa', id, 'local-viewer-alfa', 'entra_user', 'Leitor Alfa', '["DemoReader"]',
       'local-viewer-alfa', 'DemoReader'
FROM reports WHERE tenant_id='tenant-alfa' AND pbi_report_id='demo-alfa-executive';

INSERT OR IGNORE INTO access_rules(
  tenant_id, report_id, principal_id, principal_type, principal_name, rls_roles_json,
  entra_group_id, rls_role
)
SELECT 'tenant-beta', id, 'demo-beta-sales-group', 'entra_group', 'Equipe Comercial Beta', '["DemoManager"]',
       'demo-beta-sales-group', 'DemoManager'
FROM reports WHERE tenant_id='tenant-beta' AND pbi_report_id='demo-beta-commercial';
