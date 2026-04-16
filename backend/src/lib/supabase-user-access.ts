import { isFirebaseUserActive } from './firebase-user-access';

const USER_ACTIVE_CACHE = new Map<string, { active: boolean; cachedAt: number }>();
const CACHE_TTL_MS = 30_000;

export async function isSupabaseUserActive(uid: string): Promise<boolean> {
  const cached = USER_ACTIVE_CACHE.get(uid);
  if (cached && Date.now() - cached.cachedAt <= CACHE_TTL_MS) {
    return cached.active;
  }

  const active = await isFirebaseUserActive(uid);
  USER_ACTIVE_CACHE.set(uid, { active, cachedAt: Date.now() });
  return active;
}
