import { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - Authentication required' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'Email service is not configured. Please set RESEND_API_KEY environment variable.',
    });
  }

  const resend = new Resend(apiKey);

  try {
    const { email, isGlobalAdmin, invitedByEmail } = req.body;

    // Validate request
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ 
        error: 'Email address is required' 
      });
    }

    // Get the app URL from environment or use a default
    const appUrl = process.env.VITE_APP_URL || process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : 'http://localhost:5173';

    const signupUrl = `${appUrl}/signup?email=${encodeURIComponent(email)}`;

    // Send invitation email
    // Resend provides onboarding@resend.dev as a default sender (no domain verification needed)
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'MarketPollen <onboarding@resend.dev>';
    
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: email,
      subject: 'You\'re Invited to MarketPollen',
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: #1a1a1a; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1 style="color: #f4c430; margin: 0; font-size: 32px;">MarketPollen</h1>
            </div>
            <div style="background: #fefce8; padding: 30px; border-radius: 0 0 10px 10px;">
              <h2 style="color: #1a1a1a; margin-top: 0;">You're Invited!</h2>
              <p>You've been invited to join MarketPollen${isGlobalAdmin ? ' as a Global Administrator' : ''}.</p>
              ${invitedByEmail ? `<p><strong>Invited by:</strong> ${invitedByEmail}</p>` : ''}
              <p>Click the button below to create your account and get started:</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${signupUrl}" 
                   style="background: #f4c430; 
                          color: #1a1a1a; 
                          padding: 15px 30px; 
                          text-decoration: none; 
                          border-radius: 5px; 
                          display: inline-block; 
                          font-weight: bold;
                          font-size: 16px;">
                  Accept Invitation & Sign Up
                </a>
              </div>
              <p style="color: #666; font-size: 14px; margin-top: 30px;">
                Or copy and paste this link into your browser:<br>
                <a href="${signupUrl}" style="color: #d4a017; word-break: break-all;">${signupUrl}</a>
              </p>
              <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
              <p style="color: #666; font-size: 12px; margin: 0;">
                This invitation was sent by MarketPollen. If you didn't expect this email, you can safely ignore it.
              </p>
            </div>
          </body>
        </html>
      `,
      text: `
You've been invited to join MarketPollen${isGlobalAdmin ? ' as a Global Administrator' : ''}.

${invitedByEmail ? `Invited by: ${invitedByEmail}\n\n` : ''}Click the link below to create your account:

${signupUrl}

This invitation was sent by MarketPollen. If you didn't expect this email, you can safely ignore it.
      `.trim(),
    });

    if (error) {
      console.error('Resend error:', error);
      return res.status(500).json({ 
        error: `Failed to send email: ${error.message || 'Unknown error'}` 
      });
    }

    return res.status(200).json({ 
      success: true, 
      messageId: data?.id 
    });
  } catch (error: any) {
    console.error('Email sending error:', error);
    return res.status(500).json({ 
      error: `Failed to send email: ${error.message || 'Unknown error'}` 
    });
  }
}
