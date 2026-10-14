import { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';
import { brandEmail } from './lib/brand-email.js';

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
    
    const invitedBy = typeof invitedByEmail === 'string' && invitedByEmail.trim()
      ? ` ${invitedByEmail.trim()} invited you.`
      : '';
    const role = isGlobalAdmin ? ' as a super user' : '';
    const message = brandEmail({
      headline: 'You have a place on MarketPollen',
      body: `You've been invited to join MarketPollen${role}.${invitedBy} Create your account to pick up your stores and start logging visits.`,
      buttonLabel: 'Accept invitation',
      buttonUrl: signupUrl,
    });
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: email,
      subject: "You're invited to MarketPollen",
      html: message.html,
      text: message.text,
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
