"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSupabaseUserActive = isSupabaseUserActive;
const firebase_user_access_1 = require("./firebase-user-access");
const USER_ACTIVE_CACHE = new Map();
const CACHE_TTL_MS = 30_000;
async function isSupabaseUserActive(uid) {
    const cached = USER_ACTIVE_CACHE.get(uid);
    if (cached && Date.now() - cached.cachedAt <= CACHE_TTL_MS) {
        return cached.active;
    }
    const active = await (0, firebase_user_access_1.isFirebaseUserActive)(uid);
    USER_ACTIVE_CACHE.set(uid, { active, cachedAt: Date.now() });
    return active;
}
