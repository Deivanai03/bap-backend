# BAP PRODUCT TABLES & APIs

This document defines the product platform tables and APIs for BAP (Business Asset Platform). These tables handle general SaaS functionality: organizations, subscriptions, billing, user settings, announcements, and platform configuration.

**Scope:** Product platform only. Agentic memory systems (Episodic, Semantic, Asset, Purpose Memory) and orchestration (Engine, Agents, Charter) are documented separately.

**Architecture:** Multi-national SaaS on AWS + PostgreSQL with multi-tenant pool model, RLS-based isolation, and future multi-region readiness.

---

## KEY DESIGN DECISIONS

### Authentication
- **Magic Link Only:** Email-based authentication with magic links (no passwords, no MFA)
- **Email Immutability:** User email cannot be changed once registered (unique identifier)
- **Simple & Secure:** Reduces password-related security risks and UX friction

### User Settings (Simplified)
**Profile Settings:**
- Full name (editable)
- Nickname (editable)
- Profile picture (editable)
- Email (read-only, unique per user)

**Preferences (in users table):**
- Workspace language (default: English)
- Theme: System default, Dark, Light
- Font size: Small, Default, Large
- Contrast mode: Toggle
- Notifications: Only 2 toggles
  - "Product updates & tips"
  - "Other useful information"

**NOT Included:**
- Keyboard shortcuts customization (not needed)
- Complex per-channel notification preferences (simplified to 2 toggles)

### Subscription Visibility by Plan Tier
**Individual Plans:**
- Full access to subscription management
- View/manage payment methods
- See payment gateways
- View current and next billing dates
- Track usage limits

**Business/Enterprise Plans:**
- **Only** view usage limits and availability
- **No access** to billing info (managed by organization owner)
- **No visibility** to payment methods, gateways, billing dates

**Rationale:** Individual users manage their own billing. Business/Enterprise billing is centralized at org level for admin control.

---

## TABLE OF CONTENTS

