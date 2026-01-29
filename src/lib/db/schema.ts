import { sql } from "drizzle-orm";
import { pgTable, uuid, varchar, boolean, timestamp, jsonb, text, integer, inet, unique, char, decimal, date, bigint } from "drizzle-orm/pg-core"; 

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
    billing_email: varchar('billing_email', { length: 255 }).notNull().unique(),
    tax_id: varchar('tax_id', { length: 100 }),
    billing_address: jsonb('billing_address'),

    // PLAN & LIMITS
    plan_tier: varchar('plan_tier', { length: 20 }).default('FREE').notNull(),
    is_trial: boolean('is_trial').default(false).notNull(),
    trial_ends_at: timestamptz('trial_ends_at'),

    // FEATURE FLAGS
    feature_overrides: jsonb('feature_overrides').default('{}'),

    // STATUS
    status: varchar('status', { length: 20 }).default('active').notNull(),
    suspended_reason: text('suspended_reason'),

    // METADATA
    industry: varchar('industry', { length: 100 }),
    company_size: varchar('company_size', { length: 20 }),
    onboarding_completed: boolean('onboarding_completed').default(false).notNull(),

    // SETTINGS
    settings: jsonb('settings').default('{}'),

    // TIMESTAMPS
    created_at: timestamptz('created_at').defaultNow().notNull(),
    updated_at: timestamptz('updated_at').defaultNow().notNull(),
    deleted_at: timestamptz('deleted_at'),
}, (table) => ({
    // Check constraints
    chkOrgStatus: sql`CONSTRAINT chk_org_status CHECK (status IN ('active', 'suspended', 'deleted'))`,
    chkPlanTier: sql`CONSTRAINT chk_plan_tier CHECK (plan_tier IN ('FREE', 'PRO', 'BUSINESS', 'ENTERPRISE'))`,
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
    online_status: varchar('online_status', { length: 20 }).default('offline').notNull(),
    last_seen: timestamptz('last_seen'),
    onboarding_completed: boolean('onboarding_completed').default(false).notNull(),
    invited_by: uuid('invited_by').references(() => users.id),
    invitation_token: varchar('invitation_token', { length: 255 }),
    invitation_expires_at: timestamptz('invitation_expires_at'),
    email_verified: boolean('email_verified').default(false).notNull(),

    // MAGIC LINK AUTH
    magic_link_token: varchar('magic_link_token', { length: 255 }),
    magic_link_expires: timestamptz('magic_link_expires'),
    
    // OTP AUTH (associated with magic link)
    otp_code: varchar('otp_code', { length: 6 }),
    otp_expires: timestamptz('otp_expires'),

    // ACTIVITY
    last_login_at: timestamptz('last_login_at'),
    last_active_at: timestamptz('last_active_at'),
    login_count: integer('login_count').default(0),

    // TIMESTAMPS
    created_at: timestamptz('created_at').defaultNow().notNull(),
    updated_at: timestamptz('updated_at').defaultNow().notNull(),
    deleted_at: timestamptz('deleted_at'),
}, (table) => ({
    uniqueEmail: unique().on(table.email),
    // Check constraints
    chkUserRole: sql`CONSTRAINT chk_user_role CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER', 'GUEST'))`,
    chkUserStatus: sql`CONSTRAINT chk_user_status CHECK (status IN ('active', 'invited', 'suspended', 'deleted'))`,
    chkOnlineStatus: sql`CONSTRAINT chk_online_status CHECK (online_status IN ('online', 'offline', 'away', 'busy'))`,
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
    device_id: varchar('device_id', { length: 255 }), // Persistent device identifier
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

// Plans Table
export const plans = pgTable('plans', {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    
    // IDENTITY
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 50 }).notNull().unique(),
    display_name: varchar('display_name', { length: 255 }),
    description: text('description'),
    
    // PRICING
    base_currency: char('base_currency', { length: 3 }).notNull(),
    billing_period: varchar('billing_period', { length: 20 }).notNull(),
    
    // STRIPE INTEGRATION
    stripe_product_id: varchar('stripe_product_id', { length: 255 }),
    stripe_prices: jsonb('stripe_prices').notNull(),
    
    // PRICING AMOUNTS
    base_price: decimal('base_price', { precision: 10, scale: 2 }),
    currency_prices: jsonb('currency_prices').default('{}'),
    
    // FEATURES & LIMITS
    features: jsonb('features').notNull(),
    limits: jsonb('limits').notNull(),
    
    // PLAN TIER
    tier: varchar('tier', { length: 20 }).notNull(),
    is_public: boolean('is_public').default(true).notNull(),
    
    // TRIAL
    trial_days: integer('trial_days').default(0),
    
    // STATUS
    is_active: boolean('is_active').default(true).notNull(),
    archived_at: timestamptz('archived_at'),
    
    // ORDERING
    display_order: integer('display_order').default(0),
    
    // TIMESTAMPS
    created_at: timestamptz('created_at').defaultNow().notNull(),
    updated_at: timestamptz('updated_at').defaultNow().notNull(),
}, (table) => ({
    chkPlanTier: sql`CONSTRAINT chk_plan_tier CHECK (tier IN ('FREE', 'PRO', 'BUSINESS', 'ENTERPRISE'))`,
    chkBillingPeriod: sql`CONSTRAINT chk_billing_period CHECK (billing_period IN ('monthly', 'yearly'))`,
}));

// Subscriptions Table
export const subscriptions = pgTable('subscriptions', {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    
    // ORGANIZATION
    org_id: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
    
    // PLAN
    plan_id: uuid('plan_id').references(() => plans.id).notNull(),
    
    // STRIPE
    stripe_subscription_id: varchar('stripe_subscription_id', { length: 255 }).unique(),
    stripe_customer_id: varchar('stripe_customer_id', { length: 255 }).notNull(),
    
    // BILLING
    currency: char('currency', { length: 3 }).notNull(),
    amount_excl_tax: decimal('amount_excl_tax', { precision: 10, scale: 2 }).notNull(),
    tax_rate: decimal('tax_rate', { precision: 5, scale: 4 }).default('0'),
    amount_incl_tax: decimal('amount_incl_tax', { precision: 10, scale: 2 }).notNull(),
    
    // PERIOD
    current_period_start: timestamptz('current_period_start').notNull(),
    current_period_end: timestamptz('current_period_end').notNull(),
    billing_cycle_anchor: timestamptz('billing_cycle_anchor'),
    
    // STATUS
    status: varchar('status', { length: 20 }).default('active').notNull(),
    cancel_at_period_end: boolean('cancel_at_period_end').default(false).notNull(),
    canceled_at: timestamptz('canceled_at'),
    cancellation_reason: text('cancellation_reason'),
    
    // TRIAL
    trial_start: timestamptz('trial_start'),
    trial_end: timestamptz('trial_end'),
    
    // PAYMENT
    default_payment_method: varchar('default_payment_method', { length: 255 }),
    collection_method: varchar('collection_method', { length: 20 }).default('charge_automatically'),
    
    // TIMESTAMPS
    created_at: timestamptz('created_at').defaultNow().notNull(),
    updated_at: timestamptz('updated_at').defaultNow().notNull(),
    ended_at: timestamptz('ended_at'),
}, (table) => ({
    chkSubscriptionStatus: sql`CONSTRAINT chk_subscription_status CHECK (status IN ('active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete'))`,
    chkCollectionMethod: sql`CONSTRAINT chk_collection_method CHECK (collection_method IN ('charge_automatically', 'send_invoice'))`,
}));

// Payment Methods Table
export const payment_methods = pgTable('payment_methods', {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    
    // ORGANIZATION
    org_id: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
    user_id: uuid('user_id').references(() => users.id).notNull(),
    
    // STRIPE
    stripe_payment_method_id: varchar('stripe_payment_method_id', { length: 255 }).notNull().unique(),
    
    // METHOD DETAILS
    type: varchar('type', { length: 20 }).notNull(),
    
    // CARD (if type = 'card')
    card_brand: varchar('card_brand', { length: 20 }),
    card_last4: varchar('card_last4', { length: 4 }),
    card_exp_month: integer('card_exp_month'),
    card_exp_year: integer('card_exp_year'),
    
    // BANK (if type = 'bank_account')
    bank_name: varchar('bank_name', { length: 100 }),
    bank_last4: varchar('bank_last4', { length: 4 }),
    
    // STATUS
    is_default: boolean('is_default').default(false).notNull(),
    is_verified: boolean('is_verified').default(false).notNull(),
    
    // BILLING ADDRESS
    billing_address: jsonb('billing_address'),
    
    // TIMESTAMPS
    created_at: timestamptz('created_at').defaultNow().notNull(),
    updated_at: timestamptz('updated_at').defaultNow().notNull(),
    deleted_at: timestamptz('deleted_at'),
}, (table) => ({
    chkPaymentType: sql`CONSTRAINT chk_payment_type CHECK (type IN ('card', 'bank_account', 'upi'))`,
}));

// Invoices Table
export const invoices = pgTable('invoices', {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    
    // ORGANIZATION
    org_id: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
    subscription_id: uuid('subscription_id').references(() => subscriptions.id),
    
    // STRIPE
    stripe_invoice_id: varchar('stripe_invoice_id', { length: 255 }).unique(),
    stripe_charge_id: varchar('stripe_charge_id', { length: 255 }),
    
    // INVOICE DETAILS
    invoice_number: varchar('invoice_number', { length: 100 }).notNull().unique(),
    
    // AMOUNTS
    currency: char('currency', { length: 3 }).notNull(),
    subtotal: decimal('subtotal', { precision: 10, scale: 2 }).notNull(),
    tax_amount: decimal('tax_amount', { precision: 10, scale: 2 }).default('0'),
    total: decimal('total', { precision: 10, scale: 2 }).notNull(),
    amount_paid: decimal('amount_paid', { precision: 10, scale: 2 }).default('0'),
    amount_due: decimal('amount_due', { precision: 10, scale: 2 }).default('0'),
    
    // TAX DETAILS
    tax_profile: varchar('tax_profile', { length: 20 }),
    tax_id: varchar('tax_id', { length: 100 }),
    tax_breakdown: jsonb('tax_breakdown'),
    
    // BILLING ADDRESS (snapshot at invoice time)
    billing_country: char('billing_country', { length: 2 }).notNull(),
    billing_address: jsonb('billing_address'),
    
    // LINE ITEMS
    line_items: jsonb('line_items').notNull(),
    
    // STATUS
    status: varchar('status', { length: 20 }).notNull(),
    
    // DATES
    issued_at: timestamptz('issued_at').notNull(),
    due_at: timestamptz('due_at'),
    paid_at: timestamptz('paid_at'),
    voided_at: timestamptz('voided_at'),
    
    // PAYMENT
    payment_method: varchar('payment_method', { length: 50 }),
    payment_intent_id: varchar('payment_intent_id', { length: 255 }),
    
    // FILES
    pdf_url: text('pdf_url'),
    
    // TIMESTAMPS
    created_at: timestamptz('created_at').defaultNow().notNull(),
    updated_at: timestamptz('updated_at').defaultNow().notNull(),
}, (table) => ({
    chkInvoiceStatus: sql`CONSTRAINT chk_invoice_status CHECK (status IN ('draft', 'open', 'paid', 'void', 'uncollectible'))`,
}));

// Usage Tracking Table
export const usage_tracking = pgTable('usage_tracking', {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    
    // ORGANIZATION
    org_id: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
    user_id: uuid('user_id').references(() => users.id),
    
    // METRIC
    metric_name: varchar('metric_name', { length: 100 }).notNull(),
    metric_value: decimal('metric_value', { precision: 15, scale: 4 }).notNull(),
    unit: varchar('unit', { length: 20 }),
    
    // PERIOD
    period_start: date('period_start').notNull(),
    period_end: date('period_end').notNull(),
    
    // METADATA
    metadata: jsonb('metadata'),
    
    // TIMESTAMPS
    recorded_at: timestamptz('recorded_at').defaultNow().notNull(),
    created_at: timestamptz('created_at').defaultNow().notNull(),
    updated_at: timestamptz('updated_at').defaultNow().notNull(),
}, (table) => ({
    chkMetricValue: sql`CONSTRAINT chk_metric_value CHECK (metric_value >= 0)`,
}));

// Chats Table
export const chats = pgTable('chats', {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    
    // ORGANIZATION
    org_id: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
    
    // CHAT DETAILS
    title: varchar('title', { length: 255 }),
    type: varchar('type', { length: 50 }).default('direct').notNull(),
    created_by: uuid('created_by').references(() => users.id).notNull(),
    
    // TIMESTAMPS
    last_message_at: timestamptz('last_message_at'),
    created_at: timestamptz('created_at').defaultNow().notNull(),
    updated_at: timestamptz('updated_at').defaultNow().notNull(),
}, (table) => ({
    chkChatType: sql`CONSTRAINT chk_chat_type CHECK (type IN ('direct', 'group'))`,
}));

// Chat Participants Table
export const chat_participants = pgTable('chat_participants', {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    
    // REFERENCES
    chat_id: uuid('chat_id').references(() => chats.id, { onDelete: 'cascade' }).notNull(),
    user_id: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    
    // PARTICIPANT SETTINGS
    is_pinned: boolean('is_pinned').default(false).notNull(),
    is_muted: boolean('is_muted').default(false).notNull(),
    unread_count: integer('unread_count').default(0).notNull(),
    
    // TIMESTAMPS
    joined_at: timestamptz('joined_at').defaultNow().notNull(),
}, (table) => ({
    uniqueChatUser: unique().on(table.chat_id, table.user_id),
}));

// Messages Table
export const messages = pgTable('messages', {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    
    // REFERENCES
    chat_id: uuid('chat_id').references(() => chats.id, { onDelete: 'cascade' }).notNull(),
    sender_id: uuid('sender_id').references(() => users.id).notNull(),
    reply_to: uuid('reply_to').references(() => messages.id),
    
    // MESSAGE CONTENT
    content: text('content'),
    message_type: varchar('message_type', { length: 50 }).default('text').notNull(),
    metadata: jsonb('metadata'),
    
    // TIMESTAMPS
    created_at: timestamptz('created_at').defaultNow().notNull(),
    updated_at: timestamptz('updated_at').defaultNow().notNull(),
}, (table) => ({
    chkMessageType: sql`CONSTRAINT chk_message_type CHECK (message_type IN ('text', 'image', 'video', 'audio', 'document', 'system'))`,
}));

// Labels Table
export const labels = pgTable('labels', {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    
    // ORGANIZATION & USER
    org_id: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
    user_id: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    
    // LABEL DETAILS
    name: varchar('name', { length: 100 }).notNull(),
    color: varchar('color', { length: 7 }).notNull(),
    
    // TIMESTAMPS
    created_at: timestamptz('created_at').defaultNow().notNull(),
    updated_at: timestamptz('updated_at').defaultNow().notNull(),
}, (table) => ({
    uniqueUserLabel: unique().on(table.user_id, table.name),
}));

// Chat Labels Table (many-to-many)
export const chat_labels = pgTable('chat_labels', {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    
    // REFERENCES
    chat_id: uuid('chat_id').references(() => chats.id, { onDelete: 'cascade' }).notNull(),
    label_id: uuid('label_id').references(() => labels.id, { onDelete: 'cascade' }).notNull(),
}, (table) => ({
    uniqueChatLabel: unique().on(table.chat_id, table.label_id),
}));

// File Uploads Table
export const file_uploads = pgTable('file_uploads', {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    
    // ORGANIZATION & USER
    org_id: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
    user_id: uuid('user_id').references(() => users.id).notNull(),
    
    // FILE DETAILS
    filename: varchar('filename', { length: 255 }).notNull(),
    original_name: varchar('original_name', { length: 255 }).notNull(),
    mime_type: varchar('mime_type', { length: 100 }).notNull(),
    size_bytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    file_path: text('file_path').notNull(),
    
    // STATUS
    upload_status: varchar('upload_status', { length: 50 }).default('completed').notNull(),
    
    // TIMESTAMPS
    created_at: timestamptz('created_at').defaultNow().notNull(),
}, (table) => ({
    chkUploadStatus: sql`CONSTRAINT chk_upload_status CHECK (upload_status IN ('pending', 'completed', 'failed'))`,
}));

// Voice Sessions Table
export const voice_sessions = pgTable('voice_sessions', {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    
    // ORGANIZATION & USER
    org_id: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
    user_id: uuid('user_id').references(() => users.id).notNull(),
    
    // SESSION DETAILS
    session_status: varchar('session_status', { length: 50 }).default('active').notNull(),
    transcript: text('transcript'),
    audio_duration: integer('audio_duration'),
    
    // TIMESTAMPS
    started_at: timestamptz('started_at').defaultNow().notNull(),
    ended_at: timestamptz('ended_at'),
}, (table) => ({
    chkSessionStatus: sql`CONSTRAINT chk_session_status CHECK (session_status IN ('active', 'ended', 'failed'))`,
}));

// Input Envelopes Table
export const input_envelopes = pgTable('input_envelopes', {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    
    // ORGANIZATION & USER
    org_id: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
    user_id: uuid('user_id').references(() => users.id).notNull(),
    
    // INPUT DETAILS
    input_type: varchar('input_type', { length: 50 }).notNull(),
    content: jsonb('content').notNull(),
    status: varchar('status', { length: 50 }).default('pending').notNull(),
    
    // TIMESTAMPS
    processed_at: timestamptz('processed_at'),
    created_at: timestamptz('created_at').defaultNow().notNull(),
}, (table) => ({
    chkInputType: sql`CONSTRAINT chk_input_type CHECK (input_type IN ('text', 'voice', 'image', 'document'))`,
    chkStatus: sql`CONSTRAINT chk_status CHECK (status IN ('pending', 'processing', 'completed', 'failed'))`,
}));

// Calls Table
export const calls = pgTable('calls', {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    
    // ORGANIZATION
    org_id: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
    
    // PARTICIPANTS
    caller_id: uuid('caller_id').references(() => users.id).notNull(),
    callee_id: uuid('callee_id').references(() => users.id).notNull(),
    
    // CALL DETAILS
    call_type: varchar('call_type', { length: 50 }).default('video').notNull(),
    status: varchar('status', { length: 50 }).default('initiated').notNull(),
    duration: integer('duration'),
    metadata: jsonb('metadata'),
    
    // TIMESTAMPS
    started_at: timestamptz('started_at').defaultNow().notNull(),
    ended_at: timestamptz('ended_at'),
}, (table) => ({
    chkCallType: sql`CONSTRAINT chk_call_type CHECK (call_type IN ('video', 'voice'))`,
    chkCallStatus: sql`CONSTRAINT chk_call_status CHECK (status IN ('initiated', 'ringing', 'active', 'ended', 'missed', 'declined'))`,
}));