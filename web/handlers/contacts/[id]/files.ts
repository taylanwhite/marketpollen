import { VercelRequest, VercelResponse } from '@vercel/node';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { getAuthUid } from '../../lib/auth.js';
import { canAccessStore } from '../../lib/store-access.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA_URL_RE = /^data:[^;,]+\/[^;,]+;base64,/i;
const MAX_ATTACHMENT_DATA_URL_LENGTH = 8_000_000;

type ContactFileRow = {
  id: string;
  contact_id: string;
  name: string;
  storage_path: string;
  download_url: string;
  size: bigint | number;
  mime_type: string;
  uploaded_at: Date;
  uploaded_by: string;
};

function fileToJson(file: ContactFileRow) {
  return {
    id: file.id,
    contactId: file.contact_id,
    name: file.name,
    storagePath: file.storage_path,
    downloadUrl: file.download_url,
    size: Number(file.size),
    mimeType: file.mime_type,
    uploadedAt: file.uploaded_at,
    uploadedBy: file.uploaded_by,
  };
}

function safeFileName(name: string): string {
  return name.trim().replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'attachment';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const uid = await getAuthUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const contactId = (req.query?.id as string)?.trim();
  if (!contactId) return res.status(400).json({ error: 'Contact id required' });

  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  const can = await canAccessStore(uid, contact.store_id);
  if (!can) return res.status(404).json({ error: 'Contact not found' });

  if (req.method === 'GET') {
    const rows = await prisma.contactFile.findMany({
      where: { contact_id: contactId },
      orderBy: { uploaded_at: 'desc' },
    });
    return res.status(200).json(rows.map(fileToJson));
  }

  if (req.method === 'POST') {
    const body = req.body as {
      id?: string;
      name?: string;
      dataUrl?: string;
      mimeType?: string;
      size?: number;
    };

    const name = body.name?.trim();
    const dataUrl = body.dataUrl;
    const mimeType = body.mimeType?.trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!dataUrl || typeof dataUrl !== 'string' || !DATA_URL_RE.test(dataUrl)) {
      return res.status(400).json({ error: 'dataUrl must be a base64 data URL' });
    }
    if (dataUrl.length > MAX_ATTACHMENT_DATA_URL_LENGTH) {
      return res.status(413).json({ error: 'Attachment is too large. Please upload a smaller file.' });
    }
    if (!mimeType) return res.status(400).json({ error: 'mimeType is required' });
    if (body.id && !UUID_RE.test(body.id)) return res.status(400).json({ error: 'id must be a UUID' });

    if (body.id) {
      const existing = await prisma.contactFile.findUnique({ where: { id: body.id } });
      if (existing) {
        if (existing.contact_id !== contactId) {
          return res.status(409).json({ error: 'File id belongs to another contact' });
        }
        return res.status(200).json(fileToJson(existing));
      }
    }

    const fileId = body.id || crypto.randomUUID();
    const storagePath = `contacts/${contactId}/${fileId}-${safeFileName(name)}`;

    try {
      const row = await prisma.contactFile.create({
        data: {
          id: fileId,
          contact_id: contactId,
          name,
          storage_path: storagePath,
          download_url: dataUrl,
          size: body.size ?? Buffer.byteLength(dataUrl, 'utf8'),
          mime_type: mimeType,
          uploaded_by: uid,
        },
      });
      return res.status(201).json(fileToJson(row));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && body.id) {
        const existing = await prisma.contactFile.findUnique({ where: { id: body.id } });
        if (existing) return res.status(200).json(fileToJson(existing));
      }
      throw err;
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
