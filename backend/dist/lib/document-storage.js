"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDocumentStorageUsageSummary = getDocumentStorageUsageSummary;
exports.uploadPendingDocument = uploadPendingDocument;
exports.finalizePendingDocumentMove = finalizePendingDocumentMove;
exports.deleteStoredDocument = deleteStoredDocument;
exports.createSignedDocumentUrl = createSignedDocumentUrl;
const node_crypto_1 = require("node:crypto");
const logger_1 = require("./logger");
const supabase_1 = require("./supabase");
const DOCUMENT_BUCKET_NAME = 'user-documents';
const SIGNED_URL_TTL_SECONDS = 5 * 60;
function extensionFromMimeType(mimeType) {
    const normalized = mimeType.toLowerCase();
    if (normalized === 'application/pdf')
        return 'pdf';
    if (normalized === 'application/zip' ||
        normalized === 'application/x-zip-compressed' ||
        normalized === 'multipart/x-zip') {
        return 'zip';
    }
    if (normalized.includes('png'))
        return 'png';
    if (normalized.includes('webp'))
        return 'webp';
    if (normalized.includes('gif'))
        return 'gif';
    if (normalized.includes('heic'))
        return 'heic';
    if (normalized.includes('heif'))
        return 'heif';
    if (normalized.includes('bmp'))
        return 'bmp';
    return 'jpg';
}
function isAllowedDocumentMimeType(mimeType) {
    const normalized = mimeType.toLowerCase();
    return (normalized.startsWith('image/') ||
        normalized === 'application/pdf' ||
        normalized === 'application/zip' ||
        normalized === 'application/x-zip-compressed' ||
        normalized === 'multipart/x-zip');
}
function parseImageDataUrl(imageDataUrl) {
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
function toObjectSize(metadata) {
    const parsed = Number(metadata?.size ?? 0);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
function parseStorageOwner(path) {
    const normalized = path.trim();
    if (!normalized)
        return null;
    const segments = normalized.split('/').filter(Boolean);
    if (segments.length < 3)
        return null;
    if (segments[0] === 'documents') {
        return { uid: segments[1], group: 'ready' };
    }
    if (segments[0] === 'pending') {
        return { uid: segments[1], group: 'pending' };
    }
    return null;
}
async function getDocumentStorageUsageSummary() {
    const { data, error } = await supabase_1.supabaseAdmin
        .schema('storage')
        .from('objects')
        .select('name, metadata')
        .eq('bucket_id', DOCUMENT_BUCKET_NAME);
    if (error) {
        logger_1.logger.error('Failed to read Supabase Storage usage summary', { bucketName: DOCUMENT_BUCKET_NAME, error });
        throw new Error(`getDocumentStorageUsageSummary: ${error.message}`);
    }
    const summary = {
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
    const usageByUid = new Map();
    for (const row of (data ?? [])) {
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
        }
        else {
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
        }
        else {
            current.pendingBytes += size;
            current.pendingObjects += 1;
        }
        current.totalBytes += size;
        current.totalObjects += 1;
        usageByUid.set(owner.uid, current);
    }
    summary.users = [...usageByUid.values()].sort((a, b) => {
        if (b.totalBytes !== a.totalBytes)
            return b.totalBytes - a.totalBytes;
        return a.uid.localeCompare(b.uid);
    });
    return summary;
}
async function uploadPendingDocument(uid, imageDataUrl) {
    const { mimeType, buffer } = parseImageDataUrl(imageDataUrl);
    const draftId = (0, node_crypto_1.randomUUID)();
    const extension = extensionFromMimeType(mimeType);
    const storagePath = `pending/${uid}/${draftId}.${extension}`;
    const { error } = await supabase_1.supabaseAdmin.storage
        .from(DOCUMENT_BUCKET_NAME)
        .upload(storagePath, buffer, {
        contentType: mimeType,
        upsert: false
    });
    if (error) {
        logger_1.logger.error('Failed to upload pending document to Supabase Storage', {
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
async function finalizePendingDocumentMove(uid, pendingStoragePath, documentId, mimeType) {
    const extension = extensionFromMimeType(mimeType);
    const targetPath = `documents/${uid}/${documentId}.${extension}`;
    const { error } = await supabase_1.supabaseAdmin.storage
        .from(DOCUMENT_BUCKET_NAME)
        .move(pendingStoragePath, targetPath);
    if (error) {
        logger_1.logger.error('Failed to move pending document to final path', {
            uid,
            pendingStoragePath,
            targetPath,
            error
        });
        throw new Error(`finalizePendingDocumentMove: ${error.message}`);
    }
    return targetPath;
}
async function deleteStoredDocument(storagePath) {
    if (!storagePath.trim())
        return;
    const { error } = await supabase_1.supabaseAdmin.storage
        .from(DOCUMENT_BUCKET_NAME)
        .remove([storagePath]);
    if (error) {
        logger_1.logger.error('Failed to delete document from Supabase Storage', {
            storagePath,
            error
        });
        throw new Error(`deleteStoredDocument: ${error.message}`);
    }
}
async function createSignedDocumentUrl(storagePath, expiresInSeconds = SIGNED_URL_TTL_SECONDS) {
    const { data, error } = await supabase_1.supabaseAdmin.storage
        .from(DOCUMENT_BUCKET_NAME)
        .createSignedUrl(storagePath, expiresInSeconds);
    if (error || !data?.signedUrl) {
        logger_1.logger.error('Failed to create signed URL for document', {
            storagePath,
            error
        });
        throw new Error(`createSignedDocumentUrl: ${error?.message ?? 'signed URL unavailable'}`);
    }
    return data.signedUrl;
}
