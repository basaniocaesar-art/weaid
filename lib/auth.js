// Session helpers for provider/customer app endpoints.
// The frontend sends the Supabase session token as `Authorization: Bearer <jwt>`.
import { getUserFromToken, getProviderByUserId, getProviderByEditToken } from "./supabase.js";

export function bearer(req) {
  return (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || null;
}

export async function getSessionUser(req) {
  return getUserFromToken(bearer(req));
}

// Resolves the logged-in user AND their provider listing (may be null if they
// signed up but haven't created a listing yet).
export async function getSessionProvider(req) {
  const user = await getSessionUser(req);
  if (!user) return { user: null, provider: null };
  const provider = await getProviderByUserId(user.id);
  return { user, provider };
}

// Resolve the provider for an endpoint from EITHER their private edit_token
// (old token-link dashboard) OR their logged-in session (unified app). Returns
// the provider row or null. This is what lets one login see everything.
export async function resolveProvider(req) {
  const token = req.query?.token || req.body?.token;
  if (token) {
    const p = await getProviderByEditToken(token);
    if (p) return p;
  }
  const { provider } = await getSessionProvider(req);
  return provider;
}
