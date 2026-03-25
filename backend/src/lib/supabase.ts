import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env';

function buildSupabaseServerClient() {
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

// Keep a dedicated singleton for database access. Auth flows that mutate client
// session state must use a fresh instance so the service-role client is never
// downgraded to an end-user bearer token.
export const supabaseAdmin = buildSupabaseServerClient();

export function createSupabaseServerClient() {
  return buildSupabaseServerClient();
}
