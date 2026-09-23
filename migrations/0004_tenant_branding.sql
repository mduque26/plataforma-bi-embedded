PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenant_brand_assets (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL CHECK(asset_type IN ('bannerLogo', 'squareLogo', 'squareLogoDark', 'backgroundImage', 'favicon', 'headerLogo')),
  content_type TEXT NOT NULL,
  content BLOB NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, asset_type)
);

CREATE INDEX IF NOT EXISTS idx_brand_assets_tenant ON tenant_brand_assets(tenant_id);
