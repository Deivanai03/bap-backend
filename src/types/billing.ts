import { z } from 'zod';

// Plan Types
export const PlanSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  display_name: z.string().nullable(),
  description: z.string().nullable(),
  base_currency: z.string().length(3),
  billing_period: z.enum(['monthly', 'yearly']),
  stripe_product_id: z.string().nullable(),
  stripe_prices: z.record(z.string()),
  features: z.record(z.boolean()),
  limits: z.record(z.number()),
  tier: z.enum(['FREE', 'PRO', 'BUSINESS', 'ENTERPRISE']),
  is_public: z.boolean(),
  trial_days: z.number().nullable(),
  is_active: z.boolean(),
  display_order: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Plan = z.infer<typeof PlanSchema>;

// Subscription Types
export const SubscriptionSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  plan_id: z.string().uuid(),
  stripe_subscription_id: z.string().nullable(),
  stripe_customer_id: z.string(),
  currency: z.string().length(3),
  amount_excl_tax: z.number(),
  tax_rate: z.number(),
  amount_incl_tax: z.number(),
  current_period_start: z.string(),
  current_period_end: z.string(),
  status: z.enum(['active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete']),
  cancel_at_period_end: z.boolean(),
  canceled_at: z.string().nullable(),
  trial_start: z.string().nullable(),
  trial_end: z.string().nullable(),
  default_payment_method: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Subscription = z.infer<typeof SubscriptionSchema>;

// Payment Method Types
export const PaymentMethodSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  user_id: z.string().uuid(),
  stripe_payment_method_id: z.string(),
  type: z.enum(['card', 'bank_account', 'upi']),
  card_brand: z.string().nullable(),
  card_last4: z.string().nullable(),
  card_exp_month: z.number().nullable(),
  card_exp_year: z.number().nullable(),
  is_default: z.boolean(),
  is_verified: z.boolean(),
  created_at: z.string(),
});

export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

// API Request/Response Types
export const UpgradeSubscriptionSchema = z.object({
  plan_id: z.string().uuid(),
  proration: z.boolean().optional(),
});

export const CancelSubscriptionSchema = z.object({
  cancel_at_period_end: z.boolean(),
  reason: z.string().optional(),
  feedback: z.string().optional(),
});

export const AddPaymentMethodSchema = z.object({
  stripe_payment_method_id: z.string(),
  set_as_default: z.boolean().optional(),
});

export type UpgradeSubscriptionRequest = z.infer<typeof UpgradeSubscriptionSchema>;
export type CancelSubscriptionRequest = z.infer<typeof CancelSubscriptionSchema>;
export type AddPaymentMethodRequest = z.infer<typeof AddPaymentMethodSchema>;
