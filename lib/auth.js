// Session helpers for provider/customer app endpoints.
// The frontend sends the Supabase session token as `Authorization: Bearer <jwt>`.
import { getUserFromToken, getProviderByUserId } from "./supabase.js";

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
