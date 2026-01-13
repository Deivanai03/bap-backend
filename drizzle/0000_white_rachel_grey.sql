CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"user_id" uuid,
	"event_type" varchar(100) NOT NULL,
	"event_category" varchar(50) NOT NULL,
	"actor_type" varchar(20) NOT NULL,
	"actor_id" varchar(255),
	"resource_type" varchar(50),
	"resource_id" uuid,
	"action" varchar(100) NOT NULL,
	"description" text,
	"changes" jsonb,
	"metadata" jsonb,
	"ip_address" "inet",
	"user_agent" text,
	"request_id" varchar(255),
	"gdpr_relevant" boolean DEFAULT false,
	"hipaa_relevant" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"subscription_id" uuid,
	"stripe_invoice_id" varchar(255),
	"stripe_charge_id" varchar(255),
	"invoice_number" varchar(100) NOT NULL,
	"currency" char(3) NOT NULL,
	"subtotal" numeric(10, 2) NOT NULL,
	"tax_amount" numeric(10, 2) DEFAULT '0',
	"total" numeric(10, 2) NOT NULL,
	"amount_paid" numeric(10, 2) DEFAULT '0',
	"amount_due" numeric(10, 2) DEFAULT '0',
	"tax_profile" varchar(20),
	"tax_id" varchar(100),
	"tax_breakdown" jsonb,
	"billing_country" char(2) NOT NULL,
	"billing_address" jsonb,
	"line_items" jsonb NOT NULL,
	"status" varchar(20) NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"payment_method" varchar(50),
	"payment_intent_id" varchar(255),
	"pdf_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_stripe_invoice_id_unique" UNIQUE("stripe_invoice_id"),
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"display_name" varchar(255),
	"home_region" varchar(10) NOT NULL,
	"billing_country" char(2) NOT NULL,
	"currency" char(3) NOT NULL,
	"tax_profile" varchar(20) DEFAULT 'NONE' NOT NULL,
	"compliance_profile" varchar(20) DEFAULT 'DEFAULT' NOT NULL,
	"billing_email" varchar(255) NOT NULL,
	"tax_id" varchar(100),
	"billing_address" jsonb,
	"plan_tier" varchar(20) DEFAULT 'FREE' NOT NULL,
	"is_trial" boolean DEFAULT false NOT NULL,
	"trial_ends_at" timestamp with time zone DEFAULT NOW() NOT NULL,
	"feature_overrides" jsonb DEFAULT '{}',
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"suspended_reason" text,
	"industry" varchar(100),
	"company_size" varchar(20),
	"onboarding_completed" boolean DEFAULT false NOT NULL,
	"onboarding_step" varchar(50),
	"settings" jsonb DEFAULT '{}',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"stripe_payment_method_id" varchar(255) NOT NULL,
	"type" varchar(20) NOT NULL,
	"card_brand" varchar(20),
	"card_last4" varchar(4),
	"card_exp_month" integer,
	"card_exp_year" integer,
	"bank_name" varchar(100),
	"bank_last4" varchar(4),
	"is_default" boolean DEFAULT false NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"billing_address" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "payment_methods_stripe_payment_method_id_unique" UNIQUE("stripe_payment_method_id")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(50) NOT NULL,
	"display_name" varchar(255),
	"description" text,
	"base_currency" char(3) NOT NULL,
	"billing_period" varchar(20) NOT NULL,
	"stripe_product_id" varchar(255),
	"stripe_prices" jsonb NOT NULL,
	"features" jsonb NOT NULL,
	"limits" jsonb NOT NULL,
	"tier" varchar(20) NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"trial_days" integer DEFAULT 0,
	"is_active" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"display_order" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"stripe_subscription_id" varchar(255),
	"stripe_customer_id" varchar(255) NOT NULL,
	"currency" char(3) NOT NULL,
	"amount_excl_tax" numeric(10, 2) NOT NULL,
	"tax_rate" numeric(5, 4) DEFAULT '0',
	"amount_incl_tax" numeric(10, 2) NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"billing_cycle_anchor" timestamp with time zone,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"canceled_at" timestamp with time zone,
	"cancellation_reason" text,
	"trial_start" timestamp with time zone,
	"trial_end" timestamp with time zone,
	"default_payment_method" varchar(255),
	"collection_method" varchar(20) DEFAULT 'charge_automatically',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
CREATE TABLE "usage_tracking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"metric_name" varchar(100) NOT NULL,
	"metric_value" numeric(15, 4) NOT NULL,
	"unit" varchar(20),
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"metadata" jsonb,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"session_token" varchar(255) NOT NULL,
	"refresh_token" varchar(255),
	"device_type" varchar(20),
	"device_name" varchar(255),
	"os" varchar(50),
	"browser" varchar(50),
	"ip_address" "inet",
	"user_agent" text,
	"location" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "user_sessions_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"full_name" varchar(255),
	"nickname" varchar(100),
	"avatar_url" text,
	"role" varchar(20) DEFAULT 'MEMBER' NOT NULL,
	"permissions" jsonb DEFAULT '[]',
	"locale" varchar(10) DEFAULT 'en-US' NOT NULL,
	"time_zone" varchar(50) DEFAULT 'UTC' NOT NULL,
	"theme" varchar(10) DEFAULT 'system',
	"font_size" varchar(10) DEFAULT 'default',
	"contrast_mode" boolean DEFAULT false,
	"notification_preferences" jsonb DEFAULT '{"product_updates": true, "useful_info": true}',
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"invited_by" uuid,
	"invitation_token" varchar(255),
	"invitation_expires_at" timestamp with time zone,
	"email_verified" boolean DEFAULT false NOT NULL,
	"magic_link_token" varchar(255),
	"magic_link_expires" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"last_active_at" timestamp with time zone,
	"login_count" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_org_id_email_unique" UNIQUE("org_id","email")
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_tracking" ADD CONSTRAINT "usage_tracking_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_tracking" ADD CONSTRAINT "usage_tracking_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;