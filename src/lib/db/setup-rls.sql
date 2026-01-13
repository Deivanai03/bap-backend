-- Enable Row Level Security
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_tracking ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY org_isolation_policy ON organizations
    USING (id::text = current_setting('app.org_id', true));

CREATE POLICY user_org_isolation ON users
    USING (org_id::text = current_setting('app.org_id', true));

CREATE POLICY session_org_isolation ON user_sessions
    USING (org_id::text = current_setting('app.org_id', true));

CREATE POLICY audit_org_isolation ON audit_events
    USING (org_id::text = current_setting('app.org_id', true) OR org_id IS NULL);

CREATE POLICY subscription_org_isolation ON subscriptions
    USING (org_id::text = current_setting('app.org_id', true));

CREATE POLICY invoice_org_isolation ON invoices
    USING (org_id::text = current_setting('app.org_id', true));

CREATE POLICY payment_method_org_isolation ON payment_methods
    USING (org_id::text = current_setting('app.org_id', true));

CREATE POLICY usage_tracking_org_isolation ON usage_tracking
    USING (org_id::text = current_setting('app.org_id', true));

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

-- Billing table indexes
CREATE INDEX IF NOT EXISTS idx_plans_slug ON plans(slug);
CREATE INDEX IF NOT EXISTS idx_plans_tier ON plans(tier) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_plans_active ON plans(is_active);

CREATE INDEX IF NOT EXISTS idx_subscriptions_org ON subscriptions(org_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe ON subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_period ON subscriptions(current_period_end) WHERE status IN ('active', 'trialing');

CREATE INDEX IF NOT EXISTS idx_invoices_org ON invoices(org_id);
CREATE INDEX IF NOT EXISTS idx_invoices_subscription ON invoices(subscription_id);
CREATE INDEX IF NOT EXISTS idx_invoices_stripe ON invoices(stripe_invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_issued ON invoices(issued_at);
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);

CREATE INDEX IF NOT EXISTS idx_payment_methods_org ON payment_methods(org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payment_methods_stripe ON payment_methods(stripe_payment_method_id);
CREATE INDEX IF NOT EXISTS idx_payment_methods_default ON payment_methods(org_id, is_default) WHERE is_default = TRUE;

CREATE INDEX IF NOT EXISTS idx_usage_tracking_org ON usage_tracking(org_id);
CREATE INDEX IF NOT EXISTS idx_usage_tracking_period ON usage_tracking(org_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_usage_tracking_metric ON usage_tracking(metric_name, period_start);
CREATE INDEX IF NOT EXISTS idx_usage_tracking_recorded ON usage_tracking(recorded_at);

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