1. [Key Design Decisions](#key-design-decisions)
2. [Architecture Overview](#architecture-overview)
3. [Core Product Tables](#core-product-tables)
4. [Billing & Subscriptions](#billing--subscriptions)
5. [User Settings & Preferences](#user-settings--preferences)
6. [Announcements & Notifications](#announcements--notifications)
7. [Feature Flags & Limits](#feature-flags--limits)
8. [Audit & Compliance](#audit--compliance)
9. [API Specifications](#api-specifications)
10. [Multi-Region Strategy](#multi-region-strategy)

---

## ARCHITECTURE OVERVIEW

### Infrastructure Stack

**Cloud Provider:** AWS
**Primary Region:** ap-south-1 (Mumbai) - MVP single region
**Database:** RDS Aurora PostgreSQL (Multi-AZ)
**Compute:** ECS Fargate / EKS (stateless services)
**CDN:** CloudFront for global edge
**Load Balancer:** Application Load Balancer (ALB)

### Multi-Tenancy Model

**Pool Model:** Single Postgres cluster, shared schema, org_id on every table

**Tenant Isolation:** Row-Level Security (RLS) with session parameter:
```sql
SET LOCAL app.org_id = '<uuid>';
```

**Benefits:**
- Cost-efficient for early stage (single DB cluster)
- Simple backup/restore (one cluster)
- Easy cross-tenant analytics
- Scales to 10,000+ tenants before needing sharding

**Future:** Can migrate specific orgs to dedicated regions based on `home_region` without schema changes.

---

### Request Flow

```
User Request
    ↓
CloudFront (global edge)
    ↓
ALB (ap-south-1)
    ↓
App Service (ECS/EKS)
    ↓
[Middleware: Validate JWT]
    ↓
[Extract: user_id, org_id, home_region, billing_country]
    ↓
[DB Session: SET LOCAL app.org_id]
    ↓
[RLS: Automatic org_id filtering]
    ↓
Business Logic (tenant-scoped)
    ↓
Response (localized by user.locale + user.time_zone)
```

---

## CORE PRODUCT TABLES

### 1. organizations

**Purpose:** Tenant entity representing a company or individual account. Drives billing, data residency, compliance, and regional routing.

```sql
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- IDENTITY
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,  -- URL-friendly: acme-corp
    display_name VARCHAR(255),  -- "Acme Corporation Ltd."

    -- REGIONAL CONFIGURATION
    home_region VARCHAR(10) NOT NULL,  -- 'IN', 'EU', 'US', 'ROW', 'SEA'
    billing_country CHAR(2) NOT NULL,  -- ISO 3166-1 alpha-2: 'IN', 'DE', 'US'
    currency CHAR(3) NOT NULL,  -- ISO 4217: 'INR', 'USD', 'EUR'
    tax_profile VARCHAR(20) NOT NULL DEFAULT 'NONE',  -- 'NONE', 'IND_GST', 'EU_VAT', 'US_SALES_TAX'
    compliance_profile VARCHAR(20) NOT NULL DEFAULT 'DEFAULT',  -- 'DEFAULT', 'EU_STRICT', 'HIPAA'

    -- BILLING METADATA
    billing_email VARCHAR(255) NOT NULL,
    tax_id VARCHAR(100),  -- GSTIN, VAT ID, EIN, etc.
    billing_address JSONB,  -- {street, city, state, postal_code, country}

    -- PLAN & LIMITS
    plan_tier VARCHAR(20) NOT NULL DEFAULT 'INDIVIDUAL',  -- 'INDIVIDUAL', 'BUSINESS', 'ENTERPRISE'
    is_trial BOOLEAN NOT NULL DEFAULT FALSE,
    trial_ends_at TIMESTAMPTZ,

    -- FEATURE FLAGS (org-level overrides)
    feature_overrides JSONB DEFAULT '{}',  -- {voice_mode: true, team_messaging: false}

    -- STATUS
    status VARCHAR(20) NOT NULL DEFAULT 'active',  -- 'active', 'suspended', 'deleted'
    suspended_reason TEXT,

    -- METADATA
    industry VARCHAR(100),  -- For Industry Ontology selection
    company_size VARCHAR(20),  -- '1-10', '11-50', '51-200', '201-1000', '1001+'
    onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
    onboarding_step VARCHAR(50),  -- Track onboarding progress

    -- SETTINGS
    settings JSONB DEFAULT '{}',  -- Org-wide settings

    -- TIMESTAMPS
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,  -- Soft delete

    CONSTRAINT chk_org_status CHECK (status IN ('active', 'suspended', 'deleted')),
    CONSTRAINT chk_plan_tier CHECK (plan_tier IN ('INDIVIDUAL', 'BUSINESS', 'ENTERPRISE')),
    CONSTRAINT chk_home_region CHECK (home_region IN ('IN', 'EU', 'US', 'ROW', 'SEA'))
);

CREATE INDEX idx_organizations_slug ON organizations(slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_organizations_status ON organizations(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_organizations_home_region ON organizations(home_region);
CREATE INDEX idx_organizations_billing_country ON organizations(billing_country);

-- RLS Policy
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_isolation_policy ON organizations
    USING (id::text = current_setting('app.org_id', true));
```

**Home Region Mapping:**
- `IN`: India (ap-south-1)
- `EU`: Europe (future: eu-central-1)
- `US`: United States (future: us-east-1)
- `SEA`: Southeast Asia (Singapore, etc.)
- `ROW`: Rest of World (default)

---

### 2. users

**Purpose:** User accounts within organizations. Authentication is handled via magic link (email-based); this focuses on profile, preferences, and roles.

**Note:** Authentication uses magic link system. No passwords or MFA stored. This table stores profile + preferences.

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ORGANIZATION
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- IDENTITY (auth system provides email verification via magic link)
    email VARCHAR(255) NOT NULL,  -- Unique per user, cannot be changed
    full_name VARCHAR(255),
    nickname VARCHAR(100),  -- User-changeable display name
    avatar_url TEXT,

    -- ROLE & PERMISSIONS
    role VARCHAR(20) NOT NULL DEFAULT 'MEMBER',  -- 'OWNER', 'ADMIN', 'MEMBER', 'GUEST'
    permissions JSONB DEFAULT '[]',  -- Custom permissions: ['manage_billing', 'invite_users']

    -- LOCALIZATION
    locale VARCHAR(10) NOT NULL DEFAULT 'en-US',  -- Workspace language: 'en-US', 'en-IN', etc.
    time_zone VARCHAR(50) NOT NULL DEFAULT 'UTC',  -- IANA: 'Asia/Kolkata', 'Europe/Berlin'

    -- USER PREFERENCES (product UX)
    theme VARCHAR(10) DEFAULT 'system',  -- 'system', 'dark', 'light'
    font_size VARCHAR(10) DEFAULT 'default',  -- 'small', 'default', 'large'
    contrast_mode BOOLEAN DEFAULT FALSE,  -- High contrast mode
    notification_preferences JSONB DEFAULT '{"product_updates": true, "useful_info": true}',  -- Simple toggles

    -- STATUS
    status VARCHAR(20) NOT NULL DEFAULT 'active',  -- 'active', 'invited', 'suspended', 'deleted'
    invited_by UUID REFERENCES users(id),
    invitation_token VARCHAR(255),
    invitation_expires_at TIMESTAMPTZ,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,

    -- ACTIVITY
    last_login_at TIMESTAMPTZ,
    last_active_at TIMESTAMPTZ,
    login_count INTEGER DEFAULT 0,

    -- TIMESTAMPS
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    CONSTRAINT chk_user_role CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER', 'GUEST')),
    CONSTRAINT chk_user_status CHECK (status IN ('active', 'invited', 'suspended', 'deleted')),
    CONSTRAINT chk_theme CHECK (theme IN ('system', 'dark', 'light')),
    CONSTRAINT chk_font_size CHECK (font_size IN ('small', 'default', 'large'))
);

CREATE INDEX idx_users_org ON users(org_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_email ON users(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_role ON users(role);

-- Unique email per org
CREATE UNIQUE INDEX idx_users_org_email ON users(org_id, LOWER(email)) WHERE deleted_at IS NULL;

-- RLS Policy
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_org_isolation ON users
    USING (org_id::text = current_setting('app.org_id', true));
```

**Role Hierarchy:**
- `OWNER`: Full access, billing, delete org
- `ADMIN`: Manage users, settings (no billing)
- `MEMBER`: Standard user access
- `GUEST`: Read-only, limited features

---

### 3. user_sessions

**Purpose:** Track active sessions for security, device management, and concurrent session limits.

```sql
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- SESSION
    session_token VARCHAR(255) NOT NULL UNIQUE,
    refresh_token VARCHAR(255),

    -- DEVICE CONTEXT
    device_type VARCHAR(20),  -- 'desktop', 'mobile', 'tablet'
    device_name VARCHAR(255),  -- "Chrome on MacBook Pro"
    os VARCHAR(50),
    browser VARCHAR(50),

    -- NETWORK
    ip_address INET,
    user_agent TEXT,
    location JSONB,  -- {city, country, lat, lng} from IP geolocation

    -- SESSION STATE
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- TIMESTAMPS
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,

    CONSTRAINT chk_device_type CHECK (device_type IN ('desktop', 'mobile', 'tablet'))
);

CREATE INDEX idx_user_sessions_user ON user_sessions(user_id, is_active);
CREATE INDEX idx_user_sessions_token ON user_sessions(session_token) WHERE is_active = TRUE;
CREATE INDEX idx_user_sessions_expires ON user_sessions(expires_at) WHERE is_active = TRUE;

-- RLS Policy
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY session_org_isolation ON user_sessions
    USING (org_id::text = current_setting('app.org_id', true));
```

---

## BILLING & SUBSCRIPTIONS

### 4. plans

**Purpose:** Product plans (Individual, Business, Enterprise) with pricing, features, and limits.

```sql
CREATE TABLE plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- IDENTITY
    name VARCHAR(100) NOT NULL,  -- "Individual", "Business", "Enterprise"
    slug VARCHAR(50) UNIQUE NOT NULL,  -- "individual", "business-monthly"
    display_name VARCHAR(255),  -- "Business Plan - Monthly"
    description TEXT,

    -- PRICING
    base_currency CHAR(3) NOT NULL,  -- 'USD', 'INR'
    billing_period VARCHAR(20) NOT NULL,  -- 'monthly', 'yearly'

    -- STRIPE INTEGRATION
    stripe_product_id VARCHAR(255),
    stripe_prices JSONB NOT NULL,  -- {USD: "price_xxx", INR: "price_yyy", EUR: "price_zzz"}

    -- FEATURES & LIMITS
    features JSONB NOT NULL,  -- {voice_mode: true, team_messaging: false, deep_dives: true}
    limits JSONB NOT NULL,  -- {max_users: 5, max_deep_dives: 10, max_storage_gb: 50}

    -- PLAN TIER
    tier VARCHAR(20) NOT NULL,  -- 'INDIVIDUAL', 'BUSINESS', 'ENTERPRISE'
    is_public BOOLEAN NOT NULL DEFAULT TRUE,  -- FALSE for custom enterprise plans

    -- TRIAL
    trial_days INTEGER DEFAULT 0,

    -- STATUS
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    archived_at TIMESTAMPTZ,

    -- ORDERING
    display_order INTEGER DEFAULT 0,

    -- TIMESTAMPS
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_plan_tier CHECK (tier IN ('INDIVIDUAL', 'BUSINESS', 'ENTERPRISE')),
    CONSTRAINT chk_billing_period CHECK (billing_period IN ('monthly', 'yearly'))
);

CREATE INDEX idx_plans_slug ON plans(slug);
CREATE INDEX idx_plans_tier ON plans(tier) WHERE is_active = TRUE;
CREATE INDEX idx_plans_active ON plans(is_active);

-- No RLS - plans are global reference data
```

**Example features JSONB:**
```json
{
  "voice_mode": true,
  "team_messaging": true,
  "deep_dives": true,
  "surge_engine": true,
  "asset_driving": false,
  "custom_ontology": false,
  "sso": false,
  "api_access": true
}
```

**Example limits JSONB:**
```json
{
  "max_users": 5,
  "max_deep_dives_per_month": 50,
  "max_crafts_per_month": 100,
  "max_storage_gb": 50,
  "max_asset_connections": 10,
  "max_skills": 20,
  "context_window_tokens": 200000,
  "requests_per_day": 1000
}
```

---

### 5. subscriptions

**Purpose:** Active subscriptions linking organizations to plans with Stripe integration.

```sql
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ORGANIZATION
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- PLAN
    plan_id UUID NOT NULL REFERENCES plans(id),

    -- STRIPE
    stripe_subscription_id VARCHAR(255) UNIQUE,
    stripe_customer_id VARCHAR(255) NOT NULL,

    -- BILLING
    currency CHAR(3) NOT NULL,  -- Locked at subscription creation
    amount_excl_tax DECIMAL(10, 2) NOT NULL,
    tax_rate DECIMAL(5, 4) DEFAULT 0,  -- 0.18 for 18% GST
    amount_incl_tax DECIMAL(10, 2) NOT NULL,

    -- PERIOD
    current_period_start TIMESTAMPTZ NOT NULL,
    current_period_end TIMESTAMPTZ NOT NULL,
    billing_cycle_anchor TIMESTAMPTZ,

    -- STATUS
    status VARCHAR(20) NOT NULL,  -- 'active', 'trialing', 'past_due', 'canceled', 'unpaid'
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    canceled_at TIMESTAMPTZ,
    cancellation_reason TEXT,

    -- TRIAL
    trial_start TIMESTAMPTZ,
    trial_end TIMESTAMPTZ,

    -- PAYMENT
    default_payment_method VARCHAR(255),  -- Stripe payment method ID
    collection_method VARCHAR(20) DEFAULT 'charge_automatically',

    -- TIMESTAMPS
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,

    CONSTRAINT chk_subscription_status CHECK (status IN ('active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete')),
    CONSTRAINT chk_collection_method CHECK (collection_method IN ('charge_automatically', 'send_invoice'))
);

CREATE INDEX idx_subscriptions_org ON subscriptions(org_id);
CREATE INDEX idx_subscriptions_stripe ON subscriptions(stripe_subscription_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_period ON subscriptions(current_period_end) WHERE status IN ('active', 'trialing');

-- RLS Policy
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY subscription_org_isolation ON subscriptions
    USING (org_id::text = current_setting('app.org_id', true));
```

---

### 6. invoices

**Purpose:** Invoice records for billing history, compliance, and tax reporting.

```sql
CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ORGANIZATION
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES subscriptions(id),

    -- STRIPE
    stripe_invoice_id VARCHAR(255) UNIQUE,
    stripe_charge_id VARCHAR(255),

    -- INVOICE DETAILS
    invoice_number VARCHAR(100) UNIQUE NOT NULL,  -- "INV-2026-001234"

    -- AMOUNTS
    currency CHAR(3) NOT NULL,
    subtotal DECIMAL(10, 2) NOT NULL,
    tax_amount DECIMAL(10, 2) DEFAULT 0,
    total DECIMAL(10, 2) NOT NULL,
    amount_paid DECIMAL(10, 2) DEFAULT 0,
    amount_due DECIMAL(10, 2) DEFAULT 0,

    -- TAX DETAILS
    tax_profile VARCHAR(20),  -- 'IND_GST', 'EU_VAT', etc.
    tax_id VARCHAR(100),  -- Customer's tax ID
    tax_breakdown JSONB,  -- {cgst: 9%, sgst: 9%, total: 18%} or {vat: 20%}

    -- BILLING ADDRESS (snapshot at invoice time)
    billing_country CHAR(2) NOT NULL,
    billing_address JSONB,

    -- LINE ITEMS
    line_items JSONB NOT NULL,  -- Array of {description, quantity, unit_price, amount}

    -- STATUS
    status VARCHAR(20) NOT NULL,  -- 'draft', 'open', 'paid', 'void', 'uncollectible'

    -- DATES
    issued_at TIMESTAMPTZ NOT NULL,
    due_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    voided_at TIMESTAMPTZ,

    -- PAYMENT
    payment_method VARCHAR(50),  -- 'card', 'bank_transfer', 'upi'
    payment_intent_id VARCHAR(255),

    -- FILES
    pdf_url TEXT,  -- S3 URL to PDF invoice

    -- TIMESTAMPS
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_invoice_status CHECK (status IN ('draft', 'open', 'paid', 'void', 'uncollectible'))
);

CREATE INDEX idx_invoices_org ON invoices(org_id);
CREATE INDEX idx_invoices_subscription ON invoices(subscription_id);
CREATE INDEX idx_invoices_stripe ON invoices(stripe_invoice_id);
CREATE INDEX idx_invoices_number ON invoices(invoice_number);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_issued ON invoices(issued_at DESC);

-- RLS Policy
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY invoice_org_isolation ON invoices
    USING (org_id::text = current_setting('app.org_id', true));
```

**Example line_items JSONB:**
```json
[
  {
    "description": "Business Plan - Monthly",
    "quantity": 1,
    "unit_price": 2000.00,
    "amount": 2000.00,
    "period": {"start": "2026-01-01", "end": "2026-02-01"}
  },
  {
    "description": "Additional User Seats (x3)",
    "quantity": 3,
    "unit_price": 500.00,
    "amount": 1500.00
  }
]
```

---

### 7. payment_methods

**Purpose:** Stored payment methods for recurring billing.

```sql
CREATE TABLE payment_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ORGANIZATION
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),  -- Who added it

    -- STRIPE
    stripe_payment_method_id VARCHAR(255) UNIQUE NOT NULL,

    -- METHOD DETAILS
    type VARCHAR(20) NOT NULL,  -- 'card', 'bank_account', 'upi'

    -- CARD (if type = 'card')
    card_brand VARCHAR(20),  -- 'visa', 'mastercard', 'amex'
    card_last4 VARCHAR(4),
    card_exp_month INTEGER,
    card_exp_year INTEGER,

    -- BANK (if type = 'bank_account')
    bank_name VARCHAR(100),
    bank_last4 VARCHAR(4),

    -- STATUS
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,

    -- BILLING ADDRESS
    billing_address JSONB,

    -- TIMESTAMPS
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    CONSTRAINT chk_payment_type CHECK (type IN ('card', 'bank_account', 'upi'))
);

CREATE INDEX idx_payment_methods_org ON payment_methods(org_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_payment_methods_stripe ON payment_methods(stripe_payment_method_id);
CREATE INDEX idx_payment_methods_default ON payment_methods(org_id, is_default) WHERE is_default = TRUE;

-- RLS Policy
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY payment_method_org_isolation ON payment_methods
    USING (org_id::text = current_setting('app.org_id', true));
```

---

### 8. usage_tracking

**Purpose:** Track feature usage for billing (overages), analytics, and plan enforcement.

```sql
CREATE TABLE usage_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ORGANIZATION
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),  -- NULL for org-level usage

    -- METRIC
    metric_name VARCHAR(100) NOT NULL,  -- 'deep_dives', 'crafts', 'storage_gb', 'api_calls'
    metric_value DECIMAL(15, 4) NOT NULL,
    unit VARCHAR(20),  -- 'count', 'gb', 'tokens', 'seconds'

    -- PERIOD
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,

    -- METADATA
    metadata JSONB,  -- Additional context

    -- TIMESTAMPS
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_metric_value CHECK (metric_value >= 0)
);

CREATE INDEX idx_usage_org_metric ON usage_tracking(org_id, metric_name, period_start DESC);
CREATE INDEX idx_usage_period ON usage_tracking(period_start, period_end);

-- Partitioning by month (for performance)
-- ALTER TABLE usage_tracking PARTITION BY RANGE (period_start);

-- RLS Policy
ALTER TABLE usage_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY usage_org_isolation ON usage_tracking
    USING (org_id::text = current_setting('app.org_id', true));
```

**Common Metrics:**
- `deep_dives`: Number of deep dives created
- `crafts`: Number of crafts generated
- `storage_gb`: Storage used in GB
- `api_calls`: API requests count
- `voice_minutes`: Voice mode minutes
- `asset_sync_operations`: Asset sync count
- `llm_tokens`: Total LLM tokens consumed

---

## USER SETTINGS & PREFERENCES

### 9. user_preferences (OPTIONAL - For Future Extensibility)

**Purpose:** Extended preferences beyond core settings in users table.

**Note:** Core preferences (theme, font size, contrast mode, notifications) are in the `users` table. This table is optional for future extensibility.

```sql
CREATE TABLE user_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- FUTURE EXTENSIBILITY
    extended_preferences JSONB DEFAULT '{}',  -- For future preference additions

    -- TIMESTAMPS
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_preferences_user ON user_preferences(user_id);

-- RLS Policy
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_prefs_org_isolation ON user_preferences
    USING (org_id::text = current_setting('app.org_id', true));
```

**Current Settings Structure (in users table):**
- **Profile:** full_name, nickname, avatar_url
- **Workspace language:** locale (default: 'en-US')
- **Theme:** 'system' (default), 'dark', 'light'
- **Font size:** 'small', 'default', 'large'
- **Contrast mode:** boolean toggle
- **Notifications:**
  ```json
  {
    "product_updates": true,  // Product updates & tips
    "useful_info": true       // Other useful information
  }
  ```

---

### 10. organization_settings

**Purpose:** Organization-wide settings (branding, security policies, defaults).

```sql
CREATE TABLE organization_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    org_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,

    -- BRANDING
    logo_url TEXT,
    primary_color VARCHAR(7),  -- Hex color: #FF5733
    company_website VARCHAR(255),

    -- SECURITY POLICIES
    session_timeout_minutes INTEGER DEFAULT 1440,  -- 24 hours
    allowed_domains JSONB,  -- Email domain whitelist for auto-join

    -- ONBOARDING
    default_user_role VARCHAR(20) DEFAULT 'MEMBER',
    onboarding_flow JSONB,  -- Custom onboarding steps

    -- DATA RESIDENCY
    data_residency_region VARCHAR(10),  -- Override home_region if needed

    -- INTEGRATIONS
    sso_enabled BOOLEAN DEFAULT FALSE,
    sso_provider VARCHAR(50),  -- 'okta', 'azure_ad', 'google_workspace'
    sso_config JSONB,

    -- LIMITS & QUOTAS (org-specific overrides)
    quota_overrides JSONB DEFAULT '{}',

    -- CUSTOM SETTINGS
    custom_settings JSONB DEFAULT '{}',

    -- TIMESTAMPS
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_organization_settings_org ON organization_settings(org_id);

-- RLS Policy
ALTER TABLE organization_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_settings_isolation ON organization_settings
    USING (org_id::text = current_setting('app.org_id', true));
```

---

## ANNOUNCEMENTS & NOTIFICATIONS

### 11. announcements

**Purpose:** Platform-wide or org-specific announcements (new features, maintenance, etc.).

```sql
CREATE TABLE announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- SCOPE
    scope VARCHAR(20) NOT NULL,  -- 'global', 'org', 'user'
    org_id UUID REFERENCES organizations(id),  -- NULL for global
    target_user_ids UUID[],  -- NULL for all users in scope

    -- CONTENT
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(20) NOT NULL,  -- 'info', 'warning', 'error', 'success', 'feature'

    -- DISPLAY
    priority VARCHAR(20) DEFAULT 'normal',  -- 'low', 'normal', 'high', 'urgent'
    is_dismissible BOOLEAN DEFAULT TRUE,
    link_url TEXT,
    link_text VARCHAR(100),

    -- TARGETING
    target_plan_tiers VARCHAR(20)[],  -- ['BUSINESS', 'ENTERPRISE'] or NULL for all
    target_regions VARCHAR(10)[],  -- ['IN', 'EU'] or NULL for all

    -- SCHEDULING
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,

    -- STATUS
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    -- METADATA
    created_by UUID REFERENCES users(id),  -- Admin who created

    -- TIMESTAMPS
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_announcement_scope CHECK (scope IN ('global', 'org', 'user')),
    CONSTRAINT chk_announcement_type CHECK (type IN ('info', 'warning', 'error', 'success', 'feature')),
    CONSTRAINT chk_announcement_priority CHECK (priority IN ('low', 'normal', 'high', 'urgent'))
);

CREATE INDEX idx_announcements_scope ON announcements(scope, is_active);
CREATE INDEX idx_announcements_org ON announcements(org_id) WHERE scope = 'org';
CREATE INDEX idx_announcements_published ON announcements(published_at DESC) WHERE is_active = TRUE;
CREATE INDEX idx_announcements_expires ON announcements(expires_at) WHERE is_active = TRUE;

-- Partial RLS (global announcements visible to all)
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY announcement_visibility ON announcements
    USING (
        scope = 'global' OR
        (scope = 'org' AND org_id::text = current_setting('app.org_id', true))
    );
```

---

### 12. user_announcement_status

**Purpose:** Track which users have seen/dismissed announcements.

```sql
CREATE TABLE user_announcement_status (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,

    -- STATUS
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    is_dismissed BOOLEAN NOT NULL DEFAULT FALSE,

    -- TIMESTAMPS
    read_at TIMESTAMPTZ,
    dismissed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(user_id, announcement_id)
);

CREATE INDEX idx_user_announcement_user ON user_announcement_status(user_id, is_read, is_dismissed);
CREATE INDEX idx_user_announcement_announcement ON user_announcement_status(announcement_id);

-- RLS Policy
ALTER TABLE user_announcement_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_announcement_org_isolation ON user_announcement_status
    USING (org_id::text = current_setting('app.org_id', true));
```

---

### 13. notifications

**Purpose:** User notifications (mentions, task updates, system alerts).

```sql
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- RECIPIENT
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- NOTIFICATION CONTENT
    type VARCHAR(50) NOT NULL,  -- 'mention', 'craft_shared', 'deep_dive_complete', 'surge_update'
    title VARCHAR(255) NOT NULL,
    message TEXT,

    -- METADATA
    entity_type VARCHAR(50),  -- 'craft', 'deep_dive', 'surge', 'user'
    entity_id UUID,
    link_url TEXT,  -- Deep link into app

    -- SENDER (optional)
    sender_id UUID REFERENCES users(id),

    -- STATUS
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,

    -- DELIVERY
    delivery_channels VARCHAR(20)[],  -- ['in_app', 'email', 'push']
    email_sent_at TIMESTAMPTZ,
    push_sent_at TIMESTAMPTZ,

    -- GROUPING (for digest notifications)
    group_key VARCHAR(100),  -- Group related notifications

    -- TIMESTAMPS
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ  -- Auto-archive after expiry
);

CREATE INDEX idx_notifications_user ON notifications(user_id, is_read, is_archived, created_at DESC);
CREATE INDEX idx_notifications_type ON notifications(type);
CREATE INDEX idx_notifications_entity ON notifications(entity_type, entity_id);
CREATE INDEX idx_notifications_expires ON notifications(expires_at) WHERE expires_at IS NOT NULL;

-- RLS Policy
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_org_isolation ON notifications
    USING (org_id::text = current_setting('app.org_id', true));
```

**Common Notification Types:**
- `mention`: Someone @mentioned you
- `craft_shared`: Craft shared with you
- `deep_dive_complete`: Deep dive finished
- `surge_update`: New surge available
- `team_invite`: Invited to team
- `billing_update`: Payment failed, subscription changed
- `feature_release`: New feature available

---

## FEATURE FLAGS & LIMITS

### 14. feature_flags

**Purpose:** Global and org-specific feature flags for gradual rollouts and A/B testing.

```sql
CREATE TABLE feature_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- FEATURE
    feature_key VARCHAR(100) UNIQUE NOT NULL,  -- 'voice_mode_v2', 'new_ui_editor'
    name VARCHAR(255) NOT NULL,
    description TEXT,

    -- ROLLOUT STRATEGY
    rollout_type VARCHAR(20) NOT NULL,  -- 'boolean', 'percentage', 'whitelist', 'plan_tier'

    -- BOOLEAN ROLLOUT
    is_enabled BOOLEAN DEFAULT FALSE,

    -- PERCENTAGE ROLLOUT
    rollout_percentage INTEGER DEFAULT 0,  -- 0-100, applies to random users

    -- WHITELIST ROLLOUT
    whitelisted_org_ids UUID[],
    whitelisted_user_ids UUID[],

    -- PLAN TIER ROLLOUT
    enabled_plan_tiers VARCHAR(20)[],  -- ['BUSINESS', 'ENTERPRISE']

    -- REGIONS
    enabled_regions VARCHAR(10)[],  -- ['IN', 'US'] or NULL for all

    -- OVERRIDE RULES
    override_rules JSONB,  -- Complex conditions

    -- STATUS
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    -- METADATA
    created_by UUID REFERENCES users(id),

    -- TIMESTAMPS
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ,

    CONSTRAINT chk_rollout_type CHECK (rollout_type IN ('boolean', 'percentage', 'whitelist', 'plan_tier', 'region')),
    CONSTRAINT chk_rollout_percentage CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100)
);

CREATE INDEX idx_feature_flags_key ON feature_flags(feature_key) WHERE is_active = TRUE;

-- No RLS - feature flags checked at app level
```

**Feature Flag Evaluation Logic (Pseudocode):**
```python
def is_feature_enabled(feature_key, user_id, org_id):
    flag = get_feature_flag(feature_key)
    if not flag.is_active:
        return False

    # Check org override first
    org = get_organization(org_id)
    if feature_key in org.feature_overrides:
        return org.feature_overrides[feature_key]

    # Evaluate rollout type
    if flag.rollout_type == 'boolean':
        return flag.is_enabled

    elif flag.rollout_type == 'percentage':
        user_hash = hash(f"{user_id}:{feature_key}") % 100
        return user_hash < flag.rollout_percentage

    elif flag.rollout_type == 'whitelist':
        return (org_id in flag.whitelisted_org_ids or
                user_id in flag.whitelisted_user_ids)

    elif flag.rollout_type == 'plan_tier':
        return org.plan_tier in flag.enabled_plan_tiers

    return False
```

---

### 15. plan_limits

**Purpose:** Enforce usage limits per plan (computed from plan features + overrides).

**Note:** This is a materialized view refreshed periodically, or computed dynamically.

```sql
CREATE MATERIALIZED VIEW plan_limits AS
SELECT
    org.id AS org_id,
    org.plan_tier,

    -- From plan
    p.limits AS base_limits,

    -- From org overrides
    org.feature_overrides AS org_overrides,

    -- Computed effective limits
    COALESCE(
        (org.feature_overrides->>'max_users')::INTEGER,
        (p.limits->>'max_users')::INTEGER
    ) AS max_users,

    COALESCE(
        (org.feature_overrides->>'max_deep_dives_per_month')::INTEGER,
        (p.limits->>'max_deep_dives_per_month')::INTEGER
    ) AS max_deep_dives_per_month,

    COALESCE(
        (org.feature_overrides->>'max_storage_gb')::INTEGER,
        (p.limits->>'max_storage_gb')::INTEGER
    ) AS max_storage_gb

FROM organizations org
JOIN plans p ON org.plan_tier = p.tier
WHERE p.is_active = TRUE
  AND org.status = 'active';

CREATE UNIQUE INDEX idx_plan_limits_org ON plan_limits(org_id);
```

---

## AUDIT & COMPLIANCE

### 16. audit_events

**Purpose:** Comprehensive audit log for security, compliance, and debugging.

**Note:** This complements the agentic audit_trail table. This is for platform/product events.

```sql
CREATE TABLE audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- CONTEXT
    org_id UUID REFERENCES organizations(id),  -- NULL for system events
    user_id UUID REFERENCES users(id),  -- NULL for automated events

    -- EVENT
    event_type VARCHAR(100) NOT NULL,  -- 'user.login', 'org.created', 'billing.subscription_updated'
    event_category VARCHAR(50) NOT NULL,  -- 'auth', 'org', 'billing', 'security', 'compliance'

    -- ACTOR
    actor_type VARCHAR(20) NOT NULL,  -- 'user', 'system', 'admin', 'api'
    actor_id VARCHAR(255),

    -- TARGET
    resource_type VARCHAR(50),  -- 'user', 'organization', 'subscription'
    resource_id UUID,

    -- DETAILS
    action VARCHAR(100) NOT NULL,  -- 'created', 'updated', 'deleted', 'viewed'
    description TEXT,
    changes JSONB,  -- Before/after for updates
    metadata JSONB,

    -- REQUEST CONTEXT
    ip_address INET,
    user_agent TEXT,
    request_id VARCHAR(255),  -- Trace ID for distributed tracing

    -- COMPLIANCE
    gdpr_relevant BOOLEAN DEFAULT FALSE,
    hipaa_relevant BOOLEAN DEFAULT FALSE,

    -- TIMESTAMP
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_event_category CHECK (event_category IN ('auth', 'org', 'billing', 'security', 'compliance', 'data')),
    CONSTRAINT chk_actor_type CHECK (actor_type IN ('user', 'system', 'admin', 'api', 'cron'))
);

