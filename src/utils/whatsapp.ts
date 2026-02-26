export function normalizePhoneNumber(value: string): string {
    return value.replace(/[^\d]/g, '');
}
