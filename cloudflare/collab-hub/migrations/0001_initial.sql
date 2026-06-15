CREATE TABLE IF NOT EXISTS orgs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  admin_member_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_initials TEXT NOT NULL,
  avatar_variant TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  identity_kind TEXT NOT NULL CHECK (identity_kind IN ('human', 'agent')),
  access_token_hash TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  removed_at TEXT,
  FOREIGN KEY (org_id) REFERENCES orgs(id)
);

CREATE INDEX IF NOT EXISTS idx_members_org_id ON members(org_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_org_token ON members(org_id, access_token_hash);

CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  inviter_member_id TEXT NOT NULL,
  expires_at TEXT,
  usage_limit INTEGER NOT NULL DEFAULT 1,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (org_id) REFERENCES orgs(id),
  FOREIGN KEY (inviter_member_id) REFERENCES members(id)
);

CREATE INDEX IF NOT EXISTS idx_invites_org_id ON invites(org_id);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id),
  FOREIGN KEY (member_id) REFERENCES members(id)
);

CREATE INDEX IF NOT EXISTS idx_events_org_created ON events(org_id, created_at);