CREATE INDEX idx_audit_events_org ON audit_events(org_id, created_at DESC);
CREATE INDEX idx_audit_events_user ON audit_events(user_id, created_at DESC);
CREATE INDEX idx_audit_events_type ON audit_events(event_type, created_at DESC);
CREATE INDEX idx_audit_events_resource ON audit_events(resource_type, resource_id);
CREATE INDEX idx_audit_events_compliance ON audit_events(gdpr_relevant, hipaa_relevant) WHERE gdpr_relevant = TRUE OR hipaa_relevant = TRUE;

-- Partitioning by month for performance
-- ALTER TABLE audit_events PARTITION BY RANGE (created_at);

-- RLS Policy
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_org_isolation ON audit_events
    USING (org_id::text = current_setting('app.org_id', true) OR org_id IS NULL);
```

**Common Event Types:**
- **Auth:** `user.login`, `user.logout`, `user.mfa_enabled`, `session.created`, `password.changed`
- **Org:** `org.created`, `org.updated`, `org.suspended`, `user.invited`, `user.role_changed`
- **Billing:** `subscription.created`, `subscription.canceled`, `invoice.paid`, `payment_method.added`
- **Security:** `login.failed`, `mfa.failed`, `suspicious_activity.detected`, `api_key.created`
- **Compliance:** `data.exported`, `data.deleted`, `consent.updated`

---

### 17. api_keys

**Purpose:** API keys for programmatic access to BAP APIs.

```sql
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ORGANIZATION
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id),

    -- KEY
    key_prefix VARCHAR(20) NOT NULL UNIQUE,  -- "bap_live_abc123" (visible part)
    key_hash VARCHAR(255) NOT NULL UNIQUE,  -- bcrypt hash of full key

    -- METADATA
    name VARCHAR(255) NOT NULL,  -- "Production API Key"
    description TEXT,

    -- PERMISSIONS
    scopes VARCHAR(50)[],  -- ['read:crafts', 'write:deep_dives', 'read:surge']

    -- RATE LIMITING
    rate_limit_per_minute INTEGER DEFAULT 60,

    -- STATUS
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    -- SECURITY
    last_used_at TIMESTAMPTZ,
    last_used_ip INET,

    -- EXPIRY
    expires_at TIMESTAMPTZ,

    -- TIMESTAMPS
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    revoked_by UUID REFERENCES users(id),
    revoke_reason TEXT,

    CONSTRAINT chk_rate_limit CHECK (rate_limit_per_minute > 0)
);

