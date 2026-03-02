import { randomUUID } from 'node:crypto';
import { logger } from './logger';
import { supabaseAdmin } from './supabase';

const DOCUMENT_BUCKET_NAME = 'user-documents';
const SIGNED_URL_TTL_SECONDS = 5 * 60;

interface ParsedImageDataUrl {
  mimeType: string;
  buffer: Buffer;
}

export interface PendingDocumentUpload {
  draftId: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
}

function extensionFromMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('gif')) return 'gif';
  if (normalized.includes('heic')) return 'heic';
  if (normalized.includes('heif')) return 'heif';
  if (normalized.includes('bmp')) return 'bmp';
  return 'jpg';
}

function parseImageDataUrl(imageDataUrl: string): ParsedImageDataUrl {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(imageDataUrl.trim());
  if (!match) {
    throw new Error('Invalid image data URL.');
  }

  const mimeType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer || buffer.length === 0) {
    throw new Error('Image payload is empty.');
  }

  return { mimeType, buffer };
}

export async function uploadPendingDocument(
  uid: string,
  imageDataUrl: string
): Promise<PendingDocumentUpload> {
  const { mimeType, buffer } = parseImageDataUrl(imageDataUrl);
  const draftId = randomUUID();
  const extension = extensionFromMimeType(mimeType);
  const storagePath = `pending/${uid}/${draftId}.${extension}`;

  const { error } = await supabaseAdmin.storage
    .from(DOCUMENT_BUCKET_NAME)
    .upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: false
    });

  if (error) {
    logger.error('Failed to upload pending document to Supabase Storage', {
      uid,
      storagePath,
      error
    });
    throw new Error(`uploadPendingDocument: ${error.message}`);
  }

  return {
    draftId,
    storagePath,
    mimeType,
    sizeBytes: buffer.length
  };
}

export async function finalizePendingDocumentMove(
  uid: string,
  pendingStoragePath: string,
  documentId: string,
  mimeType: string
): Promise<string> {
  const extension = extensionFromMimeType(mimeType);
  const targetPath = `documents/${uid}/${documentId}.${extension}`;

  const { error } = await supabaseAdmin.storage
    .from(DOCUMENT_BUCKET_NAME)
    .move(pendingStoragePath, targetPath);

  if (error) {
    logger.error('Failed to move pending document to final path', {
      uid,
      pendingStoragePath,
      targetPath,
      error
    });
    throw new Error(`finalizePendingDocumentMove: ${error.message}`);
  }

  return targetPath;
}

export async function deleteStoredDocument(storagePath: string): Promise<void> {
  if (!storagePath.trim()) return;

  const { error } = await supabaseAdmin.storage
    .from(DOCUMENT_BUCKET_NAME)
    .remove([storagePath]);

  if (error) {
    logger.error('Failed to delete document from Supabase Storage', {
      storagePath,
      error
    });
    throw new Error(`deleteStoredDocument: ${error.message}`);
  }
}

export async function createSignedDocumentUrl(
  storagePath: string,
  expiresInSeconds = SIGNED_URL_TTL_SECONDS
): Promise<string> {
  const { data, error } = await supabaseAdmin.storage
    .from(DOCUMENT_BUCKET_NAME)
    .createSignedUrl(storagePath, expiresInSeconds);

  if (error || !data?.signedUrl) {
    logger.error('Failed to create signed URL for document', {
      storagePath,
      error
    });
    throw new Error(`createSignedDocumentUrl: ${error?.message ?? 'signed URL unavailable'}`);
  }

  return data.signedUrl;
}

