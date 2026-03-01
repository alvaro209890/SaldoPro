"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFirebaseUserAccessState = getFirebaseUserAccessState;
exports.isFirebaseUserActive = isFirebaseUserActive;
exports.setFirebaseUserDisabled = setFirebaseUserDisabled;
exports.listAllFirebaseUserAccessStates = listAllFirebaseUserAccessStates;
const auth_1 = require("firebase-admin/auth");
const firebase_admin_1 = require("./firebase-admin");
const FIREBASE_USER_CACHE_TTL_MS = 30_000;
const userStateCache = new Map();
function mapUserRecord(user) {
    return {
        uid: user.uid,
        exists: true,
        disabled: user.disabled,
        email: user.email ?? null,
        displayName: user.displayName ?? null,
        createdAt: user.metadata.creationTime ? new Date(user.metadata.creationTime).toISOString() : null,
        lastSignInAt: user.metadata.lastSignInTime ? new Date(user.metadata.lastSignInTime).toISOString() : null
    };
}
function getMissingUserState(uid) {
    return {
        uid,
        exists: false,
        disabled: true,
        email: null,
        displayName: null,
        createdAt: null,
        lastSignInAt: null
    };
}
async function getFirebaseUserAccessState(uid, forceRefresh = false) {
    if (!forceRefresh) {
        const cached = userStateCache.get(uid);
        if (cached && Date.now() - cached.cachedAt <= FIREBASE_USER_CACHE_TTL_MS) {
            return cached.state;
        }
    }
    (0, firebase_admin_1.ensureFirebaseAdmin)();
    try {
        const user = await (0, auth_1.getAuth)().getUser(uid);
        const state = mapUserRecord(user);
        userStateCache.set(uid, { state, cachedAt: Date.now() });
        return state;
    }
    catch {
        const state = getMissingUserState(uid);
        userStateCache.set(uid, { state, cachedAt: Date.now() });
        return state;
    }
}
async function isFirebaseUserActive(uid) {
    const state = await getFirebaseUserAccessState(uid);
    return state.exists && !state.disabled;
}
async function setFirebaseUserDisabled(uid, disabled) {
    (0, firebase_admin_1.ensureFirebaseAdmin)();
    await (0, auth_1.getAuth)().updateUser(uid, { disabled });
    userStateCache.delete(uid);
}
async function listAllFirebaseUserAccessStates() {
    (0, firebase_admin_1.ensureFirebaseAdmin)();
    const states = new Map();
    let pageToken;
    do {
        const page = await (0, auth_1.getAuth)().listUsers(1000, pageToken);
        for (const user of page.users) {
            const state = mapUserRecord(user);
            states.set(user.uid, state);
            userStateCache.set(user.uid, { state, cachedAt: Date.now() });
        }
        pageToken = page.pageToken;
    } while (pageToken);
    return states;
}
