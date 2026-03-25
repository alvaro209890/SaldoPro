// backend/src/lib/date-utils.ts

/**
 * Returns a Date object representing the current time in Brasilia, 
 * instantiated as a local JS Date so that getFullYear, getHours, etc. return exactly Brasilia's values.
 * Do not use toISOString() on this object if you want Brasilia time; use getBrasiliaISOString() instead.
 */
export function getBrasiliaDate(): Date {
    const now = new Date();
    const options: Intl.DateTimeFormatOptions = {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false
    };
    const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(now);
    const map = {} as Record<string, string>;
    for (const part of parts) {
        if (part.type !== 'literal') {
            map[part.type] = part.value;
        }
    }
    return new Date(
        parseInt(map.year, 10),
        parseInt(map.month, 10) - 1,
        parseInt(map.day, 10),
        parseInt(map.hour, 10),
        parseInt(map.minute, 10),
        parseInt(map.second, 10)
    );
}

/**
 * Returns the current time in Brasilia formatted as a sortable ISO-like string.
 * Example: '2024-05-10T14:30:00.000Z'
 */
export function getBrasiliaISOString(): string {
    const now = new Date();
    const options: Intl.DateTimeFormatOptions = {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    };
    const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(now);
    const map = {} as Record<string, string>;
    for (const part of parts) {
        if (part.type !== 'literal') {
            map[part.type] = part.value;
        }
    }
    return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}-03:00`;
}
