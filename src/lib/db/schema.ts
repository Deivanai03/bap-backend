import { sql } from "drizzle-orm";
import { pgTable, uuid, varchar, boolean, timestamp, jsonb, text, integer, inet, unique, char } from "drizzle-orm/pg-core"; 

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

// Organizations Table
export const organizations = pgTable('organizations', {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),

    // IDENTITY
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull().unique(),
    display_name: varchar('display_name', { length: 255 }),

    // REGIONAL CONFIGURATION
    home_region: varchar('home_region', { length: 10 }).notNull(),
    billing_country: char('billing_country', { length: 2 }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    tax_profile: varchar('tax_profile', { length: 20 }).default('NONE').notNull(),
    compliance_profile: varchar('compliance_profile', { length: 20 }).default('DEFAULT').notNull(),

    // BILLING METADATA
    billing_email: varchar('billing_email', { length: 255 }).notNull(),
    tax_id: varchar('tax_id', { length: 100 }),
    billing_address: jsonb('billing_address'),

    // PLAN & LIMITS
    plan_tier: varchar('plan_tier', { length: 20 }).default('INDIVIDUAL').notNull(),
    is_trial: boolean('is_trial').default(false).notNull(),
    trial_ends_at: timestamptz('trial_ends_at').default(sql`NOW()`).notNull(),

    // FEATURE FLAGS
    feature_overrides: jsonb('feature_overrides').default('{}'),

    // STATUS
    status: varchar('status', { length: 20 }).default('active').notNull(),
    suspended_reason: text('suspended_reason'),

    // METADATA
    industry: varchar('industry', { length: 100 }),
    company_size: varchar('company_size', { length: 20 }),
    onboarding_completed: boolean('onboarding_completed').default(false).notNull(),
    onboarding_step: varchar('onboarding_step', { length: 50 }),

    // SETTINGS
    settings: jsonb('settings').default('{}'),

    // TIMESTAMPS
    created_at: timestamptz('created_at').defaultNow().notNull(),
    updated_at: timestamptz('updated_at').defaultNow().notNull(),
    deleted_at: timestamptz('deleted_at'),
}, (table) => ({
    // Check constraints
    chkOrgStatus: sql`CONSTRAINT chk_org_status CHECK (status IN ('active', 'suspended', 'deleted'))`,
    chkPlanTier: sql`CONSTRAINT chk_plan_tier CHECK (plan_tier IN ('INDIVIDUAL', 'BUSINESS', 'ENTERPRISE'))`,
    chkHomeRegion: sql`CONSTRAINT chk_home_region CHECK (home_region IN ('IN', 'EU', 'US', 'ROW', 'SEA'))`,
}));

// Users Table
export const users = pgTable('users', {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),

    // ORGANIZATION
    org_id: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),

    // IDENTITY
    email: varchar('email', { length: 255 }).notNull(),
    full_name: varchar('full_name', { length: 255 }),
    nickname: varchar('nickname', { length: 100 }),
    avatar_url: text('avatar_url'),

    // ROLE & PERMISSIONS
    role: varchar('role', { length: 20 }).default('MEMBER').notNull(),
    permissions: jsonb('permissions').default('[]'),

    // LOCALIZATION
    locale: varchar('locale', { length: 10 }).default('en-US').notNull(),
    time_zone: varchar('time_zone', { length: 50 }).default('UTC').notNull(),

    // USER PREFERENCES
    theme: varchar('theme', { length: 10 }).default('system'),
    font_size: varchar('font_size', { length: 10 }).default('default'),
    contrast_mode: boolean('contrast_mode').default(false),
    notification_preferences: jsonb('notification_preferences').default('{"product_updates": true, "useful_info": true}'),

    // STATUS
    status: varchar('status', { length: 20 }).default('active').notNull(),
    invited_by: uuid('invited_by').references(() => users.id),
    invitation_token: varchar('invitation_token', { length: 255 }),
    invitation_expires_at: timestamptz('invitation_expires_at'),
    email_verified: boolean('email_verified').default(false).notNull(),

    // MAGIC LINK AUTH
    magic_link_token: varchar('magic_link_token', { length: 255 }),
    magic_link_expires: timestamptz('magic_link_expires'),

    // ACTIVITY
    last_login_at: timestamptz('last_login_at'),
    last_active_at: timestamptz('last_active_at'),
    login_count: integer('login_count').default(0),

    // TIMESTAMPS
    created_at: timestamptz('created_at').defaultNow().notNull(),
    updated_at: timestamptz('updated_at').defaultNow().notNull(),
    deleted_at: timestamptz('deleted_at'),
}, (table) => ({
    uniqueOrgEmail: unique().on(table.org_id, table.email),
    // Check constraints
    chkUserRole: sql`CONSTRAINT chk_user_role CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER', 'GUEST'))`,
    chkUserStatus: sql`CONSTRAINT chk_user_status CHECK (status IN ('active', 'invited', 'suspended', 'deleted'))`,
    chkTheme: sql`CONSTRAINT chk_theme CHECK (theme IN ('system', 'dark', 'light'))`,
    chkFontSize: sql`CONSTRAINT chk_font_size CHECK (font_size IN ('small', 'default', 'large'))`,
}));

// User Sessions Table
export const user_sessions = pgTable('user_sessions', {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),

    user_id: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    org_id: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),

    // SESSION
    session_token: varchar('session_token', { length: 255 }).notNull().unique(),
    refresh_token: varchar('refresh_token', { length: 255 }),

    // DEVICE CONTEXT
    device_type: varchar('device_type', { length: 20 }),
    device_name: varchar('device_name', { length: 255 }),
    os: varchar('os', { length: 50 }),
    browser: varchar('browser', { length: 50 }),

    // NETWORK
    ip_address: inet('ip_address'),
    user_agent: text('user_agent'),
    location: jsonb('location'),

    // SESSION STATE
    is_active: boolean('is_active').default(true).notNull(),
    last_activity_at: timestamptz('last_activity_at').defaultNow().notNull(),

    // TIMESTAMPS
    created_at: timestamptz('created_at').defaultNow().notNull(),
    expires_at: timestamptz('expires_at').notNull(),
    revoked_at: timestamptz('revoked_at'),
}, (table) => ({
    // Check constraints
    chkDeviceType: sql`CONSTRAINT chk_device_type CHECK (device_type IN ('desktop', 'mobile', 'tablet'))`,
}));

// Audit Events Table
export const audit_events = pgTable('audit_events', {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    
    // CONTEXT
    org_id: uuid('org_id').references(() => organizations.id),
    user_id: uuid('user_id').references(() => users.id),
    
    // EVENT
    event_type: varchar('event_type', { length: 100 }).notNull(),
    event_category: varchar('event_category', { length: 50 }).notNull(),
    
    // ACTOR
    actor_type: varchar('actor_type', { length: 20 }).notNull(),
    actor_id: varchar('actor_id', { length: 255 }),
    
    // TARGET
    resource_type: varchar('resource_type', { length: 50 }),
    resource_id: uuid('resource_id'),
    
    // DETAILS
    action: varchar('action', { length: 100 }).notNull(),
    description: text('description'),
    changes: jsonb('changes'),
    metadata: jsonb('metadata'),
    
    // REQUEST CONTEXT
    ip_address: inet('ip_address'),
    user_agent: text('user_agent'),
    request_id: varchar('request_id', { length: 255 }),
    
    // COMPLIANCE
    gdpr_relevant: boolean('gdpr_relevant').default(false),
    hipaa_relevant: boolean('hipaa_relevant').default(false),
    
    // TIMESTAMP
    created_at: timestamptz('created_at').defaultNow().notNull(),
});