CREATE INDEX idx_api_keys_org ON api_keys(org_id) WHERE is_active = TRUE;
CREATE INDEX idx_api_keys_prefix ON api_keys(key_prefix);
CREATE INDEX idx_api_keys_expires ON api_keys(expires_at) WHERE is_active = TRUE;

-- RLS Policy
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY api_key_org_isolation ON api_keys
    USING (org_id::text = current_setting('app.org_id', true));
```

**API Key Format:** `bap_live_abc123def456...` (64 chars)
- Prefix: `bap_live_` (prod) or `bap_test_` (dev)
- Hash stored, full key shown once at creation

---

## API SPECIFICATIONS

### REST API Endpoints

**Base URL:** `https://api.bap.com/v1`

**Authentication:**
- Bearer token (JWT from user session)
- API key (for programmatic access): `Authorization: Bearer bap_live_xxx`

**Request Headers:**
```
Authorization: Bearer <token>
X-Organization-ID: <org_uuid>  (optional, inferred from token)
Content-Type: application/json
Accept-Language: en-US
```

**Response Format:**
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "request_id": "req_abc123",
    "timestamp": "2026-01-06T10:30:00Z"
  },
  "errors": []  // Empty if success
}
```

---

### Core Product APIs

#### 1. Organizations

**GET /organizations/:id**
```json
{
  "success": true,
  "data": {
    "id": "org_123",
    "name": "Acme Corp",
    "slug": "acme-corp",
    "home_region": "IN",
    "billing_country": "IN",
    "currency": "INR",
    "plan_tier": "BUSINESS",
    "status": "active",
    "settings": { ... },
    "created_at": "2025-12-01T00:00:00Z"
  }
}
```

**PATCH /organizations/:id**
Request:
```json
{
  "name": "Acme Corporation",
  "billing_email": "billing@acme.com",
  "settings": {
    "logo_url": "https://cdn.acme.com/logo.png"
  }
}
```

**POST /organizations/:id/suspend**
Request:
```json
{
  "reason": "Payment failed - invoice overdue by 30 days"
}
```

---

#### 2. Users

**GET /users**
```json
{
  "success": true,
  "data": [
    {
      "id": "user_123",
      "email": "john@acme.com",
      "full_name": "John Doe",
      "role": "ADMIN",
      "locale": "en-IN",
      "time_zone": "Asia/Kolkata",
      "status": "active",
      "last_active_at": "2026-01-06T09:15:00Z"
    }
  ],
  "meta": {
    "total": 12,
    "page": 1,
    "per_page": 20
  }
}
```

**POST /users/invite**
Request:
```json
{
  "email": "jane@acme.com",
  "role": "MEMBER",
  "message": "Welcome to our BAP workspace!"
}
```

**PATCH /users/:id/role**
Request:
```json
{
  "role": "ADMIN"
}
```

---

#### 3. Subscriptions

**GET /subscriptions/current**

**Note:** Response varies by plan tier:
- **Individual plans:** Full subscription info including payment details, billing dates
- **Business/Enterprise plans:** Only limits shown, billing managed by org owner

**Individual Plan Response:**
```json
{
  "success": true,
  "data": {
    "id": "sub_123",
    "plan": {
      "name": "Individual",
      "tier": "INDIVIDUAL",
      "features": { ... },
      "limits": {
        "max_users": 1,
        "max_deep_dives_per_month": 20,
        "max_crafts_per_month": 50,
        "max_storage_gb": 20
      },
      "usage": {
        "deep_dives": {"used": 8, "remaining": 12},
        "crafts": {"used": 23, "remaining": 27},
        "storage_gb": {"used": 5.2, "remaining": 14.8}
      }
    },
    "status": "active",
    "current_period_start": "2026-01-01T00:00:00Z",
    "current_period_end": "2026-02-01T00:00:00Z",
    "next_billing_date": "2026-02-01T00:00:00Z",
    "cancel_at_period_end": false,
    "amount_incl_tax": 799.00,
    "currency": "INR",
    "payment_methods": [
      {
        "id": "pm_123",
        "type": "card",
        "card_brand": "visa",
        "card_last4": "4242",
        "is_default": true
      }
    ]
  }
}
```

**Business/Enterprise Plan Response:**
```json
{
  "success": true,
  "data": {
    "plan": {
      "name": "Business",
      "tier": "BUSINESS",
      "features": { ... },
      "limits": {
        "max_users": 5,
        "max_deep_dives_per_month": 50,
        "max_crafts_per_month": 100,
        "max_storage_gb": 50
      },
      "usage": {
        "users": {"used": 3, "remaining": 2},
        "deep_dives": {"used": 23, "remaining": 27},
        "crafts": {"used": 67, "remaining": 33},
        "storage_gb": {"used": 12.5, "remaining": 37.5}
      }
    },
    "message": "Billing managed by organization owner"
  }
}
```

**POST /subscriptions/upgrade**
Request:
```json
{
  "plan_id": "plan_enterprise_yearly",
  "proration": true
}
```

**POST /subscriptions/cancel**
Request:
```json
{
  "cancel_at_period_end": true,
  "reason": "Switching to competitor",
  "feedback": "Missing asset driving feature"
}
```

---

#### 4. Billing

**GET /invoices**
```json
{
  "success": true,
  "data": [
    {
      "id": "inv_123",
      "invoice_number": "INV-2026-001234",
      "status": "paid",
      "total": 2360.00,
      "currency": "INR",
      "issued_at": "2026-01-01T00:00:00Z",
      "paid_at": "2026-01-01T10:30:00Z",
      "pdf_url": "https://invoices.bap.com/inv_123.pdf"
    }
  ]
}
```

**GET /invoices/:id/download**
Returns PDF file.

**POST /payment-methods**
Request:
```json
{
  "stripe_payment_method_id": "pm_abc123",
  "set_as_default": true
}
```

**GET /usage/current**
```json
{
  "success": true,
  "data": {
    "period": {
      "start": "2026-01-01T00:00:00Z",
      "end": "2026-02-01T00:00:00Z"
    },
    "metrics": {
      "deep_dives": {
        "used": 23,
        "limit": 50,
        "percentage": 46
      },
      "crafts": {
        "used": 67,
        "limit": 100,
        "percentage": 67
      },
      "storage_gb": {
        "used": 12.5,
        "limit": 50,
        "percentage": 25
      }
    },
    "overages": []
  }
}
```

---

#### 5. Settings

**GET /settings/user**
```json
{
  "success": true,
  "data": {
    "profile": {
      "email": "john@acme.com",
      "full_name": "John Doe",
      "nickname": "JD",
      "avatar_url": "https://cdn.bap.com/avatars/user_123.jpg"
    },
    "preferences": {
      "locale": "en-US",
      "time_zone": "Asia/Kolkata",
      "theme": "dark",
      "font_size": "default",
      "contrast_mode": false,
      "notification_preferences": {
        "product_updates": true,
        "useful_info": true
      }
    }
  }
}
```

**PATCH /settings/user**
Request (all fields optional):
```json
{
  "full_name": "John Michael Doe",
  "nickname": "Johnny",
  "avatar_url": "https://cdn.bap.com/avatars/new_avatar.jpg",
  "locale": "en-IN",
  "time_zone": "Asia/Kolkata",
  "theme": "light",
  "font_size": "large",
  "contrast_mode": true,
  "notification_preferences": {
    "product_updates": false,
    "useful_info": true
  }
}
```

Response:
```json
{
  "success": true,
  "data": {
    "updated_fields": ["full_name", "nickname", "theme", "font_size"],
    "message": "Settings updated successfully"
  }
}
```

**DELETE /settings/account**
Request account deletion:
```json
{
  "reason": "No longer needed",
  "feedback": "Great product, but moving to different solution"
}
```

Response:
```json
{
  "success": true,
  "data": {
    "deletion_scheduled_at": "2026-01-13T00:00:00Z",
    "message": "Account will be deleted in 7 days. You can cancel deletion before this date."
  }
}
```

**GET /settings/organization**
**PATCH /settings/organization**

---

#### 6. Announcements

**GET /announcements**
```json
{
  "success": true,
  "data": [
    {
      "id": "ann_123",
      "title": "New Feature: Voice Mode 2.0",
      "message": "We've completely redesigned voice interactions...",
      "type": "feature",
      "priority": "high",
      "is_dismissible": true,
      "link_url": "/features/voice-mode",
      "published_at": "2026-01-06T00:00:00Z",
      "status": {
        "is_read": false,
        "is_dismissed": false
      }
    }
  ]
}
```

**POST /announcements/:id/dismiss**

**POST /announcements/:id/mark-read**

---

#### 7. Notifications

**GET /notifications**
Query params: `?unread=true&type=mention&limit=20&offset=0`

```json
{
  "success": true,
  "data": [
    {
      "id": "notif_123",
      "type": "mention",
      "title": "Jane mentioned you in 'Q4 Planning'",
      "message": "@john what do you think about this approach?",
      "link_url": "/deep-dives/dd_456#msg_789",
      "sender": {
        "id": "user_456",
        "name": "Jane Smith",
        "avatar_url": "..."
      },
      "is_read": false,
      "created_at": "2026-01-06T09:30:00Z"
    }
  ],
  "meta": {
    "total_unread": 8
  }
}
```

**POST /notifications/:id/read**

**POST /notifications/mark-all-read**

**DELETE /notifications/:id** (archive)

---

#### 8. Feature Flags

**GET /features**
```json
{
  "success": true,
  "data": {
    "voice_mode": true,
    "team_messaging": true,
    "asset_driving": false,
    "new_ui_editor": true
  }
}
```

**GET /features/:key**
```json
{
  "success": true,
  "data": {
    "feature_key": "voice_mode_v2",
    "is_enabled": true,
    "rollout_percentage": 50,
    "description": "New voice mode with enhanced NLU"
  }
}
```

---

#### 9. Audit

**GET /audit/events**
Query params: `?event_type=user.login&from=2026-01-01&to=2026-01-06&limit=100`

```json
{
  "success": true,
  "data": [
    {
      "id": "audit_123",
      "event_type": "user.login",
      "event_category": "auth",
      "actor": {
        "type": "user",
        "id": "user_123",
        "name": "John Doe"
      },
      "action": "login",
      "ip_address": "103.21.45.67",
      "user_agent": "Mozilla/5.0...",
      "created_at": "2026-01-06T09:00:00Z"
    }
  ]
}
```

**POST /audit/export**
Request:
```json
{
  "from": "2025-01-01T00:00:00Z",
  "to": "2026-01-01T00:00:00Z",
  "format": "csv",
  "event_categories": ["billing", "security"]
}
```

Returns: Download link to S3.

---

### Webhooks

**Supported Events:**
- `subscription.created`
- `subscription.updated`
- `subscription.canceled`
- `invoice.paid`
- `invoice.payment_failed`
- `user.created`
- `user.deleted`
- `organization.suspended`

**Webhook Payload:**
```json
{
  "event": "subscription.updated",
  "timestamp": "2026-01-06T10:00:00Z",
  "data": {
    "subscription_id": "sub_123",
    "org_id": "org_456",
    "previous_status": "trialing",
    "current_status": "active"
  }
}
```

---

## MULTI-REGION STRATEGY

### Phase 1: Single Region (MVP)

**Current State:**
- Physical region: ap-south-1 (Mumbai)
- Logical regions tracked: IN, EU, US, ROW, SEA
- All data in single Aurora cluster

**Preparation for Multi-Region:**
1. Every org has `home_region` field
2. All business data tagged with `org_id`
3. RLS policies enforce tenant isolation
4. Billing country drives currency/tax (decoupled from physical location)

---

### Phase 2: Multi-Region Deployment (Post-MVP)

**Target Regions:**
- ap-south-1 (India) - existing
- eu-central-1 (Frankfurt) - for EU orgs
- us-east-1 (Virginia) - for US orgs

**Migration Strategy:**

#### Step 1: Spin Up New Regions
- Deploy app services in eu-central-1 and us-east-1
- Create Aurora clusters in each region
- Replicate schema (same DDL)

#### Step 2: Data Migration
```sql
-- Identify EU orgs
SELECT id FROM organizations WHERE home_region = 'EU';

