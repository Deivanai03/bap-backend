import { NextRequest } from 'next/server';
import { stripe } from '../../../../lib/stripe';
import { createApiResponse, createErrorResponse } from '../../../../lib/api/response';
import { handleOptions } from '../../../../lib/api/cors';
import { apiRateLimit } from '../../../../lib/rate-limit';
import { db } from '../../../../lib/db';
import { subscriptions, invoices, audit_events, organizations } from '../../../../lib/db/schema';
import { eq } from 'drizzle-orm';
import { generateInvoicePDF } from '../../../../lib/services/pdf';

/**
 * @swagger
 * /api/webhooks/stripe:
 *   post:
 *     summary: Stripe webhook endpoint
 *     description: Handle Stripe webhook events for subscription and payment updates
 *     tags: [Webhooks]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Stripe webhook event payload
 *     parameters:
 *       - in: header
 *         name: stripe-signature
 *         required: true
 *         schema:
 *           type: string
 *         description: Stripe webhook signature for verification
 *     responses:
 *       200:
 *         description: Webhook processed successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       400:
 *         description: Invalid signature or malformed payload
 *       429:
 *         description: Rate limit exceeded
 *       500:
 *         description: Webhook secret not configured
 */
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

export async function OPTIONS() {
  return handleOptions();
}

export async function POST(request: NextRequest) {
  // Rate limiting for webhook endpoint
  const rateLimitResult = await apiRateLimit(request);
  if (!rateLimitResult.success) {
    return createErrorResponse('Rate limit exceeded', 429);
  }

  if (!webhookSecret) {
    return createErrorResponse('Webhook secret not configured', 500);
  }

  // Get raw body as buffer for signature verification
  const buf = await request.arrayBuffer();
  const body = Buffer.from(buf).toString('utf8');
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return createErrorResponse('Missing stripe signature', 400);
  }

  console.log('🔐 Stripe signature:', signature);

  try {
    const event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    
    // Handle different event types
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpdate(event.data.object);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionCancellation(event.data.object);
        break;

      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event.data.object);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object);
        break;

      case 'invoice.finalized':
        await handleInvoiceFinalized(event.data.object);
        break;

      case 'invoice.paid':
        await handleInvoicePaid(event.data.object);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
    
    return createApiResponse({ received: true });
  } catch (error: any) {
    console.error('Webhook signature verification failed:', error.message);
    return createErrorResponse('Invalid signature', 400);
  }
}

async function handleSubscriptionUpdate(subscription: any) {
  const organizationId = subscription.metadata?.organizationId;
  if (!organizationId) return;

  await db.transaction(async (tx) => {
    await tx.update(subscriptions)
      .set({
        status: subscription.status,
        current_period_start: new Date(subscription.current_period_start * 1000),
        current_period_end: new Date(subscription.current_period_end * 1000),
        updated_at: new Date()
      })
      .where(eq(subscriptions.stripe_subscription_id, subscription.id));

    await tx.insert(audit_events).values({
      org_id: organizationId,
      event_type: 'subscription_updated',
      event_category: 'billing',
      actor_type: 'system',
      action: 'updated',
      description: `Subscription ${subscription.id} updated via webhook`,
      metadata: { subscription_id: subscription.id, status: subscription.status },
    });
  });
}

async function handleSubscriptionCancellation(subscription: any) {
  const organizationId = subscription.metadata?.organizationId;
  if (!organizationId) return;

  await db.transaction(async (tx) => {
    await tx.update(subscriptions)
      .set({
        status: 'canceled',
        canceled_at: new Date(),
        updated_at: new Date()
      })
      .where(eq(subscriptions.stripe_subscription_id, subscription.id));

    await tx.insert(audit_events).values({
      org_id: organizationId,
      event_type: 'subscription_canceled',
      event_category: 'billing',
      actor_type: 'system',
      action: 'canceled',
      description: `Subscription ${subscription.id} canceled via webhook`,
      metadata: { subscription_id: subscription.id },
    });
  });
}

