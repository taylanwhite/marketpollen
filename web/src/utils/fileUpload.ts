import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from '../firebase/config';
import { FileAttachment } from '../types';

/**
 * Upload a file to Firebase Storage for a contact
 */
export async function uploadContactFile(
  contactId: string,
  file: File,
  userId: string
): Promise<FileAttachment> {
  // Create a unique file path: contacts/{contactId}/files/{timestamp}-{filename}
  const timestamp = Date.now();
  const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
  const storagePath = `contacts/${contactId}/files/${timestamp}-${sanitizedFileName}`;
  const storageRef = ref(storage, storagePath);

  try {
    // Upload the file
    await uploadBytes(storageRef, file);
  } catch (error: any) {
    // Provide helpful error message if Storage isn't enabled
    if (error.code === 'storage/unknown' || error.code === 'storage/unauthorized' || error.message?.includes('404')) {
      throw new Error(
        'Firebase Storage is not enabled or configured. Please:\n' +
        '1. Go to Firebase Console → Storage\n' +
        '2. Click "Get started" to enable Storage\n' +
        '3. Configure Storage security rules (see FIREBASE_STORAGE_RULES.txt)\n' +
        '4. Verify VITE_FIREBASE_STORAGE_BUCKET in your .env file matches your Firebase project'
      );
    }
    throw error;
  }

  // Get the download URL
  const downloadURL = await getDownloadURL(storageRef);

  // Return file attachment metadata
  return {
    id: `${timestamp}-${sanitizedFileName}`,
    name: file.name,
    storagePath,
    downloadURL,
    size: file.size,
    mimeType: file.type,
    uploadedAt: new Date(),
    uploadedBy: userId,
  };
}

/**
 * Delete a file from Firebase Storage
 */
export async function deleteContactFile(storagePath: string): Promise<void> {
  const storageRef = ref(storage, storagePath);
  await deleteObject(storageRef);
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Get file icon based on MIME type
 */
export function getFileIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType.startsWith('video/')) return '🎥';
  if (mimeType.includes('pdf')) return '📄';
  if (mimeType.includes('word') || mimeType.includes('document')) return '📝';
  if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return '📊';
  if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) return '📊';
  if (mimeType.includes('zip') || mimeType.includes('archive')) return '📦';
  return '📎';
}
