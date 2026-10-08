import { Resend } from 'resend';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../../lib/db.js';
import { getAuthUid } from '../../lib/auth.js';
import { appUrl } from '../../lib/app-url.js';

async function grantStoreAccess(userId: string, orgId: string) {
  const stores = await prisma.store.findMany({
    where: { organization_id: orgId, archived_at: null },
    select: { id: true },
  });
  for (const store of stores) {
    await prisma.storePermission.upsert({
      where: { user_id_store_id: { user_id: userId, store_id: store.id } },
      create: { user_id: userId, store_id: store.id, can_edit: true },
      update: { can_edit: true },
    });
  }
}

async function sendOwnerEmail(email: string, orgName: string, existingAccount: boolean) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  const resend = new Resend(apiKey);
  const url = existingAccount ? `${appUrl()}/login` : `${appUrl()}/signup?email=${encodeURIComponent(email)}`;
  const line = existingAccount
    ? `You can sign in and you'll be the owner of ${orgName}.`
    : `Create an account with this email and you'll be the owner of ${orgName}.`;
  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'MarketPollen <onboarding@resend.dev>',
    to: email,
    subject: `You're an owner of ${orgName}`,
    text: `${line}\n\n${url}\n`,
  });
  return !error;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });
  const actor = await prisma.user.findUnique({ where: { id: uid }, select: { is_global_admin: true } });
  if (!actor?.is_global_admin) return res.status(403).json({ error: 'Admin required' });

  const orgId = (req.query?.id as string)?.trim();
  if (!orgId) return res.status(400).json({ error: 'Organization id required' });
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true } });
  if (!org) return res.status(404).json({ error: 'Organization not found' });

  const email = String((req.body as { email?: string })?.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Enter an email address' });

  const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
  if (user) {
    await prisma.organizationMember.upsert({
      where: { user_id_org_id: { user_id: user.id, org_id: orgId } },
      create: { user_id: user.id, org_id: orgId, is_admin: true },
      update: { is_admin: true },
    });
    await grantStoreAccess(user.id, orgId);
    const emailed = await sendOwnerEmail(user.email, org.name, true);
    return res.status(200).json({ added: true, pending: false, emailed, email: user.email });
  }

  const existingInvite = await prisma.organizationInvite.findFirst({
    where: { org_id: orgId, email, status: 'pending' },
  });
  if (!existingInvite) {
    await prisma.organizationInvite.create({
      data: { org_id: orgId, email, invited_by: uid },
    });
  }
  const emailed = await sendOwnerEmail(email, org.name, false);
  return res.status(200).json({ added: false, pending: true, emailed, email });
}
