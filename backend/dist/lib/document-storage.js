"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentUploadUserError = exports.MAX_SOURCE_PDF_BYTES_FOR_COMPRESSION = exports.MAX_STORED_DOCUMENT_BYTES = void 0;
exports.getDocumentStorageUsageSummary = getDocumentStorageUsageSummary;
exports.uploadPendingDocument = uploadPendingDocument;
exports.finalizePendingDocumentMove = finalizePendingDocumentMove;
exports.deleteStoredDocument = deleteStoredDocument;
exports.createSignedDocumentUrl = createSignedDocumentUrl;
const node_crypto_1 = require("node:crypto");
const logger_1 = require("./logger");
const pdf_compression_1 = require("./pdf-compression");
const supabase_1 = require("./supabase");
const DOCUMENT_BUCKET_NAME = 'user-documents';
const SIGNED_URL_TTL_SECONDS = 5 * 60;
exports.MAX_STORED_DOCUMENT_BYTES = 10 * 1024 * 1024;
exports.MAX_SOURCE_PDF_BYTES_FOR_COMPRESSION = 40 * 1024 * 1024;
class DocumentUploadUserError extends Error {
    userMessage;
    constructor(message, userMessage) {
        super(message);
        this.name = 'DocumentUploadUserError';
        this.userMessage = userMessage;
    }
}
exports.DocumentUploadUserError = DocumentUploadUserError;
const STORAGE_LIST_PAGE_SIZE = 100;
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
async function listStorageDirectory(path) {
    const items = [];
    let offset = 0;
    while (true) {
        const { data, error } = await supabase_1.supabaseAdmin.storage
            .from(DOCUMENT_BUCKET_NAME)
            .list(path, {
            limit: STORAGE_LIST_PAGE_SIZE,
            offset,
            sortBy: { column: 'name', order: 'asc' }
        });
        if (error) {
            logger_1.logger.error('Failed to list Supabase Storage directory', {
                bucketName: DOCUMENT_BUCKET_NAME,
                path,
                error
            });
            throw new Error(`listStorageDirectory(${path || '/'}): ${error.message}`);
        }
        const page = (data ?? []);
        items.push(...page);
        if (page.length < STORAGE_LIST_PAGE_SIZE) {
            break;
        }
        offset += STORAGE_LIST_PAGE_SIZE;
    }
    return items;
}
async function listTrackedStorageObjects() {
    const rows = [];
    for (const prefix of ['documents', 'pending']) {
        const ownerFolders = await listStorageDirectory(prefix);
        for (const ownerFolder of ownerFolders) {
            const ownerName = ownerFolder.name?.trim();
            if (!ownerName)
                continue;
            const ownerPath = `${prefix}/${ownerName}`;
            const files = await listStorageDirectory(ownerPath);
            for (const file of files) {
                const fileName = file.name?.trim();
                if (!fileName)
                    continue;
                rows.push({
                    name: `${ownerPath}/${fileName}`,
                    metadata: file.metadata ?? null
                });
            }
        }
    }
    return rows;
}
async function getDocumentStorageUsageSummary() {
    const data = await listTrackedStorageObjects();
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
    let uploadBuffer = buffer;
    if (mimeType === 'application/pdf' && uploadBuffer.length > exports.MAX_STORED_DOCUMENT_BYTES) {
        if (uploadBuffer.length > exports.MAX_SOURCE_PDF_BYTES_FOR_COMPRESSION) {
            throw new DocumentUploadUserError(`uploadPendingDocument: PDF source exceeds compression limit (${uploadBuffer.length} bytes)`, 'Recebi o PDF, mas ele esta grande demais para eu reduzir aqui. Envie um PDF menor ou dividido em partes.');
        }
        const compressed = await (0, pdf_compression_1.compressPdfBufferToFit)(uploadBuffer, exports.MAX_STORED_DOCUMENT_BYTES);
        if (!compressed) {
            throw new DocumentUploadUserError(`uploadPendingDocument: could not reduce PDF to ${exports.MAX_STORED_DOCUMENT_BYTES} bytes`, 'Recebi o PDF, mas nao consegui reduzir para menos de 10 MB. Tente um PDF menor ou dividido em partes.');
        }
        logger_1.logger.info('Compressed inbound PDF before storage', {
            uid,
            originalBytes: uploadBuffer.length,
            compressedBytes: compressed.length
        });
        uploadBuffer = compressed;
    }
    if (uploadBuffer.length > exports.MAX_STORED_DOCUMENT_BYTES) {
        throw new DocumentUploadUserError(`uploadPendingDocument: file exceeds storage limit (${uploadBuffer.length} bytes)`, 'Recebi o arquivo, mas ele precisa ter ate 10 MB para ser salvo aqui.');
    }
    const draftId = (0, node_crypto_1.randomUUID)();
    const extension = extensionFromMimeType(mimeType);
    const storagePath = `pending/${uid}/${draftId}.${extension}`;
    const { error } = await supabase_1.supabaseAdmin.storage
        .from(DOCUMENT_BUCKET_NAME)
        .upload(storagePath, uploadBuffer, {
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
        sizeBytes: uploadBuffer.length
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
