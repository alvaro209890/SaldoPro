import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { env } from '../config/env';
import { logger } from './logger';
import { compressPdfBufferToFit } from './pdf-compression';

const SIGNED_URL_TTL_SECONDS = 5 * 60;
export const MAX_STORED_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_SOURCE_PDF_BYTES_FOR_COMPRESSION = 40 * 1024 * 1024;

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

function mimeTypeFromPath(storagePath: string): string {
  switch (extname(storagePath).toLowerCase()) {
    case '.pdf':
      return 'application/pdf';
    case '.zip':
      return 'application/zip';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.bmp':
      return 'image/bmp';
    case '.heic':
      return 'image/heic';
    case '.heif':
      return 'image/heif';
    case '.jpg':
    case '.jpeg':
    default:
      return 'image/jpeg';
  }
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

function resolveStoragePath(storagePath: string): string {
  const relative = storagePath.replace(/^\/+/, '');
  const absolute = resolve(env.localDocumentsDir, relative);
  const root = resolve(env.localDocumentsDir);
  if (!absolute.startsWith(root)) {
    throw new Error('Invalid storage path.');
  }
  return absolute;
}

async function ensureParentDir(filePath: string): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true });
}

function buildTokenPayload(storagePath: string, expiresAt: number): string {
  return Buffer.from(JSON.stringify({ storagePath, expiresAt }), 'utf8').toString('base64url');
}

function signTokenPayload(payload: string): string {
  return createHmac('sha256', env.localStorageSigningSecret).update(payload).digest('base64url');
}

function buildSignedToken(storagePath: string, expiresInSeconds: number): string {
  const payload = buildTokenPayload(storagePath, Date.now() + expiresInSeconds * 1000);
  return `${payload}.${signTokenPayload(payload)}`;
}

function safeCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function resolveSignedDocumentToken(token: string): { storagePath: string; absolutePath: string; mimeType: string } {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) {
    throw new Error('Invalid signed document token.');
  }

  if (!safeCompare(signature, signTokenPayload(payload))) {
    throw new Error('Invalid signed document token.');
  }

  const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    storagePath?: unknown;
    expiresAt?: unknown;
  };
  const storagePath = typeof parsed.storagePath === 'string' ? parsed.storagePath : '';
  const expiresAt = Number(parsed.expiresAt ?? 0);
  if (!storagePath || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new Error('Signed document token expired or invalid.');
  }

  return {
    storagePath,
    absolutePath: resolveStoragePath(storagePath),
    mimeType: mimeTypeFromPath(storagePath)
  };
}

async function listFilesRecursive(root: string, prefix = ''): Promise<Array<{ path: string; size: number }>> {
  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = (await fs.readdir(root, { withFileTypes: true })) as Array<{ name: string; isDirectory: () => boolean }>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const results: Array<{ path: string; size: number }> = [];
  for (const entry of entries) {
    const absolute = join(root, entry.name);
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...await listFilesRecursive(absolute, relative));
      continue;
    }

    const stat = await fs.stat(absolute);
    results.push({ path: relative, size: stat.size });
  }

  return results;
}

