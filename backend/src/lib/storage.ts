import { supabaseAdmin } from './supabase';
import { logger } from './logger';

const BUCKET_NAME = 'receipts';

/**
 * Uploads a base64 receipt image to Supabase Storage.
 * @param uid The user ID.
 * @param base64Data The base64 string of the image (must include the data URL prefix if any).
 * @param mimeType The mime type of the image.
 * @returns The public URL of the uploaded image, or null if it fails.
 */
export async function uploadReceipt(
    uid: string,
    base64Data: string,
    mimeType: string
): Promise<string | null> {
    try {
        // Determine file extension
        let extension = 'jpg';
        if (mimeType.includes('png')) extension = 'png';
        else if (mimeType.includes('webp')) extension = 'webp';

        // Strip the "data:image/jpeg;base64," prefix if present
        const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(cleanBase64, 'base64');

        // Generate a unique filename using timestamp
        const timestamp = Date.now();
        const fileName = `${uid}/${timestamp}.${extension}`;

        const { data, error } = await supabaseAdmin.storage
            .from(BUCKET_NAME)
            .upload(fileName, buffer, {
                contentType: mimeType,
                upsert: false
            });

        if (error) {
            logger.error('Failed to upload receipt to Supabase Storage', { uid, error });
            return null;
        }

        const { data: publicData } = supabaseAdmin.storage
            .from(BUCKET_NAME)
            .getPublicUrl(data.path);

        return publicData.publicUrl;
    } catch (error) {
        logger.error('Exception while uploading receipt', { uid, error });
        return null;
    }
}
