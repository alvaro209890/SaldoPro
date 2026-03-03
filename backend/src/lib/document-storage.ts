import { randomUUID } from 'node:crypto';
import { logger } from './logger';
import { supabaseAdmin } from './supabase';

const DOCUMENT_BUCKET_NAME = 'user-documents';
const SIGNED_URL_TTL_SECONDS = 5 * 60;

interface ParsedImageDataUrl {
  mimeType: string;
  buffer: Buffer;
}

interface StorageObjectRow {
  name: string;
  metadata?: {
    size?: number | string | null;
  } | null;
}

export interface PendingDocumentUpload {
  draftId: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
}

export interface UserDocumentStorageUsage {
  uid: string;
  readyBytes: number;
  readyObjects: number;
  pendingBytes: number;
  pendingObjects: number;
  totalBytes: number;
  totalObjects: number;
}

export interface DocumentStorageUsageSummary {
  bucketName: string;
  totalBytes: number;
  totalObjects: number;
  readyBytes: number;
  readyObjects: number;
  pendingBytes: number;
  pendingObjects: number;
  unassignedBytes: number;
  unassignedObjects: number;
  users: UserDocumentStorageUsage[];
}

function extensionFromMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized === 'application/pdf') return 'pdf';
  if (
    normalized === 'application/zip' ||
    normalized === 'application/x-zip-compressed' ||
    normalized === 'multipart/x-zip'
  ) {
    return 'zip';
  }
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('gif')) return 'gif';
  if (normalized.includes('heic')) return 'heic';
  if (normalized.includes('heif')) return 'heif';
  if (normalized.includes('bmp')) return 'bmp';
  return 'jpg';
}

function isAllowedDocumentMimeType(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase();
  return (
    normalized.startsWith('image/') ||
    normalized === 'application/pdf' ||
    normalized === 'application/zip' ||
    normalized === 'application/x-zip-compressed' ||
    normalized === 'multipart/x-zip'
  );
}

function parseImageDataUrl(imageDataUrl: string): ParsedImageDataUrl {
  const match = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,(.+)$/i.exec(imageDataUrl.trim());
  if (!match) {
    throw new Error('Invalid file data URL.');
  }

  const mimeType = match[1].toLowerCase();
  if (!isAllowedDocumentMimeType(mimeType)) {
    throw new Error(`Unsupported file mime type: ${mimeType}`);
  }

  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer || buffer.length === 0) {
    throw new Error('File payload is empty.');
  }

  return { mimeType, buffer };
}

function toObjectSize(metadata: StorageObjectRow['metadata']): number {
  const parsed = Number(metadata?.size ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function parseStorageOwner(path: string): { uid: string; group: 'ready' | 'pending' } | null {
  const normalized = path.trim();
  if (!normalized) return null;

  const segments = normalized.split('/').filter(Boolean);
  if (segments.length < 3) return null;

  if (segments[0] === 'documents') {
    return { uid: segments[1], group: 'ready' };
  }

  if (segments[0] === 'pending') {
    return { uid: segments[1], group: 'pending' };
  }

  return null;
}

export async function getDocumentStorageUsageSummary(): Promise<DocumentStorageUsageSummary> {
  const { data, error } = await supabaseAdmin
    .schema('storage')
    .from('objects')
    .select('name, metadata')
    .eq('bucket_id', DOCUMENT_BUCKET_NAME);

  if (error) {
    logger.error('Failed to read Supabase Storage usage summary', { bucketName: DOCUMENT_BUCKET_NAME, error });
    throw new Error(`getDocumentStorageUsageSummary: ${error.message}`);
  }

  const summary: DocumentStorageUsageSummary = {
    bucketName: DOCUMENT_BUCKET_NAME,
    totalBytes: 0,
    totalObjects: 0,
    readyBytes: 0,
    readyObjects: 0,
    pendingBytes: 0,
    pendingObjects: 0,
    unassignedBytes: 0,
    unassignedObjects: 0,
    users: []
  };

  const usageByUid = new Map<string, UserDocumentStorageUsage>();

  for (const row of (data ?? []) as StorageObjectRow[]) {
    const size = toObjectSize(row.metadata);
    summary.totalBytes += size;
    summary.totalObjects += 1;

    const owner = parseStorageOwner(row.name);
    if (!owner) {
      summary.unassignedBytes += size;
      summary.unassignedObjects += 1;
      continue;
    }

    if (owner.group === 'ready') {
      summary.readyBytes += size;
      summary.readyObjects += 1;
    } else {
      summary.pendingBytes += size;
      summary.pendingObjects += 1;
    }

    const current = usageByUid.get(owner.uid) ?? {
      uid: owner.uid,
      readyBytes: 0,
      readyObjects: 0,
      pendingBytes: 0,
      pendingObjects: 0,
      totalBytes: 0,
      totalObjects: 0
    };

    if (owner.group === 'ready') {
      current.readyBytes += size;
      current.readyObjects += 1;
    } else {
      current.pendingBytes += size;
      current.pendingObjects += 1;
    }

    current.totalBytes += size;
    current.totalObjects += 1;
    usageByUid.set(owner.uid, current);
  }

  summary.users = [...usageByUid.values()].sort((a, b) => {
    if (b.totalBytes !== a.totalBytes) return b.totalBytes - a.totalBytes;
    return a.uid.localeCompare(b.uid);
  });

  return summary;
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
