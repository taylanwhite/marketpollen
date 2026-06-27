export interface PendingContactFile {
  id: string;
  name: string;
  dataUrl: string;
  mimeType: string;
  size: number;
}

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

export async function fileToPendingContactFile(file: File): Promise<PendingContactFile> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error('Attachment is too large. Please choose a file under 5 MB.');
  }
  return {
    id: crypto.randomUUID(),
    name: file.name || 'attachment',
    dataUrl: await readFileAsDataUrl(file),
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
  };
}

export function dataUrlToPendingContactFile(params: {
  name: string;
  dataUrl: string;
  mimeType: string;
  size?: number;
}): PendingContactFile {
  return {
    id: crypto.randomUUID(),
    name: params.name,
    dataUrl: params.dataUrl,
    mimeType: params.mimeType,
    size: params.size ?? Math.ceil(params.dataUrl.length * 0.75),
  };
}
