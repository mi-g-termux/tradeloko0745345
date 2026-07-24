// Supabase clients. The service client is server-only (full access);
// the anon client is safe for the browser.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PUBLIC_ENV, SERVER_ENV, hasSupabase } from "./config";

let serviceClient: SupabaseClient | null = null;

/** Server-side client with the service role key. Never import into client code. */
export function getServiceClient(): SupabaseClient | null {
  if (!hasSupabase()) return null;
  if (!serviceClient) {
    serviceClient = createClient(
      SERVER_ENV.supabaseUrl,
      SERVER_ENV.supabaseServiceKey,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return serviceClient;
}

/** Browser-safe anon client. */
export function getAnonClient(): SupabaseClient | null {
  if (!PUBLIC_ENV.supabaseUrl || !PUBLIC_ENV.supabaseAnonKey) return null;
  return createClient(PUBLIC_ENV.supabaseUrl, PUBLIC_ENV.supabaseAnonKey, {
    auth: { persistSession: false },
  });
}
