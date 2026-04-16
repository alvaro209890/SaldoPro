import { getAuth, type UserRecord } from 'firebase-admin/auth';
import { ensureFirebaseAdmin } from './firebase-admin';
import { env } from '../config/env';
import {
  getLocalUserAccessSnapshot,
  listLocalUserAccessSnapshots,
  type LocalUserAccessSnapshot
} from './firestore';
import { logger } from './logger';

const FIREBASE_USER_CACHE_TTL_MS = 30_000;

export interface FirebaseUserAccessState {
  uid: string;
  exists: boolean;
  disabled: boolean;
  email: string | null;
  displayName: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
}

const userStateCache = new Map<string, { state: FirebaseUserAccessState; cachedAt: number }>();

interface IdentityToolkitUser {
  localId?: string;
  email?: string;
  displayName?: string;
  createdAt?: string;
  lastLoginAt?: string;
  disabled?: boolean;
}

function mapUserRecord(user: UserRecord): FirebaseUserAccessState {
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

function getMissingUserState(uid: string): FirebaseUserAccessState {
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

function mapLocalUserSnapshot(user: LocalUserAccessSnapshot): FirebaseUserAccessState {
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

function parseFirebaseTimestamp(value: string | undefined): string | null {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return new Date(numeric).toISOString();
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function mapIdentityToolkitUser(user: IdentityToolkitUser, fallbackUid: string): FirebaseUserAccessState {
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

async function lookupIdentityToolkitUser(payload: Record<string, unknown>): Promise<IdentityToolkitUser | null> {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.firebaseWebApiKey)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }
  );

  if (!response.ok) {
    logger.warn('Identity Toolkit lookup failed', {
      status: response.status,
      statusText: response.statusText
    });
    return null;
  }

  const data = await response.json() as { users?: IdentityToolkitUser[] };
  return data.users?.[0] ?? null;
}

export async function getFirebaseUserAccessState(uid: string, forceRefresh = false): Promise<FirebaseUserAccessState> {
  if (!forceRefresh) {
    const cached = userStateCache.get(uid);
    if (cached && Date.now() - cached.cachedAt <= FIREBASE_USER_CACHE_TTL_MS) {
      return cached.state;
    }
  }

  if (ensureFirebaseAdmin()) {
    try {
      const user = await getAuth().getUser(uid);
      const state = mapUserRecord(user);
      userStateCache.set(uid, { state, cachedAt: Date.now() });
      return state;
    } catch (error) {
      logger.warn('Firebase Admin getUser failed, falling back to Identity Toolkit lookup', {
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

  const localUser = await getLocalUserAccessSnapshot(uid);
  if (localUser) {
    logger.warn('Falling back to local user access snapshot because Firebase lookup by UID is unavailable', {
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

export async function isFirebaseUserActive(uid: string): Promise<boolean> {
  const state = await getFirebaseUserAccessState(uid);
  return state.exists && !state.disabled;
}

export async function setFirebaseUserDisabled(uid: string, disabled: boolean): Promise<void> {
  if (!ensureFirebaseAdmin()) {
    throw new Error('Firebase Admin is not configured.');
  }
  await getAuth().updateUser(uid, { disabled });
  userStateCache.delete(uid);
}

export async function listAllFirebaseUserAccessStates(): Promise<Map<string, FirebaseUserAccessState>> {
  const states = new Map<string, FirebaseUserAccessState>();
  if (ensureFirebaseAdmin()) {
    try {
      let pageToken: string | undefined;

      do {
        const page = await getAuth().listUsers(1000, pageToken);
        for (const user of page.users) {
          const state = mapUserRecord(user);
          states.set(user.uid, state);
          userStateCache.set(user.uid, { state, cachedAt: Date.now() });
        }
        pageToken = page.pageToken;
      } while (pageToken);

      return states;
    } catch (error) {
      logger.warn('Firebase Admin listUsers failed, falling back to local user snapshots', {
        error: error instanceof Error ? error.message : 'unknown'
      });
    }
  } else {
    logger.warn('Firebase Admin is not configured; falling back to local user snapshots.');
  }

  const localUsers = await listLocalUserAccessSnapshots();
  for (const user of localUsers) {
    const state = mapLocalUserSnapshot(user);
    states.set(user.uid, state);
    userStateCache.set(user.uid, { state, cachedAt: Date.now() });
  }

  return states;
}

export async function getFirebaseUserAccessStateFromIdToken(idToken: string): Promise<FirebaseUserAccessState | null> {
  const fallbackUser = await lookupIdentityToolkitUser({ idToken });
  if (!fallbackUser?.localId) {
    return null;
  }

  const state = mapIdentityToolkitUser(fallbackUser, fallbackUser.localId);
  userStateCache.set(state.uid, { state, cachedAt: Date.now() });
  return state;
}
