import { supabaseAdmin } from './supabase';

const USER_ACTIVE_CACHE = new Map<string, { active: boolean; cachedAt: number }>();
const CACHE_TTL_MS = 30_000;

/**
 * Checks whether a Supabase Auth user exists and is not banned.
 * Results are cached for 30 seconds to avoid excessive API calls.
 */
export async function isSupabaseUserActive(uid: string): Promise<boolean> {
  const cached = USER_ACTIVE_CACHE.get(uid);
  if (cached && Date.now() - cached.cachedAt <= CACHE_TTL_MS) {
    return cached.active;
  }

  try {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(uid);
    if (error || !data.user) {
      USER_ACTIVE_CACHE.set(uid, { active: false, cachedAt: Date.now() });
      return false;
    }

    // Supabase uses 'banned_until' for disabled users.
    const banned = data.user.banned_until;
    const isActive = !banned || new Date(banned).getTime() < Date.now();
    USER_ACTIVE_CACHE.set(uid, { active: isActive, cachedAt: Date.now() });
    return isActive;
  } catch {
    USER_ACTIVE_CACHE.set(uid, { active: false, cachedAt: Date.now() });
    return false;
  }
}