-- Export data (all tables with org_id)
pg_dump --table=organizations --table=users --table=subscriptions ...
  --where="org_id IN (SELECT id FROM organizations WHERE home_region = 'EU')"

-- Import to eu-central-1 cluster
psql -h eu-cluster.rds.amazonaws.com < eu_orgs.sql

-- Verify data, then delete from ap-south-1
DELETE FROM organizations WHERE home_region = 'EU';
```

#### Step 3: Routing
**DNS-based routing (Route 53):**
- `api.bap.com` → Geolocation routing policy
- India IP → ap-south-1 ALB
- EU IP → eu-central-1 ALB
- US IP → us-east-1 ALB

**Application-level routing:**
- JWT contains `home_region`
- API Gateway routes to correct region based on JWT claim
- Cross-region requests rejected (enforce data residency)

#### Step 4: Edge Caching
- CloudFront distributions per region
- Static assets cached globally
- API requests routed to nearest region (with home_region enforcement)

---

### Data Residency Compliance

**EU (GDPR):**
- `home_region = 'EU'` → Data in eu-central-1
- No cross-region replication
- GDPR-compliant data processing agreements

**India (DPDP Act):**
- `home_region = 'IN'` → Data in ap-south-1
- Sensitive personal data not transferred outside India

**US (State laws):**
- `home_region = 'US'` → Data in us-east-1
- CCPA/CPRA compliance

**Backup & DR:**
- Per-region backups (RDS automated backups)
- Cross-region disaster recovery snapshots (encrypted)
- Point-in-time recovery within same region

---

### Multi-Region Read Replicas (Future)

**Global Read Replicas for Performance:**
- Primary writes in home region
- Read replicas in other regions for low-latency reads
- Acceptable for non-critical reads (analytics, dashboards)
- Strict writes to home region only (compliance)

**Aurora Global Database:**
- Primary in home region
- Secondary regions for disaster recovery
- <1 second replication lag
- Failover capability

---

## PERFORMANCE & SCALABILITY

### Database Optimization

**Indexing Strategy:**
- All foreign keys indexed
- Composite indexes for common queries: `(org_id, created_at DESC)`
- Partial indexes for active records: `WHERE deleted_at IS NULL`
- GIN indexes for JSONB: `CREATE INDEX idx_org_settings_custom ON organization_settings USING GIN (custom_settings);`

**Partitioning:**
- `audit_events`: Monthly partitions (retention: 7 years)
- `usage_tracking`: Monthly partitions (retention: 2 years)
- `notifications`: Quarterly partitions (retention: 1 year)

**Connection Pooling:**
- PgBouncer for connection pooling
- Transaction pooling mode
- Max connections: 500 per instance

**Caching:**
- Redis for session data, feature flags, plan limits
- TTL-based invalidation
- Write-through for critical updates

---

### API Rate Limiting

**Per-User Limits:**
- Individual: 60 requests/minute
- Business: 120 requests/minute
- Enterprise: 300 requests/minute

**Per-API-Key Limits:**
- Configurable per key (default: 60/min)
- Burst allowance: 2x for 10 seconds

**Implementation:**
- Redis-based token bucket
- Response headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

---

## MONITORING & ALERTS

### Key Metrics

**Application:**
- API response time (P50, P95, P99)
- Error rate (5xx, 4xx)
- Active users (DAU, MAU)
- Feature adoption rate

**Database:**
- Connection pool utilization
- Query latency
- Replication lag (if multi-region)
- Disk I/O

**Billing:**
- MRR (Monthly Recurring Revenue)
- Churn rate
- Trial conversion rate
- Payment failure rate

**Alerts:**
- Payment failure → Notify billing team
- High error rate → On-call engineer
- DB connection exhaustion → Auto-scale
- Subscription cancellation spike → Product team

---

## SECURITY CONSIDERATIONS

### Data Protection

**At Rest:**
- RDS encryption with AWS KMS
- S3 encryption for files (SSE-S3)
- Application-level encryption for PII (see C11 Memory Encryption)

**In Transit:**
- TLS 1.3 for all API traffic
- Certificate pinning for mobile apps
- VPC private subnets for RDS

**Access Control:**
- RLS for tenant isolation
- IAM roles for service authentication
- Principle of least privilege

### Compliance

**GDPR (EU):**
- Right to access: `/api/users/:id/export`
- Right to deletion: `/api/users/:id/delete` (hard delete)
- Consent management: `user_preferences.gdpr_consent`
- Data portability: Export to JSON/CSV

**HIPAA (Healthcare):**
- Audit trail for all PHI access
- Encryption at rest and in transit
- Access controls (role-based)
- Business Associate Agreement (BAA)

**SOC 2:**
- Audit logging (audit_events)
- Access reviews (quarterly)
- Incident response plan
- Vendor management

---


### Currency & Tax Mapping

| Country | Home Region | Currency | Tax Profile | Tax Rate |
|---------|-------------|----------|-------------|----------|
| India | IN | INR | IND_GST | 18% (9% CGST + 9% SGST) |
| United States | US | USD | US_SALES_TAX | Varies by state |
| Germany | EU | EUR | EU_VAT | 19% |
| United Kingdom | EU | GBP | EU_VAT | 20% |
| Singapore | SEA | SGD | NONE | 0% (B2B) |
| Australia | ROW | AUD | AU_GST | 10% |


### Stripe Price IDs

```json
{
  "individual_monthly": {
    "USD": "price_1ABC123",
    "INR": "price_1ABC124",
    "EUR": "price_1ABC125"
  },
  "business_monthly": {
    "USD": "price_1DEF123",
    "INR": "price_1DEF124",
    "EUR": "price_1DEF125"
  },
  "business_yearly": {
    "USD": "price_1GHI123",
    "INR": "price_1GHI124",
    "EUR": "price_1GHI125"
  }
}
```

---
