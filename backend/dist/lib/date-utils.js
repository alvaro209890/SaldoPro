"use strict";
// backend/src/lib/date-utils.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBrasiliaDate = getBrasiliaDate;
exports.getBrasiliaISOString = getBrasiliaISOString;
/**
 * Returns a Date object representing the current time in Brasilia,
 * instantiated as a local JS Date so that getFullYear, getHours, etc. return exactly Brasilia's values.
 * Do not use toISOString() on this object if you want Brasilia time; use getBrasiliaISOString() instead.
 */
function getBrasiliaDate() {
    const now = new Date();
    const options = {
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
    const map = {};
    for (const part of parts) {
        if (part.type !== 'literal') {
            map[part.type] = part.value;
        }
    }
    return new Date(parseInt(map.year, 10), parseInt(map.month, 10) - 1, parseInt(map.day, 10), parseInt(map.hour, 10), parseInt(map.minute, 10), parseInt(map.second, 10));
}
/**
 * Returns the current time in Brasilia formatted as a sortable ISO-like string.
 * Example: '2024-05-10T14:30:00.000Z'
 */
function getBrasiliaISOString() {
    const now = new Date();
    const options = {
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
    const map = {};
    for (const part of parts) {
        if (part.type !== 'literal') {
            map[part.type] = part.value;
        }
    }
    return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}-03:00`;
}
