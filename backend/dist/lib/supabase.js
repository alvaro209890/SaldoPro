"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.supabaseAdmin = void 0;
exports.createSupabaseServerClient = createSupabaseServerClient;
const supabase_js_1 = require("@supabase/supabase-js");
const env_1 = require("../config/env");
function buildSupabaseServerClient() {
    return (0, supabase_js_1.createClient)(env_1.env.supabaseUrl, env_1.env.supabaseServiceRoleKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        }
    });
}
// Keep a dedicated singleton for database access. Auth flows that mutate client
// session state must use a fresh instance so the service-role client is never
// downgraded to an end-user bearer token.
exports.supabaseAdmin = buildSupabaseServerClient();
function createSupabaseServerClient() {
    return buildSupabaseServerClient();
}
