"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
function parseImageDataUrl(imageDataUrl) {
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
