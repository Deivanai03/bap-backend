import 'dotenv/config';
import { db } from '../lib/db/index.js';
import { organizations, users, subscriptions, payment_methods, plans } from '../lib/db/schema.js';
import { eq } from 'drizzle-orm';

// Plans data - All 7 plans (4 monthly + 3 yearly)
const seedPlans = [
  {
    name: 'Free',
    slug: 'free',
    display_name: 'Free Plan',
    description: 'Perfect for getting started',
    base_currency: 'USD',
    billing_period: 'monthly',
    stripe_product_id: 'prod_free',
    stripe_prices: {
      USD: 'price_free_usd',
      INR: 'price_free_inr',
      EUR: 'price_free_eur'
    },
    features: {
      voice_mode: false,
      team_messaging: false,
      deep_dives: true,
      surge_engine: false,
      asset_driving: false,
      custom_ontology: false,
      sso: false,
      api_access: false
    },
    limits: {
      max_users: 1,
      max_deep_dives_per_month: 5,
      max_crafts_per_month: 10,
      max_storage_gb: 1,
      max_asset_connections: 0,
      max_skills: 5,
      context_window_tokens: 50000,
      requests_per_day: 100
    },
    tier: 'FREE',
    trial_days: 0,
    display_order: 1
  },
  {
    name: 'Pro',
    slug: 'pro-monthly',
    display_name: 'Pro Plan - Monthly',
    description: 'For individual professionals',
    base_currency: 'USD',
    billing_period: 'monthly',
    stripe_product_id: 'prod_pro',
    stripe_prices: {
      USD: 'price_pro_usd_monthly',
      INR: 'price_pro_inr_monthly',
      EUR: 'price_pro_eur_monthly'
    },
    features: {
      voice_mode: true,
      team_messaging: false,
      deep_dives: true,
      surge_engine: true,
      asset_driving: false,
      custom_ontology: false,
      sso: false,
      api_access: true
    },
    limits: {
      max_users: 1,
      max_deep_dives_per_month: 50,
      max_crafts_per_month: 100,
      max_storage_gb: 10,
      max_asset_connections: 5,
      max_skills: 20,
      context_window_tokens: 200000,
      requests_per_day: 1000
    },
    tier: 'PRO',
    trial_days: 14,
    display_order: 2
  },
  {
    name: 'Business',
    slug: 'business-monthly',
    display_name: 'Business Plan - Monthly',
    description: 'For growing teams and businesses',
    base_currency: 'USD',
    billing_period: 'monthly',
    stripe_product_id: 'prod_business',
    stripe_prices: {
      USD: 'price_business_usd_monthly',
      INR: 'price_business_inr_monthly',
      EUR: 'price_business_eur_monthly'
    },
    features: {
      voice_mode: true,
      team_messaging: true,
      deep_dives: true,
      surge_engine: true,
      asset_driving: false,
      custom_ontology: false,
      sso: false,
      api_access: true
    },
    limits: {
      max_users: 5,
      max_deep_dives_per_month: 50,
      max_crafts_per_month: 100,
      max_storage_gb: 50,
      max_asset_connections: 10,
      max_skills: 20,
      context_window_tokens: 200000,
      requests_per_day: 1000
    },
    tier: 'BUSINESS',
    trial_days: 14,
    display_order: 3
  },
  {
    name: 'Enterprise',
    slug: 'enterprise-monthly',
    display_name: 'Enterprise Plan - Monthly',
    description: 'For large organizations with advanced needs',
    base_currency: 'USD',
    billing_period: 'monthly',
    stripe_product_id: 'prod_enterprise',
    stripe_prices: {
      USD: 'price_enterprise_usd_monthly',
      INR: 'price_enterprise_inr_monthly',
      EUR: 'price_enterprise_eur_monthly'
    },
    features: {
      voice_mode: true,
      team_messaging: true,
      deep_dives: true,
      surge_engine: true,
      asset_driving: true,
      custom_ontology: true,
      sso: true,
      api_access: true
    },
    limits: {
      max_users: 100,
      max_deep_dives_per_month: 500,
      max_crafts_per_month: 1000,
      max_storage_gb: 200,
      max_asset_connections: 100,
      max_skills: 100,
      context_window_tokens: 500000,
      requests_per_day: 10000
    },
    tier: 'ENTERPRISE',
    trial_days: 30,
    display_order: 4
  },
  // Yearly Plans (with ~17% discount)
  {
    name: 'Pro',
    slug: 'pro-yearly',
    display_name: 'Pro Plan - Yearly',
    description: 'For individual professionals (Save 17%)',
    base_currency: 'USD',
    billing_period: 'yearly',
    stripe_product_id: 'prod_pro_yearly',
    stripe_prices: {
      USD: 'price_pro_usd_yearly',
      INR: 'price_pro_inr_yearly',
      EUR: 'price_pro_eur_yearly'
    },
    features: {
      voice_mode: true,
      team_messaging: false,
      deep_dives: true,
      surge_engine: true,
      asset_driving: false,
      custom_ontology: false,
      sso: false,
      api_access: true
    },
    limits: {
      max_users: 1,
      max_deep_dives_per_month: 50,
      max_crafts_per_month: 100,
      max_storage_gb: 10,
      max_asset_connections: 5,
      max_skills: 20,
      context_window_tokens: 200000,
      requests_per_day: 1000
    },
    tier: 'PRO',
    trial_days: 14,
    display_order: 5
  },
  {
    name: 'Business',
    slug: 'business-yearly',
    display_name: 'Business Plan - Yearly',
    description: 'For growing teams and businesses (Save 17%)',
    base_currency: 'USD',
    billing_period: 'yearly',
    stripe_product_id: 'prod_business_yearly',
    stripe_prices: {
      USD: 'price_business_usd_yearly',
      INR: 'price_business_inr_yearly',
      EUR: 'price_business_eur_yearly'
    },
    features: {
      voice_mode: true,
      team_messaging: true,
      deep_dives: true,
      surge_engine: true,
      asset_driving: false,
      custom_ontology: false,
      sso: false,
      api_access: true
    },
    limits: {
      max_users: 5,
      max_deep_dives_per_month: 50,
      max_crafts_per_month: 100,
      max_storage_gb: 50,
      max_asset_connections: 10,
      max_skills: 20,
      context_window_tokens: 200000,
      requests_per_day: 1000
    },
    tier: 'BUSINESS',
    trial_days: 14,
    display_order: 6
  },
  {
    name: 'Enterprise',
    slug: 'enterprise-yearly',
    display_name: 'Enterprise Plan - Yearly',
    description: 'For large organizations with advanced needs (Save 17%)',
    base_currency: 'USD',
    billing_period: 'yearly',
    stripe_product_id: 'prod_enterprise_yearly',
    stripe_prices: {
      USD: 'price_enterprise_usd_yearly',
      INR: 'price_enterprise_inr_yearly',
      EUR: 'price_enterprise_eur_yearly'
    },
    features: {
      voice_mode: true,
      team_messaging: true,
      deep_dives: true,
      surge_engine: true,
      asset_driving: true,
      custom_ontology: true,
      sso: true,
      api_access: true
    },
    limits: {
      max_users: 100,
      max_deep_dives_per_month: 500,
      max_crafts_per_month: 1000,
      max_storage_gb: 200,
      max_asset_connections: 100,
      max_skills: 100,
      context_window_tokens: 500000,
      requests_per_day: 10000
    },
    tier: 'ENTERPRISE',
    trial_days: 30,
    display_order: 7
  }
];

