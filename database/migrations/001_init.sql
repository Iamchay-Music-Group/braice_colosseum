-- BRAICE Database Schema
-- Initialize PostgreSQL database with all required tables

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT UNIQUE,
  email TEXT,
  display_name TEXT NOT NULL,
  user_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Communities table
CREATE TABLE IF NOT EXISTS communities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  operator_id UUID NOT NULL REFERENCES users(id),
  governance_config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Memberships table
CREATE TABLE IF NOT EXISTS memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id),
  user_id UUID NOT NULL REFERENCES users(id),
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(community_id, user_id)
);

-- Activity records table (PROTECTED - individual level data)
CREATE TABLE IF NOT EXISTS activity_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id),
  member_id UUID NOT NULL REFERENCES users(id),
  activity_type TEXT NOT NULL,
  interest_category TEXT NOT NULL,
  metadata JSONB,
  occurred_at TIMESTAMPTZ NOT NULL
);

-- Community datasets table (aggregated intelligence)
CREATE TABLE IF NOT EXISTS community_datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id),
  dataset_type TEXT NOT NULL,
  version INTEGER NOT NULL,
  data JSONB NOT NULL,
  source_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Access requests table
CREATE TABLE IF NOT EXISTS access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id),
  requester_id UUID NOT NULL REFERENCES users(id),
  dataset_id UUID NOT NULL REFERENCES community_datasets(id),
  purpose TEXT NOT NULL,
  operation TEXT NOT NULL,
  requested_duration_seconds INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Governance decisions table
CREATE TABLE IF NOT EXISTS governance_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_request_id UUID NOT NULL REFERENCES access_requests(id),
  decision TEXT NOT NULL,
  approved_by JSONB NOT NULL,
  approval_count INTEGER,
  threshold INTEGER,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  blockchain_tx TEXT
);

-- Permissions table (central BRAICE object)
CREATE TABLE IF NOT EXISTS permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_request_id UUID NOT NULL REFERENCES access_requests(id),
  principal_id UUID NOT NULL REFERENCES users(id),
  resource_id UUID NOT NULL REFERENCES community_datasets(id),
  purpose TEXT NOT NULL,
  operation TEXT NOT NULL,
  conditions JSONB,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  policy_hash TEXT,
  blockchain_reference TEXT
);

-- Audit events table
CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID REFERENCES communities(id),
  actor_id UUID REFERENCES users(id),
  event_type TEXT NOT NULL,
  resource_id UUID,
  permission_id UUID,
  metadata JSONB,
  blockchain_tx TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_memberships_community ON memberships(community_id);
CREATE INDEX idx_memberships_user ON memberships(user_id);
CREATE INDEX idx_activity_community ON activity_records(community_id);
CREATE INDEX idx_activity_member ON activity_records(member_id);
CREATE INDEX idx_datasets_community ON community_datasets(community_id);
CREATE INDEX idx_access_requests_community ON access_requests(community_id);
CREATE INDEX idx_access_requests_requester ON access_requests(requester_id);
CREATE INDEX idx_governance_access_request ON governance_decisions(access_request_id);
CREATE INDEX idx_permissions_principal ON permissions(principal_id);
CREATE INDEX idx_permissions_resource ON permissions(resource_id);
CREATE INDEX idx_permissions_status ON permissions(status);
CREATE INDEX idx_audit_community ON audit_events(community_id);
CREATE INDEX idx_audit_event_type ON audit_events(event_type);
