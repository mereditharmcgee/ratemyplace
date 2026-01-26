import type { R2Bucket, R2Object } from '@cloudflare/workers-types';

const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'application/pdf'
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export interface UploadResult {
  success: true;
  key: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export interface UploadError {
  success: false;
  error: string;
}

/**
 * Upload a verification image to R2
 * Key format: users/{userId}/verifications/{reviewId}/{timestamp}.{ext}
 */
export async function uploadVerificationImage(
  bucket: R2Bucket,
  userId: string,
  reviewId: string,
  file: File
): Promise<UploadResult | UploadError> {
  // Validate file type
  if (!ALLOWED_TYPES.includes(file.type)) {
    return {
      success: false,
      error: `Invalid file type. Allowed: JPG, PNG, HEIC, PDF`
    };
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    return {
      success: false,
      error: `File too large. Maximum size: 10MB`
    };
  }

  // Generate key with timestamp to avoid collisions
  const timestamp = Date.now();
  const ext = getExtension(file.type);
  const key = `users/${userId}/verifications/${reviewId}/${timestamp}.${ext}`;

  try {
    await bucket.put(key, file.stream(), {
      httpMetadata: {
        contentType: file.type
      },
      customMetadata: {
        originalFilename: file.name,
        uploadedAt: new Date().toISOString()
      }
    });

    return {
      success: true,
      key,
      filename: file.name,
      contentType: file.type,
      sizeBytes: file.size
    };
  } catch (error) {
    console.error('R2 upload error:', error);
    return {
      success: false,
      error: 'Failed to upload file. Please try again.'
    };
  }
}

/**
 * Get a verification image from R2
 */
export async function getVerificationImage(
  bucket: R2Bucket,
  key: string
): Promise<R2Object | null> {
  try {
    return await bucket.get(key);
  } catch (error) {
    console.error('R2 get error:', error);
    return null;
  }
}

/**
 * Delete a verification image from R2
 */
export async function deleteVerificationImage(
  bucket: R2Bucket,
  key: string
): Promise<boolean> {
  try {
    await bucket.delete(key);
    return true;
  } catch (error) {
    console.error('R2 delete error:', error);
    return false;
  }
}

/**
 * Get file extension from MIME type
 */
function getExtension(mimeType: string): string {
  const extensions: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'application/pdf': 'pdf'
  };
  return extensions[mimeType] || 'bin';
}

/**
 * Validate that a MIME type is allowed
 */
export function isAllowedType(mimeType: string): boolean {
  return ALLOWED_TYPES.includes(mimeType);
}

/**
 * Get the maximum allowed file size in bytes
 */
export function getMaxFileSize(): number {
  return MAX_FILE_SIZE;
}
