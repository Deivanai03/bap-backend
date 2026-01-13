import 'dotenv/config';
import { stripe } from '../lib/stripe/index.ts';

const plans = [
  {
    name: 'Free',
    description: 'Perfect for getting started',
    tier: 'FREE',
    monthly_price: { USD: 0, INR: 0, EUR: 0 },
    yearly_price: null // Free plan has no yearly version
  },
  {
    name: 'Pro',
    description: 'For individual professionals',
    tier: 'PRO',
    monthly_price: { USD: 29, INR: 2400, EUR: 25 },
    yearly_price: { USD: 290, INR: 24000, EUR: 250 } // ~17% discount
  },
  {
    name: 'Business',
    description: 'For growing teams and businesses',
    tier: 'BUSINESS',
    monthly_price: { USD: 99, INR: 8200, EUR: 85 },
    yearly_price: { USD: 990, INR: 82000, EUR: 850 }
  },
  {
    name: 'Enterprise',
    description: 'For large organizations with advanced needs',
    tier: 'ENTERPRISE',
    monthly_price: { USD: 299, INR: 24900, EUR: 255 },
    yearly_price: { USD: 2990, INR: 249000, EUR: 2550 }
  }
];

async function createStripeProducts() {
  console.log('Creating Stripe products and prices...');
  
  const results = [];
  
  for (const plan of plans) {
    try {
      // Create product
      const product = await stripe.products.create({
        name: plan.name,
        description: plan.description,
        metadata: { tier: plan.tier }
      });
      
      console.log(`✅ Created product: ${plan.name} (${product.id})`);
      
      const prices = {};
      
      // Create monthly prices
      for (const [currency, amount] of Object.entries(plan.monthly_price)) {
        const price = await stripe.prices.create({
          product: product.id,
          unit_amount: amount * 100, // Convert to cents
          currency: currency.toLowerCase(),
          recurring: { interval: 'month' },
          nickname: `${plan.name} Monthly ${currency}`
        });
        
        prices[`${currency}_monthly`] = price.id;
        console.log(`  ✅ Created monthly price: ${currency} ${amount} (${price.id})`);
      }
      
      // Create yearly prices (if exists)
      if (plan.yearly_price) {
        for (const [currency, amount] of Object.entries(plan.yearly_price)) {
          const price = await stripe.prices.create({
            product: product.id,
            unit_amount: amount * 100, // Convert to cents
            currency: currency.toLowerCase(),
            recurring: { interval: 'year' },
            nickname: `${plan.name} Yearly ${currency}`
          });
          
          prices[`${currency}_yearly`] = price.id;
          console.log(`  ✅ Created yearly price: ${currency} ${amount} (${price.id})`);
        }
      }
      
      results.push({
        tier: plan.tier,
        name: plan.name,
        product_id: product.id,
        prices
      });
      
    } catch (error) {
      console.error(`❌ Error creating ${plan.name}:`, error.message);
    }
  }
  
  console.log('\n📋 Stripe Products Created:');
  console.log(JSON.stringify(results, null, 2));
  
  return results;
}

createStripeProducts().catch(console.error);
