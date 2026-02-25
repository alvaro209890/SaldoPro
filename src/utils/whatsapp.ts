export function normalizePhoneNumber(value: string): string {
    return value.replace(/[^\d]/g, '');
}

export function normalizeWhatsAppAccessCode(value: string): string {
    return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function hashBase36(input: string): string {
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36).toUpperCase();
}

export function generateWhatsAppAccessCode(uid: string): string {
    const normalizedUid = uid.trim();
    const partA = hashBase36(`${normalizedUid}:A`).padStart(4, '0').slice(0, 4);
    const partB = hashBase36(`${normalizedUid}:B`).padStart(4, '0').slice(0, 4);
    return `SP-${partA}-${partB}`;
}
