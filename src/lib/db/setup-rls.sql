-- Enable Row Level Security
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY org_isolation_policy ON organizations
    USING (id::text = current_setting('app.org_id', true));

CREATE POLICY user_org_isolation ON users
    USING (org_id::text = current_setting('app.org_id', true));

CREATE POLICY session_org_isolation ON user_sessions
    USING (org_id::text = current_setting('app.org_id', true));

CREATE POLICY audit_org_isolation ON audit_events
    USING (org_id::text = current_setting('app.org_id', true) OR org_id IS NULL);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_organizations_status ON organizations(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_organizations_home_region ON organizations(home_region);
CREATE INDEX IF NOT EXISTS idx_organizations_billing_country ON organizations(billing_country);

CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_magic_link ON users(magic_link_token) WHERE magic_link_token IS NOT NULL;

-- Unique email per org (from documentation)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_org_email ON users(org_id, LOWER(email)) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_audit_events_org ON audit_events(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_user ON audit_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_type ON audit_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_resource ON audit_events(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_compliance ON audit_events(gdpr_relevant, hipaa_relevant) WHERE gdpr_relevant = TRUE OR hipaa_relevant = TRUE;

-- Note: Partitioning by month for performance
-- ALTER TABLE audit_events PARTITION BY RANGE (created_at);

-- Email immutability constraint
CREATE OR REPLACE FUNCTION prevent_email_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.email IS DISTINCT FROM NEW.email THEN
        RAISE EXCEPTION 'Email cannot be changed once set';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_user_email_change
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION prevent_email_change();
