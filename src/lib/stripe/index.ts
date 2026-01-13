import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is required');
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-12-15.clover',
  typescript: true,
});

export async function createCustomer(email: string, name: string, organizationId: string) {
  try {
    return await stripe.customers.create({
      email,
      name,
      metadata: { organizationId }
    });
  } catch {
    return null;
  }
}

export async function getCustomer(customerId: string) {
  try {
    return await stripe.customers.retrieve(customerId);
  } catch {
    return null;
  }
}

export async function getPaymentMethods(customerId: string) {
  try {
    return await stripe.paymentMethods.list({
      customer: customerId,
      type: 'card'
    });
  } catch {
    return null;
  }
}

export async function attachPaymentMethod(paymentMethodId: string, customerId: string) {
  try {
    return await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId
    });
  } catch {
    return null;
  }
}

export async function detachPaymentMethod(paymentMethodId: string) {
  try {
    return await stripe.paymentMethods.detach(paymentMethodId);
  } catch {
    return null;
  }
}

export async function createSubscription(customerId: string, priceId: string, taxId?: string) {
  try {
    const subscriptionData: any = {
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      automatic_tax: {
        enabled: true, // Enable Stripe Tax
      },
      expand: ['latest_invoice.payment_intent']
    };

    // Add tax ID if provided (e.g., GST number)
    if (taxId) {
      subscriptionData.customer_details = {
        tax_exempt: 'none',
        tax_ids: [
          {
            type: 'in_gst', // GST for India - can be dynamic later
            value: taxId
          }
        ]
      };
    }

    return await stripe.subscriptions.create(subscriptionData);
  } catch {
    return null;
  }
}

export async function getSubscription(subscriptionId: string) {
  try {
    return await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['default_payment_method']
    });
  } catch {
    return null;
  }
}

export async function updateSubscription(subscriptionId: string, priceId: string, taxId?: string) {
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    
    // Clear all existing items and add the new one
    const items = subscription.items.data.map((item, index) => ({
      id: item.id,
      ...(index === 0 ? { price: priceId } : { deleted: true })
    }));

    const updateData: any = {
      items,
      proration_behavior: 'create_prorations',
      automatic_tax: {
        enabled: true,
      },
      expand: ['latest_invoice']
    };

    // Update tax ID if provided
    if (taxId) {
      updateData.customer_details = {
        tax_exempt: 'none',
        tax_ids: [
          {
            type: 'in_gst',
            value: taxId
          }
        ]
      };
    }

    return await stripe.subscriptions.update(subscriptionId, updateData);
  } catch (error) {
    console.error('Stripe updateSubscription error:', error);
    return null;
  }
}

export async function cancelSubscription(subscriptionId: string) {
  try {
    return await stripe.subscriptions.cancel(subscriptionId);
  } catch {
    return null;
  }
}

export async function getInvoices(customerId: string, limit: number = 10) {
  try {
    return await stripe.invoices.list({
      customer: customerId,
      limit
    });
  } catch {
    return null;
  }
}
