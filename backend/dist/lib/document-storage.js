"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentUploadUserError = exports.MAX_SOURCE_PDF_BYTES_FOR_COMPRESSION = exports.MAX_STORED_DOCUMENT_BYTES = void 0;
exports.resolveSignedDocumentToken = resolveSignedDocumentToken;
exports.getDocumentStorageUsageSummary = getDocumentStorageUsageSummary;
exports.uploadPendingDocument = uploadPendingDocument;
exports.finalizePendingDocumentMove = finalizePendingDocumentMove;
exports.deleteStoredDocument = deleteStoredDocument;
exports.createSignedDocumentUrl = createSignedDocumentUrl;
exports.readSignedDocument = readSignedDocument;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const env_1 = require("../config/env");
const logger_1 = require("./logger");
const pdf_compression_1 = require("./pdf-compression");
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
function mimeTypeFromPath(storagePath) {
    switch ((0, node_path_1.extname)(storagePath).toLowerCase()) {
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
function resolveStoragePath(storagePath) {
    const relative = storagePath.replace(/^\/+/, '');
    const absolute = (0, node_path_1.resolve)(env_1.env.localDocumentsDir, relative);
    const root = (0, node_path_1.resolve)(env_1.env.localDocumentsDir);
    if (!absolute.startsWith(root)) {
        throw new Error('Invalid storage path.');
    }
    return absolute;
}
async function ensureParentDir(filePath) {
    await node_fs_1.promises.mkdir((0, node_path_1.dirname)(filePath), { recursive: true });
}
function buildTokenPayload(storagePath, expiresAt) {
    return Buffer.from(JSON.stringify({ storagePath, expiresAt }), 'utf8').toString('base64url');
}
function signTokenPayload(payload) {
    return (0, node_crypto_1.createHmac)('sha256', env_1.env.localStorageSigningSecret).update(payload).digest('base64url');
}
function buildSignedToken(storagePath, expiresInSeconds) {
    const payload = buildTokenPayload(storagePath, Date.now() + expiresInSeconds * 1000);
    return `${payload}.${signTokenPayload(payload)}`;
}
function safeCompare(left, right) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length)
        return false;
    return (0, node_crypto_1.timingSafeEqual)(leftBuffer, rightBuffer);
}
function resolveSignedDocumentToken(token) {
    const [payload, signature] = token.split('.');
    if (!payload || !signature) {
        throw new Error('Invalid signed document token.');
    }
    if (!safeCompare(signature, signTokenPayload(payload))) {
        throw new Error('Invalid signed document token.');
    }
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
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
async function listFilesRecursive(root, prefix = '') {
    let entries;
    try {
        entries = (await node_fs_1.promises.readdir(root, { withFileTypes: true }));
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
    const results = [];
    for (const entry of entries) {
        const absolute = (0, node_path_1.join)(root, entry.name);
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            results.push(...await listFilesRecursive(absolute, relative));
            continue;
        }
        const stat = await node_fs_1.promises.stat(absolute);
        results.push({ path: relative, size: stat.size });
    }
    return results;
}
async function getDocumentStorageUsageSummary() {
    const files = await listFilesRecursive(env_1.env.localDocumentsDir);
    const summary = {
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
    const users = new Map();
    const ensureUser = (uid) => {
        const current = users.get(uid);
        if (current)
            return current;
        const created = {
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
        }
        else if (group === 'pending') {
            summary.pendingBytes += file.size;
            summary.pendingObjects += 1;
            usage.pendingBytes += file.size;
            usage.pendingObjects += 1;
        }
        else {
            summary.unassignedBytes += file.size;
            summary.unassignedObjects += 1;
        }
    }
    summary.users = [...users.values()].sort((a, b) => b.totalBytes - a.totalBytes);
    return summary;
}
async function uploadPendingDocument(uid, fileDataUrl) {
    try {
        const parsed = parseImageDataUrl(fileDataUrl);
        let uploadBuffer = parsed.buffer;
        if (parsed.mimeType === 'application/pdf' && uploadBuffer.length > exports.MAX_STORED_DOCUMENT_BYTES) {
            if (uploadBuffer.length > exports.MAX_SOURCE_PDF_BYTES_FOR_COMPRESSION) {
                throw new DocumentUploadUserError(`uploadPendingDocument: PDF source exceeds compression limit (${uploadBuffer.length} bytes)`, 'O PDF enviado é grande demais para processamento local.');
            }
            const compressed = await (0, pdf_compression_1.compressPdfBufferToFit)(uploadBuffer, exports.MAX_STORED_DOCUMENT_BYTES);
            if (!compressed) {
                throw new DocumentUploadUserError('uploadPendingDocument: PDF compression returned an empty payload', 'Não consegui processar esse PDF. Tente um arquivo diferente.');
            }
            uploadBuffer = compressed;
            if (uploadBuffer.length > exports.MAX_STORED_DOCUMENT_BYTES) {
                throw new DocumentUploadUserError(`uploadPendingDocument: could not reduce PDF to ${exports.MAX_STORED_DOCUMENT_BYTES} bytes`, 'Não consegui compactar esse PDF o suficiente. Tente um arquivo menor.');
            }
        }
        if (uploadBuffer.length > exports.MAX_STORED_DOCUMENT_BYTES) {
            throw new DocumentUploadUserError(`uploadPendingDocument: file exceeds storage limit (${uploadBuffer.length} bytes)`, 'O arquivo excede o limite permitido de 10 MB.');
        }
        const draftId = (0, node_crypto_1.randomUUID)();
        const storagePath = `pending/${uid}/${draftId}.${extensionFromMimeType(parsed.mimeType)}`;
        const absolutePath = resolveStoragePath(storagePath);
        await ensureParentDir(absolutePath);
        await node_fs_1.promises.writeFile(absolutePath, uploadBuffer);
        return {
            draftId,
            storagePath,
            mimeType: parsed.mimeType,
            sizeBytes: uploadBuffer.length
        };
    }
    catch (error) {
        if (error instanceof DocumentUploadUserError) {
            throw error;
        }
        throw new Error(`uploadPendingDocument: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
}
async function finalizePendingDocumentMove(uid, pendingStoragePath, documentId, mimeType) {
    const finalStoragePath = `documents/${uid}/${documentId}.${extensionFromMimeType(mimeType)}`;
    try {
        const source = resolveStoragePath(pendingStoragePath);
        const target = resolveStoragePath(finalStoragePath);
        await ensureParentDir(target);
        await node_fs_1.promises.rename(source, target);
        return finalStoragePath;
    }
    catch (error) {
        throw new Error(`finalizePendingDocumentMove: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
}
async function deleteStoredDocument(storagePath) {
    try {
        await node_fs_1.promises.rm(resolveStoragePath(storagePath), { force: true });
    }
    catch (error) {
        throw new Error(`deleteStoredDocument: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
}
async function createSignedDocumentUrl(storagePath, expiresInSeconds = SIGNED_URL_TTL_SECONDS) {
    try {
        const absolutePath = resolveStoragePath(storagePath);
        await node_fs_1.promises.access(absolutePath);
        const token = buildSignedToken(storagePath, expiresInSeconds);
        if (!env_1.env.backendUrl) {
            throw new Error('BACKEND_URL is required to create signed URLs.');
        }
        return `${env_1.env.backendUrl}/api/storage/signed?token=${encodeURIComponent(token)}`;
    }
    catch (error) {
        logger_1.logger.warn('Failed to create local signed document URL', {
            storagePath,
            error: error instanceof Error ? error.message : 'unknown'
        });
        throw new Error(`createSignedDocumentUrl: ${error instanceof Error ? error.message : 'signed URL unavailable'}`);
    }
}
async function readSignedDocument(token) {
    const resolved = resolveSignedDocumentToken(token);
    await node_fs_1.promises.access(resolved.absolutePath);
    return {
        absolutePath: resolved.absolutePath,
        mimeType: resolved.mimeType,
        fileName: (0, node_path_1.basename)(resolved.absolutePath)
    };
}
