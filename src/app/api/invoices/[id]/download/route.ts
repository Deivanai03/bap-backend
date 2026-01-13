import { NextResponse } from 'next/server';
import { db } from '../../../../../lib/db';
import { invoices } from '../../../../../lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { withAuth, AuthenticatedRequest } from '../../../../../middleware/auth';
import { createErrorResponse } from '../../../../../lib/api/response';
import { logAuditEvent } from '../../../../../lib/audit/logger';
import { apiRateLimit } from '../../../../../lib/rate-limit';

/**
 * @swagger
 * /api/invoices/{id}/download:
 *   get:
 *     summary: Download invoice PDF
 *     description: Download the PDF file for a specific invoice
 *     tags: [Billing]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Invoice ID
 *     responses:
 *       200:
 *         description: PDF file download
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Invoice not found
 *       429:
 *         description: Rate limit exceeded
 */
async function downloadInvoice(request: AuthenticatedRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await apiRateLimit(request);
    if (!rateLimitResult.success) {
      return createErrorResponse('Rate limit exceeded', 429);
    }

    // Extract invoice ID from URL path
    const url = new URL(request.url);
    const pathSegments = url.pathname.split('/').filter(segment => segment !== '');
    // Path: /api/invoices/[id]/download -> segments: ['api', 'invoices', 'id', 'download']
    const invoiceId = pathSegments[2]; // Get the ID segment

    // Validate UUID format (simplified)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!invoiceId || !uuidRegex.test(invoiceId)) {
      return createErrorResponse('Invalid invoice ID format', 400);
    }

    // Get invoice
    const invoice = await db
      .select({
        id: invoices.id,
        invoice_number: invoices.invoice_number,
        status: invoices.status,
        pdf_url: invoices.pdf_url,
        org_id: invoices.org_id
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.id, invoiceId),
          eq(invoices.org_id, request.user.org_id)
        )
      )
      .limit(1);

    if (!invoice.length) {
      return createErrorResponse('Invoice not found', 404);
    }

    const invoiceData = invoice[0];

    // Check if PDF is available
    if (!invoiceData.pdf_url) {
      return createErrorResponse('PDF not yet generated for this invoice', 404);
    }

    // Audit log
    await logAuditEvent({
      org_id: request.user.org_id,
      user_id: request.user.user_id,
      event_type: 'invoice.downloaded',
      event_category: 'billing',
      actor_type: 'user',
      actor_id: request.user.user_id,
      resource_type: 'invoice',
      resource_id: invoiceId,
      action: 'download',
      description: `User downloaded invoice ${invoiceData.invoice_number}`,
      metadata: { 
        invoice_number: invoiceData.invoice_number,
        invoice_status: invoiceData.status
      },
      request
    });

    // Serve PDF (base64 data URL for now, S3 URL in production)
    if (invoiceData.pdf_url.startsWith('data:application/pdf')) {
      // Extract base64 data
      const base64Data = invoiceData.pdf_url.split(',')[1];
      const pdfBuffer = Buffer.from(base64Data, 'base64');
      
      return new NextResponse(pdfBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="invoice-${invoiceData.invoice_number}.pdf"`,
        },
      });
    } else {
      // Redirect to S3 URL
      return NextResponse.redirect(invoiceData.pdf_url);
    }

  } catch (error) {
    console.error('Error downloading invoice:', error);
    return createErrorResponse('Internal server error', 500);
  }
}

export const GET = withAuth(downloadInvoice);