async function handleInvoicePaymentSucceeded(invoice: any) {
  const organizationId = invoice.metadata?.organizationId;
  if (!organizationId) return;

  await db.update(invoices)
    .set({
      status: 'paid',
      paid_at: new Date(invoice.status_transitions.paid_at * 1000),
      updated_at: new Date()
    })
    .where(eq(invoices.stripe_invoice_id, invoice.id));
}

async function handleInvoicePaymentFailed(invoice: any) {
  const organizationId = invoice.metadata?.organizationId;
  if (!organizationId) return;

  await db.update(invoices)
    .set({
      status: 'payment_failed',
      updated_at: new Date()
    })
    .where(eq(invoices.stripe_invoice_id, invoice.id));
}

async function handleInvoiceFinalized(invoice: any) {
  console.log('🔥 Invoice finalized webhook received:', invoice.id);
  console.log('📋 Invoice metadata:', invoice.metadata);
  
  const organizationId = invoice.metadata?.organizationId;
  if (!organizationId) {
    console.log('❌ No organizationId in metadata, skipping PDF generation');
    return;
  }

  console.log('✅ Processing PDF generation for org:', organizationId);

  try {
    // Get organization details
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    if (!org) {
      console.log('❌ Organization not found:', organizationId);
      return;
    }

    console.log('✅ Organization found:', org.name);

    // Prepare invoice data for PDF
    const invoiceData = {
      invoice_number: invoice.number,
      issued_at: new Date(invoice.created * 1000),
      due_at: invoice.due_date ? new Date(invoice.due_date * 1000) : null,
      subtotal: invoice.subtotal / 100, // Convert from cents
      tax_amount: invoice.tax / 100,
      total: invoice.total / 100,
      currency: invoice.currency.toUpperCase(),
      line_items: invoice.lines.data.map((line: any) => ({
        description: line.description,
        amount: (line.amount / 100).toFixed(2)
      })),
      organization: {
        name: org.name,
        billing_address: org.billing_address,
        tax_id: org.tax_id
      },
      tax_breakdown: null // Could be enhanced with detailed tax breakdown
    };

    console.log('📄 Generating PDF for invoice:', invoice.number);

    // Generate PDF
    const pdfBuffer = await generateInvoicePDF(invoiceData);
    
    // For now, store as base64 in database (in production, upload to S3)
    const pdfBase64 = pdfBuffer.toString('base64');
    const pdfUrl = `data:application/pdf;base64,${pdfBase64}`;

    console.log('✅ PDF generated, size:', pdfBuffer.length, 'bytes');

    // Update invoice with PDF URL
    await db.insert(invoices).values({
      org_id: organizationId,
      stripe_invoice_id: invoice.id,
      invoice_number: invoice.number,
      currency: invoice.currency.toUpperCase(),
      subtotal: invoiceData.subtotal.toString(),
      tax_amount: invoiceData.tax_amount.toString(),
      total: invoiceData.total.toString(),
      status: invoice.status,
      issued_at: invoiceData.issued_at,
      billing_country: org.billing_country,
      line_items: JSON.stringify(invoiceData.line_items),
      pdf_url: pdfUrl
    }).onConflictDoUpdate({
      target: [invoices.stripe_invoice_id],
      set: {
        pdf_url: pdfUrl,
        updated_at: new Date()
      }
    });

    console.log('✅ Invoice saved to database with PDF URL');

  } catch (error) {
    console.error('❌ Failed to generate invoice PDF:', error);
  }
}

async function handleInvoicePaid(invoice: any) {
  console.log('💰 Invoice paid webhook received:', invoice.id);
  
  const organizationId = invoice.metadata?.organizationId;
  if (!organizationId) {
    console.log('❌ No organizationId in metadata for paid invoice');
    return;
  }

  await db.update(invoices)
    .set({
      status: 'paid',
      paid_at: new Date(invoice.status_transitions.paid_at * 1000),
      updated_at: new Date()
    })
    .where(eq(invoices.stripe_invoice_id, invoice.id));
    
  console.log('✅ Invoice marked as paid in database');
}
