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

    // Resolve the app's public URL for the signup link, preferring a clean,
    // stable domain over Vercel's ugly per-deployment preview hostname:
    //   1. VITE_APP_URL — explicit override (e.g. https://www.marketpollen.com)
    //   2. VERCEL_PROJECT_PRODUCTION_URL — stable production domain
    //   3. VERCEL_URL — deployment-specific (long, changes every deploy)
    //   4. localhost — local dev fallback
    //
    // Apex marketpollen.com currently serves a cert that only covers
    // www.marketpollen.com (NET::ERR_CERT_COMMON_NAME_INVALID). Always
    // send invitees to www until the apex domain is added in Vercel and
    // the leftover Namecheap parking A record is removed.
    const withProtocol = (host?: string) =>
      host ? (host.startsWith('http') ? host : `https://${host}`) : undefined;

    const toWorkingAppUrl = (raw?: string) => {
      if (!raw) return undefined;
      try {
        const url = new URL(raw);
        if (url.hostname === 'marketpollen.com') {
          url.hostname = 'www.marketpollen.com';
        }
        return url.origin;
      } catch {
        return raw.replace(/\/$/, '');
      }
    };

    const appUrl =
      toWorkingAppUrl(withProtocol(process.env.VITE_APP_URL)) ||
      toWorkingAppUrl(withProtocol(process.env.VERCEL_PROJECT_PRODUCTION_URL)) ||
      toWorkingAppUrl(withProtocol(process.env.VERCEL_URL)) ||
      'http://localhost:5173';

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
          <body style="margin: 0; padding: 0; background-color: #f4f5f7;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f5f7; padding: 40px 16px;">
              <tr>
                <td align="center">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 480px; background-color: #ffffff; border-radius: 12px; border: 1px solid #e6e8eb; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                    <tr>
                      <td style="padding: 32px 40px 8px 40px;">
                        <span style="font-size: 20px; font-weight: 700; color: #1a1a1a; letter-spacing: -0.2px;">
                          Market<span style="color: #d4a017;">Pollen</span>
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 40px 0 40px;">
                        <h1 style="margin: 0 0 12px 0; font-size: 24px; line-height: 1.3; font-weight: 700; color: #1a1a1a;">
                          You're invited to MarketPollen
                        </h1>
                        <p style="margin: 0 0 8px 0; font-size: 15px; line-height: 1.6; color: #4a4f57;">
                          You've been invited to join MarketPollen${isGlobalAdmin ? ' as a <strong>Global Administrator</strong>' : ''}.${invitedByEmail ? ` <span style="color: #6b7280;">Invited by ${invitedByEmail}.</span>` : ''}
                        </p>
                        <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #4a4f57;">
                          Click the button below to create your account and get started.
                        </p>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 0 40px 8px 40px;">
                        <table role="presentation" cellpadding="0" cellspacing="0">
                          <tr>
                            <td style="border-radius: 8px; background-color: #f4c430;">
                              <a href="${signupUrl}"
                                 style="display: inline-block; padding: 13px 28px; font-size: 15px; font-weight: 600; color: #1a1a1a; text-decoration: none; border-radius: 8px;">
                                Accept invitation
                              </a>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 20px 40px 0 40px;">
                        <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #9096a0;">
                          Or paste this link into your browser:<br>
                          <a href="${signupUrl}" style="color: #6b7280; word-break: break-all;">${signupUrl}</a>
                        </p>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 24px 40px 32px 40px;">
                        <div style="border-top: 1px solid #eceef0; padding-top: 20px;">
                          <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #9096a0;">
                            This invitation was sent by MarketPollen. If you didn't expect this email, you can safely ignore it.
                          </p>
                        </div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
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
