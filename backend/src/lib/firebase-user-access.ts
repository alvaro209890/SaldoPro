import { getAuth, type UserRecord } from 'firebase-admin/auth';
import { ensureFirebaseAdmin } from './firebase-admin';

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

export async function getFirebaseUserAccessState(uid: string, forceRefresh = false): Promise<FirebaseUserAccessState> {
  if (!forceRefresh) {
    const cached = userStateCache.get(uid);
    if (cached && Date.now() - cached.cachedAt <= FIREBASE_USER_CACHE_TTL_MS) {
      return cached.state;
    }
  }

  ensureFirebaseAdmin();

  try {
    const user = await getAuth().getUser(uid);
    const state = mapUserRecord(user);
    userStateCache.set(uid, { state, cachedAt: Date.now() });
    return state;
  } catch {
    const state = getMissingUserState(uid);
    userStateCache.set(uid, { state, cachedAt: Date.now() });
    return state;
  }
}

export async function isFirebaseUserActive(uid: string): Promise<boolean> {
  const state = await getFirebaseUserAccessState(uid);
  return state.exists && !state.disabled;
}

export async function setFirebaseUserDisabled(uid: string, disabled: boolean): Promise<void> {
  ensureFirebaseAdmin();
  await getAuth().updateUser(uid, { disabled });
  userStateCache.delete(uid);
}

export async function listAllFirebaseUserAccessStates(): Promise<Map<string, FirebaseUserAccessState>> {
  ensureFirebaseAdmin();

  const states = new Map<string, FirebaseUserAccessState>();
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
}
