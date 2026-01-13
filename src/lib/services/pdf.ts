import PDFDocument from 'pdfkit';
import { organizations, invoices } from '../db/schema';

interface InvoiceData {
  invoice_number: string;
  issued_at: Date;
  due_at: Date | null;
  subtotal: number;
  tax_amount: number;
  total: number;
  currency: string;
  line_items: any[];
  organization: {
    name: string;
    billing_address: any;
    tax_id: string | null;
  };
  tax_breakdown: any;
}

export async function generateInvoicePDF(invoiceData: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ 
        margin: 50,
        font: 'Helvetica' // Use built-in font
      });
      const chunks: Buffer[] = [];

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      doc.fontSize(20).text('INVOICE', 50, 50);
      doc.fontSize(12).text(`Invoice #: ${invoiceData.invoice_number}`, 50, 80);
      doc.text(`Date: ${invoiceData.issued_at.toLocaleDateString()}`, 50, 100);
      if (invoiceData.due_at) {
        doc.text(`Due: ${invoiceData.due_at.toLocaleDateString()}`, 50, 120);
      }

      // Bill To
      doc.text('Bill To:', 50, 160);
      doc.text(invoiceData.organization.name, 50, 180);
      if (invoiceData.organization.billing_address) {
        const addr = invoiceData.organization.billing_address;
        doc.text(`${addr.street || ''}`, 50, 200);
        doc.text(`${addr.city || ''}, ${addr.state || ''} ${addr.postal_code || ''}`, 50, 220);
      }
      if (invoiceData.organization.tax_id) {
        doc.text(`Tax ID: ${invoiceData.organization.tax_id}`, 50, 240);
      }

      // Line Items
      let yPos = 280;
      doc.text('Description', 50, yPos);
      doc.text('Amount', 400, yPos);
      doc.moveTo(50, yPos + 15).lineTo(550, yPos + 15).stroke();
      
      yPos += 30;
      invoiceData.line_items.forEach(item => {
        doc.text(item.description, 50, yPos);
        doc.text(`${invoiceData.currency} ${item.amount}`, 400, yPos);
        yPos += 20;
      });

      // Totals
      yPos += 20;
      doc.text(`Subtotal: ${invoiceData.currency} ${invoiceData.subtotal}`, 400, yPos);
      yPos += 20;
      doc.text(`Tax: ${invoiceData.currency} ${invoiceData.tax_amount}`, 400, yPos);
      yPos += 20;
      doc.fontSize(14).text(`Total: ${invoiceData.currency} ${invoiceData.total}`, 400, yPos);

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
