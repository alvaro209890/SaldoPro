"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadReceipt = uploadReceipt;
const supabase_1 = require("./supabase");
const logger_1 = require("./logger");
const BUCKET_NAME = 'receipts';
/**
 * Uploads a base64 receipt image to Supabase Storage.
 * @param uid The user ID.
 * @param base64Data The base64 string of the image (must include the data URL prefix if any).
 * @param mimeType The mime type of the image.
 * @returns The public URL of the uploaded image, or null if it fails.
 */
async function uploadReceipt(uid, base64Data, mimeType) {
    try {
        // Determine file extension
        let extension = 'jpg';
        if (mimeType.includes('png'))
            extension = 'png';
        else if (mimeType.includes('webp'))
            extension = 'webp';
        // Strip the "data:image/jpeg;base64," prefix if present
        const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(cleanBase64, 'base64');
        // Generate a unique filename using timestamp
        const timestamp = Date.now();
        const fileName = `${uid}/${timestamp}.${extension}`;
        const { data, error } = await supabase_1.supabaseAdmin.storage
            .from(BUCKET_NAME)
            .upload(fileName, buffer, {
            contentType: mimeType,
            upsert: false
        });
        if (error) {
            logger_1.logger.error('Failed to upload receipt to Supabase Storage', { uid, error });
            return null;
        }
        const { data: publicData } = supabase_1.supabaseAdmin.storage
            .from(BUCKET_NAME)
            .getPublicUrl(data.path);
        return publicData.publicUrl;
    }
    catch (error) {
        logger_1.logger.error('Exception while uploading receipt', { uid, error });
        return null;
    }
}
