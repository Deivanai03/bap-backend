import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_PORT === '465',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendMagicLinkEmail(email: string, magicLink: string) {
  const mailOptions = {
    from: process.env.EMAIL_FROM || 'BAP Workspace <noreply@bap.com>',
    to: email,
    subject: 'Sign in to BAP',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Sign in to BAP</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #BA6675 0%, #95739F 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 28px;">BAP Workspace</h1>
        </div>
        <div style="background: #ffffff; padding: 40px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
          <p style="color: #666;">Click the magic link below to sign in instantly:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${magicLink}" style="display: inline-block; background: linear-gradient(135deg, #BA6675 0%, #95739F 100%); color: white; padding: 14px 30px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">Sign In</a>
          </div>
          <p style="color: #999; font-size: 12px; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px;">This link expires in 15 minutes.</p>
        </div>
      </body>
      </html>
    `,
  };
  
  await transporter.sendMail(mailOptions);
}