async function seedDatabase() {
  console.log('🌱 Seeding complete database...');

  try {
    // 1. Seed Plans
    console.log('📋 Seeding plans...');
    for (const plan of seedPlans) {
      await db.insert(plans).values(plan).onConflictDoNothing();
      console.log(`✅ Seeded plan: ${plan.name}`);
    }

    // 2. Seed Test Organizations
    console.log('🏢 Seeding organizations...');
    await db.insert(organizations).values([
      {
        id: '840d240d-679d-4f16-94ed-2dc23580d20a',
        name: 'Acme Corp',
        slug: 'acme-corp',
        display_name: 'Acme Corporation Ltd.',
        home_region: 'IN',
        billing_country: 'IN',
        currency: 'INR',
        tax_profile: 'IND_GST',
        billing_email: 'billing@acme.com',
        plan_tier: 'FREE',
        status: 'active',
        onboarding_completed: true
      },
      {
        id: '7ee8f94a-9b73-4dc9-873e-227a813953a6',
        name: 'Tech Solutions Pvt Ltd',
        slug: 'tech-solutions',
        display_name: 'Tech Solutions Private Limited',
        home_region: 'IN',
        billing_country: 'IN',
        currency: 'INR',
        tax_profile: 'IND_GST',
        billing_email: 'accounts@techsolutions.com',
        plan_tier: 'PRO',
        status: 'active',
        onboarding_completed: true
      }
    ]).onConflictDoNothing();

    console.log('✅ Organizations seeded');

    // 3. Seed Test Users
    console.log('👥 Seeding users...');
    await db.insert(users).values([
      {
        id: 'f3531efd-e450-40f9-9f55-b8983a7b7f50',
        org_id: '840d240d-679d-4f16-94ed-2dc23580d20a',
        email: 'deivanaiayyappan02@gmail.com',
        full_name: 'John Doe',
        nickname: 'John',
        role: 'OWNER',
        status: 'active',
        email_verified: true,
        locale: 'en-IN',
        time_zone: 'Asia/Kolkata'
      },
      {
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        org_id: '7ee8f94a-9b73-4dc9-873e-227a813953a6',
        email: 'admin@techsolutions.com',
        full_name: 'Jane Smith',
        nickname: 'Jane',
        role: 'OWNER',
        status: 'active',
        email_verified: true,
        locale: 'en-IN',
        time_zone: 'Asia/Kolkata'
      },
      {
        id: 'b2c3d4e5-f6a7-8901-bcde-f23456789012',
        org_id: '840d240d-679d-4f16-94ed-2dc23580d20a',
        email: 'kabilanvelmani@gmail.com',
        full_name: 'Kabilan Velmani',
        nickname: 'Kabilan',
        role: 'ADMIN',
        status: 'active',
        email_verified: true,
        locale: 'en-IN',
        time_zone: 'Asia/Kolkata'
      }
    ]).onConflictDoNothing();

    console.log('✅ Users seeded');

    // 4. Get plan IDs for subscriptions
    const freePlan = await db.select().from(plans).where(eq(plans.tier, 'FREE')).limit(1);
    const proPlan = await db.select().from(plans).where(eq(plans.tier, 'PRO')).limit(1);

    // 5. Seed Test Subscriptions
    console.log('💳 Seeding subscriptions...');
    await db.insert(subscriptions).values([
      {
        org_id: '840d240d-679d-4f16-94ed-2dc23580d20a',
        plan_id: freePlan[0]?.id,
        stripe_subscription_id: 'sub_1234567890',
        stripe_customer_id: 'cus_test_acme',
        currency: 'INR',
        amount_excl_tax: '0.00',
        tax_rate: '0.18',
        amount_incl_tax: '0.00',
        current_period_start: new Date('2026-01-01'),
        current_period_end: new Date('2026-02-01'),
        status: 'active'
      },
      {
        org_id: '7ee8f94a-9b73-4dc9-873e-227a813953a6',
        plan_id: proPlan[0]?.id,
        stripe_subscription_id: 'sub_0987654321',
        stripe_customer_id: 'cus_test_tech',
        currency: 'INR',
        amount_excl_tax: '2542.37',
        tax_rate: '0.18',
        amount_incl_tax: '3000.00',
        current_period_start: new Date('2026-01-01'),
        current_period_end: new Date('2026-02-01'),
        status: 'active'
      }
    ]).onConflictDoNothing();

    console.log('✅ Subscriptions seeded');

    // 6. Seed Test Payment Methods
    console.log('💰 Seeding payment methods...');
    await db.insert(payment_methods).values([
      {
        org_id: '7ee8f94a-9b73-4dc9-873e-227a813953a6',
        user_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        stripe_payment_method_id: 'pm_test_visa_4242',
        type: 'card',
        card_brand: 'visa',
        card_last4: '4242',
        card_exp_month: 12,
        card_exp_year: 2027,
        is_default: true,
        is_verified: true
      }
    ]).onConflictDoNothing();

    console.log('✅ Payment methods seeded');

    console.log('\n🎉 Database seeded successfully!');
    console.log('\n📋 Test Accounts for API Testing:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('1. 🆓 Acme Corp (FREE plan)');
    console.log('   📧 Email: deivanaiayyappan02@gmail.com');
    console.log('   🏢 Org ID: 840d240d-679d-4f16-94ed-2dc23580d20a');
    console.log('   👤 User ID: f3531efd-e450-40f9-9f55-b8983a7b7f50');
    console.log('');
    console.log('2. 🚀 Tech Solutions (PRO plan)');
    console.log('   📧 Email: admin@techsolutions.com');
    console.log('   🏢 Org ID: 7ee8f94a-9b73-4dc9-873e-227a813953a6');
    console.log('   👤 User ID: a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    console.log('   💳 Has payment method: Visa ****4242');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n🧪 Ready for API testing!');
    console.log('\n📝 Quick Setup for Other Developers:');
    console.log('1. Clone repo');
    console.log('2. Update .env with Neon DB URL');
    console.log('3. npm install');
    console.log('4. npm run seed');
    console.log('5. npm run dev');

  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  }

  process.exit(0);
}

seedDatabase();
