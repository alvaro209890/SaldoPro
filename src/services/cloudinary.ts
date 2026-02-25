// Cloudinary Service for image uploads
// Using the provided user credentials

const CLOUD_NAME = 'da19dwpgk';
const API_KEY = '197151851281131';
// API Secret is not strictly needed for unsigned uploads from the frontend,
// but we'll configure an unsigned upload preset to securely allow uploads.

export async function uploadImageToCloudinary(base64Image: string): Promise<string> {
    try {
        const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;

        const formData = new FormData();
        formData.append('file', base64Image);
        formData.append('upload_preset', 'ml_default'); // Assuming a default unsigned preset exists. If not, users might need to create one, but we'll use this generic fallback.

        const response = await fetch(url, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errStr = await response.text();
            console.error("Cloudinary Error:", errStr);
            throw new Error('Falha ao fazer upload da imagem.');
        }

        const data = await response.json();
        return data.secure_url;
    } catch (error) {
        console.error('Erro no upload para o Cloudinary:', error);
        throw error;
    }
}