export async function getDocumentStorageUsageSummary(): Promise<DocumentStorageUsageSummary> {
  const files = await listFilesRecursive(env.localDocumentsDir);
  const summary: DocumentStorageUsageSummary = {
    bucketName: 'local-filesystem',
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

  const users = new Map<string, UserDocumentStorageUsage>();
  const ensureUser = (uid: string): UserDocumentStorageUsage => {
    const current = users.get(uid);
    if (current) return current;
    const created: UserDocumentStorageUsage = {
      uid,
      readyBytes: 0,
      readyObjects: 0,
      pendingBytes: 0,
      pendingObjects: 0,
      totalBytes: 0,
      totalObjects: 0
    };
    users.set(uid, created);
    return created;
  };

  for (const file of files) {
    summary.totalBytes += file.size;
    summary.totalObjects += 1;
    const parts = file.path.split('/').filter(Boolean);
    if (parts.length < 3) {
      summary.unassignedBytes += file.size;
      summary.unassignedObjects += 1;
      continue;
    }

    const group = parts[0];
    const uid = parts[1];
    const usage = ensureUser(uid);
    usage.totalBytes += file.size;
    usage.totalObjects += 1;

    if (group === 'documents') {
      summary.readyBytes += file.size;
      summary.readyObjects += 1;
      usage.readyBytes += file.size;
      usage.readyObjects += 1;
    } else if (group === 'pending') {
      summary.pendingBytes += file.size;
      summary.pendingObjects += 1;
      usage.pendingBytes += file.size;
      usage.pendingObjects += 1;
    } else {
      summary.unassignedBytes += file.size;
      summary.unassignedObjects += 1;
    }
  }

  summary.users = [...users.values()].sort((a, b) => b.totalBytes - a.totalBytes);
  return summary;
}

export async function uploadPendingDocument(uid: string, fileDataUrl: string): Promise<PendingDocumentUpload> {
  try {
    const parsed = parseImageDataUrl(fileDataUrl);
    let uploadBuffer = parsed.buffer;

    if (parsed.mimeType === 'application/pdf' && uploadBuffer.length > MAX_STORED_DOCUMENT_BYTES) {
      if (uploadBuffer.length > MAX_SOURCE_PDF_BYTES_FOR_COMPRESSION) {
        throw new DocumentUploadUserError(
          `uploadPendingDocument: PDF source exceeds compression limit (${uploadBuffer.length} bytes)`,
          'O PDF enviado é grande demais para processamento local.'
        );
      }

      const compressed = await compressPdfBufferToFit(uploadBuffer, MAX_STORED_DOCUMENT_BYTES);
      if (!compressed) {
        throw new DocumentUploadUserError(
          'uploadPendingDocument: PDF compression returned an empty payload',
          'Não consegui processar esse PDF. Tente um arquivo diferente.'
        );
      }
      uploadBuffer = compressed;
      if (uploadBuffer.length > MAX_STORED_DOCUMENT_BYTES) {
        throw new DocumentUploadUserError(
          `uploadPendingDocument: could not reduce PDF to ${MAX_STORED_DOCUMENT_BYTES} bytes`,
          'Não consegui compactar esse PDF o suficiente. Tente um arquivo menor.'
        );
      }
    }

    if (uploadBuffer.length > MAX_STORED_DOCUMENT_BYTES) {
      throw new DocumentUploadUserError(
        `uploadPendingDocument: file exceeds storage limit (${uploadBuffer.length} bytes)`,
        'O arquivo excede o limite permitido de 10 MB.'
      );
    }

    const draftId = randomUUID();
    const storagePath = `pending/${uid}/${draftId}.${extensionFromMimeType(parsed.mimeType)}`;
    const absolutePath = resolveStoragePath(storagePath);
    await ensureParentDir(absolutePath);
    await fs.writeFile(absolutePath, uploadBuffer);

    return {
      draftId,
      storagePath,
      mimeType: parsed.mimeType,
      sizeBytes: uploadBuffer.length
    };
  } catch (error) {
    if (error instanceof DocumentUploadUserError) {
      throw error;
    }
    throw new Error(`uploadPendingDocument: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

export async function finalizePendingDocumentMove(
  uid: string,
  pendingStoragePath: string,
  documentId: string,
  mimeType: string
): Promise<string> {
  const finalStoragePath = `documents/${uid}/${documentId}.${extensionFromMimeType(mimeType)}`;

  try {
    const source = resolveStoragePath(pendingStoragePath);
    const target = resolveStoragePath(finalStoragePath);
    await ensureParentDir(target);
    await fs.rename(source, target);
    return finalStoragePath;
  } catch (error) {
    throw new Error(`finalizePendingDocumentMove: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

export async function deleteStoredDocument(storagePath: string): Promise<void> {
  try {
    await fs.rm(resolveStoragePath(storagePath), { force: true });
  } catch (error) {
    throw new Error(`deleteStoredDocument: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

export async function createSignedDocumentUrl(
  storagePath: string,
  expiresInSeconds = SIGNED_URL_TTL_SECONDS
): Promise<string> {
  try {
    const absolutePath = resolveStoragePath(storagePath);
    await fs.access(absolutePath);
    const token = buildSignedToken(storagePath, expiresInSeconds);
    if (!env.backendUrl) {
      throw new Error('BACKEND_URL is required to create signed URLs.');
    }
    return `${env.backendUrl}/api/storage/signed?token=${encodeURIComponent(token)}`;
  } catch (error) {
    logger.warn('Failed to create local signed document URL', {
      storagePath,
      error: error instanceof Error ? error.message : 'unknown'
    });
    throw new Error(`createSignedDocumentUrl: ${error instanceof Error ? error.message : 'signed URL unavailable'}`);
  }
}

export async function readSignedDocument(token: string): Promise<{
  absolutePath: string;
  mimeType: string;
  fileName: string;
}> {
  const resolved = resolveSignedDocumentToken(token);
  await fs.access(resolved.absolutePath);
  return {
    absolutePath: resolved.absolutePath,
    mimeType: resolved.mimeType,
    fileName: basename(resolved.absolutePath)
  };
}
