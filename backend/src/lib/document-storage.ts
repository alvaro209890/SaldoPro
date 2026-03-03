import { randomUUID } from 'node:crypto';
import { logger } from './logger';
import { compressPdfBufferToFit } from './pdf-compression';
import { supabaseAdmin } from './supabase';

const DOCUMENT_BUCKET_NAME = 'user-documents';
const SIGNED_URL_TTL_SECONDS = 5 * 60;
export const MAX_STORED_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_SOURCE_PDF_BYTES_FOR_COMPRESSION = 40 * 1024 * 1024;

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

interface StorageListItem {
  name: string;
  id?: string | null;
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

export class DocumentUploadUserError extends Error {
  readonly userMessage: string;

  constructor(message: string, userMessage: string) {
    super(message);
    this.name = 'DocumentUploadUserError';
    this.userMessage = userMessage;
  }
}

const STORAGE_LIST_PAGE_SIZE = 100;

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

async function listStorageDirectory(path: string): Promise<StorageListItem[]> {
  const items: StorageListItem[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabaseAdmin.storage
      .from(DOCUMENT_BUCKET_NAME)
      .list(path, {
        limit: STORAGE_LIST_PAGE_SIZE,
        offset,
        sortBy: { column: 'name', order: 'asc' }
      });

    if (error) {
      logger.error('Failed to list Supabase Storage directory', {
        bucketName: DOCUMENT_BUCKET_NAME,
        path,
        error
      });
      throw new Error(`listStorageDirectory(${path || '/'}): ${error.message}`);
    }

    const page = (data ?? []) as StorageListItem[];
    items.push(...page);

    if (page.length < STORAGE_LIST_PAGE_SIZE) {
      break;
    }

    offset += STORAGE_LIST_PAGE_SIZE;
  }

  return items;
}

async function listTrackedStorageObjects(): Promise<StorageObjectRow[]> {
  const rows: StorageObjectRow[] = [];

  for (const prefix of ['documents', 'pending'] as const) {
    const ownerFolders = await listStorageDirectory(prefix);

    for (const ownerFolder of ownerFolders) {
      const ownerName = ownerFolder.name?.trim();
      if (!ownerName) continue;

      const ownerPath = `${prefix}/${ownerName}`;
      const files = await listStorageDirectory(ownerPath);

      for (const file of files) {
        const fileName = file.name?.trim();
        if (!fileName) continue;

        rows.push({
          name: `${ownerPath}/${fileName}`,
          metadata: file.metadata ?? null
        });
      }
    }
  }

  return rows;
}

export async function getDocumentStorageUsageSummary(): Promise<DocumentStorageUsageSummary> {
  const data = await listTrackedStorageObjects();

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
  let uploadBuffer = buffer;

  if (mimeType === 'application/pdf' && uploadBuffer.length > MAX_STORED_DOCUMENT_BYTES) {
    if (uploadBuffer.length > MAX_SOURCE_PDF_BYTES_FOR_COMPRESSION) {
      throw new DocumentUploadUserError(
        `uploadPendingDocument: PDF source exceeds compression limit (${uploadBuffer.length} bytes)`,
        'Recebi o PDF, mas ele esta grande demais para eu reduzir aqui. Envie um PDF menor ou dividido em partes.'
      );
    }

    const compressed = await compressPdfBufferToFit(uploadBuffer, MAX_STORED_DOCUMENT_BYTES);
    if (!compressed) {
      throw new DocumentUploadUserError(
        `uploadPendingDocument: could not reduce PDF to ${MAX_STORED_DOCUMENT_BYTES} bytes`,
        'Recebi o PDF, mas nao consegui reduzir para menos de 10 MB. Tente um PDF menor ou dividido em partes.'
      );
    }

    logger.info('Compressed inbound PDF before storage', {
      uid,
      originalBytes: uploadBuffer.length,
      compressedBytes: compressed.length
    });
    uploadBuffer = compressed;
  }

  if (uploadBuffer.length > MAX_STORED_DOCUMENT_BYTES) {
    throw new DocumentUploadUserError(
      `uploadPendingDocument: file exceeds storage limit (${uploadBuffer.length} bytes)`,
      'Recebi o arquivo, mas ele precisa ter ate 10 MB para ser salvo aqui.'
    );
  }

  const draftId = randomUUID();
  const extension = extensionFromMimeType(mimeType);
  const storagePath = `pending/${uid}/${draftId}.${extension}`;

  const { error } = await supabaseAdmin.storage
    .from(DOCUMENT_BUCKET_NAME)
    .upload(storagePath, uploadBuffer, {
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
    sizeBytes: uploadBuffer.length
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
