import { db } from '../../../lib/db';
import { withAuth, AuthenticatedRequest } from '../../../middleware/auth';
import { createApiResponse, createErrorResponse } from '../../../lib/api/response';
import { logAuditEvent } from '../../../lib/audit/logger';
import { apiRateLimit } from '../../../lib/rate-limit';
import { eq, desc, sql, and } from 'drizzle-orm';

/**
 * @swagger
 * /api/invoices:
 *   get:
 *     summary: Get invoices
 *     description: Retrieve organization invoices with pagination and filtering
 *     tags: [Billing]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *           minimum: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           minimum: 1
 *           maximum: 100
 *         description: Number of items per page
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, open, paid, void, uncollectible]
 *         description: Filter by invoice status
 *     responses:
 *       200:
 *         description: List of invoices with pagination
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       401:
 *         description: Unauthorized
 *       429:
 *         description: Rate limit exceeded
 */
async function getInvoices(request: AuthenticatedRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await apiRateLimit(request);
    if (!rateLimitResult.success) {
      return createErrorResponse('Rate limit exceeded', 429);
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const status = searchParams.get('status');

    // Validation
    if (page < 1 || limit < 1 || limit > 100) {
      return createErrorResponse('Invalid pagination parameters. Page must be >= 1, limit must be 1-100', 400);
    }

    // Fetch invoices from database
    const { invoices } = await import('../../../lib/db/schema');
    
    // Build where conditions
    const whereConditions = [eq(invoices.org_id, request.user.org_id)];
    if (status) {
      whereConditions.push(eq(invoices.status, status));
    }

    let query = db
      .select({
        id: invoices.id,
        stripe_invoice_id: invoices.stripe_invoice_id,
        invoice_number: invoices.invoice_number,
        status: invoices.status,
        total: invoices.total,
        currency: invoices.currency,
        subtotal: invoices.subtotal,
        tax_amount: invoices.tax_amount,
        amount_paid: invoices.amount_paid,
        amount_due: invoices.amount_due,
        issued_at: invoices.issued_at,
        due_at: invoices.due_at,
        paid_at: invoices.paid_at,
        pdf_url: invoices.pdf_url,
        line_items: invoices.line_items
      })
      .from(invoices)
      .where(and(...whereConditions));

    // Get total count for pagination
    const totalResult = await db
      .select({ count: sql`count(*)` })
      .from(invoices)
      .where(and(...whereConditions));
    
    const totalCount = Number(totalResult[0]?.count || 0);
    const totalPages = Math.ceil(totalCount / limit);
    const offset = (page - 1) * limit;

    // Apply pagination
    const invoiceList = await query
      .limit(limit)
      .offset(offset)
      .orderBy(desc(invoices.issued_at));

    // Audit log
    await logAuditEvent({
      org_id: request.user.org_id,
      user_id: request.user.user_id,
      event_type: 'invoices.viewed',
      event_category: 'billing',
      actor_type: 'user',
      actor_id: request.user.user_id,
      resource_type: 'invoices',
      action: 'list',
      description: `User viewed invoices list (${invoiceList.length} invoices)`,
      metadata: { 
        invoices_count: invoiceList.length,
        page,
        limit,
        status_filter: status
      },
      request
    });

    return createApiResponse({
      invoices: invoiceList,
      pagination: {
        page,
        limit,
        total_pages: totalPages,
        total_count: totalCount,
        has_next: page < totalPages,
        has_prev: page > 1
      },
      filters: {
        status
      }
    });

  } catch (error) {
    console.error('Error fetching invoices:', error);
    return createErrorResponse('Internal server error', 500);
  }
}

export const GET = withAuth(getInvoices);
