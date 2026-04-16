"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFirebaseUserAccessState = getFirebaseUserAccessState;
exports.isFirebaseUserActive = isFirebaseUserActive;
exports.setFirebaseUserDisabled = setFirebaseUserDisabled;
exports.listAllFirebaseUserAccessStates = listAllFirebaseUserAccessStates;
exports.getFirebaseUserAccessStateFromIdToken = getFirebaseUserAccessStateFromIdToken;
const auth_1 = require("firebase-admin/auth");
const firebase_admin_1 = require("./firebase-admin");
const env_1 = require("../config/env");
const firestore_1 = require("./firestore");
const logger_1 = require("./logger");
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
function mapLocalUserSnapshot(user) {
    return {
        uid: user.uid,
        exists: true,
        disabled: false,
        email: user.email,
        displayName: user.displayName,
        createdAt: user.createdAt,
        lastSignInAt: null
    };
}
function parseFirebaseTimestamp(value) {
    if (!value)
        return null;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
        return new Date(numeric).toISOString();
    }
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
function mapIdentityToolkitUser(user, fallbackUid) {
    return {
        uid: user.localId?.trim() || fallbackUid,
        exists: Boolean(user.localId),
        disabled: Boolean(user.disabled),
        email: user.email?.trim() || null,
        displayName: user.displayName?.trim() || null,
        createdAt: parseFirebaseTimestamp(user.createdAt),
        lastSignInAt: parseFirebaseTimestamp(user.lastLoginAt)
    };
}
async function lookupIdentityToolkitUser(payload) {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env_1.env.firebaseWebApiKey)}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        logger_1.logger.warn('Identity Toolkit lookup failed', {
            status: response.status,
            statusText: response.statusText
        });
        return null;
    }
    const data = await response.json();
    return data.users?.[0] ?? null;
}
async function getFirebaseUserAccessState(uid, forceRefresh = false) {
    if (!forceRefresh) {
        const cached = userStateCache.get(uid);
        if (cached && Date.now() - cached.cachedAt <= FIREBASE_USER_CACHE_TTL_MS) {
            return cached.state;
        }
    }
    if ((0, firebase_admin_1.ensureFirebaseAdmin)()) {
        try {
            const user = await (0, auth_1.getAuth)().getUser(uid);
            const state = mapUserRecord(user);
            userStateCache.set(uid, { state, cachedAt: Date.now() });
            return state;
        }
        catch (error) {
            logger_1.logger.warn('Firebase Admin getUser failed, falling back to Identity Toolkit lookup', {
                uid,
                error: error instanceof Error ? error.message : 'unknown'
            });
        }
    }
    const fallbackUser = await lookupIdentityToolkitUser({ localId: [uid] });
    if (fallbackUser) {
        const state = mapIdentityToolkitUser(fallbackUser, uid);
        userStateCache.set(uid, { state, cachedAt: Date.now() });
        return state;
    }
    const localUser = await (0, firestore_1.getLocalUserAccessSnapshot)(uid);
    if (localUser) {
        logger_1.logger.warn('Falling back to local user access snapshot because Firebase lookup by UID is unavailable', {
            uid
        });
        const state = mapLocalUserSnapshot(localUser);
        userStateCache.set(uid, { state, cachedAt: Date.now() });
        return state;
    }
    const state = getMissingUserState(uid);
    userStateCache.set(uid, { state, cachedAt: Date.now() });
    return state;
}
async function isFirebaseUserActive(uid) {
    const state = await getFirebaseUserAccessState(uid);
    return state.exists && !state.disabled;
}
async function setFirebaseUserDisabled(uid, disabled) {
    if (!(0, firebase_admin_1.ensureFirebaseAdmin)()) {
        throw new Error('Firebase Admin is not configured.');
    }
    await (0, auth_1.getAuth)().updateUser(uid, { disabled });
    userStateCache.delete(uid);
}
async function listAllFirebaseUserAccessStates() {
    const states = new Map();
    if ((0, firebase_admin_1.ensureFirebaseAdmin)()) {
        try {
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
        catch (error) {
            logger_1.logger.warn('Firebase Admin listUsers failed, falling back to local user snapshots', {
                error: error instanceof Error ? error.message : 'unknown'
            });
        }
    }
    else {
        logger_1.logger.warn('Firebase Admin is not configured; falling back to local user snapshots.');
    }
    const localUsers = await (0, firestore_1.listLocalUserAccessSnapshots)();
    for (const user of localUsers) {
        const state = mapLocalUserSnapshot(user);
        states.set(user.uid, state);
        userStateCache.set(user.uid, { state, cachedAt: Date.now() });
    }
    return states;
}
async function getFirebaseUserAccessStateFromIdToken(idToken) {
    const fallbackUser = await lookupIdentityToolkitUser({ idToken });
    if (!fallbackUser?.localId) {
        return null;
    }
    const state = mapIdentityToolkitUser(fallbackUser, fallbackUser.localId);
    userStateCache.set(state.uid, { state, cachedAt: Date.now() });
    return state;
}
