import { createClient } from "@supabase/supabase-js";
import { getProviderByUserId, insertProvider, updateProvider } from "../../../lib/supabase.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function makeSlug(name) {
  const base = (name || "pro").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "pro";
  return base + "-" + Math.random().toString(36).slice(2, 6);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
      return res.status(401).json({ error: "No token provided" });
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    const { role, name, phone } = req.body;

    // Self-serve roles only. "admin" is NEVER settable via this endpoint —
    // it must be granted directly in the database. Prevents privilege escalation.
    if (!role || !["customer", "provider"].includes(role)) {
      return res.status(400).json({ error: "Invalid role. Must be customer or provider" });
    }

    // Phone is how customers & providers reach each other — required at signup.
    const cleanPhone = (phone || "").replace(/[^\d+]/g, "");
    if (cleanPhone.replace(/\D/g, "").length < 10) {
      return res.status(400).json({ error: "A valid phone number is required" });
    }

    // Upsert user profile. phone_verified stays true only if it came from an SMS
    // OTP (user.phone); a self-entered number is unverified.
    const { data: profile, error: upsertErr } = await supabase
      .from("users")
      .upsert({
        id: user.id,
        phone: cleanPhone || user.phone,
        role,
        name: name || null,
        phone_verified: !!user.phone,
        updated_at: new Date().toISOString(),
      }, { onConflict: "id" })
      .select()
      .single();

    if (upsertErr) throw upsertErr;

    // Providers get a directory/listing row linked to their login, so ONE login
    // powers everything (bookings, rides, food, earnings). They flesh out
    // services/city later via "Edit profile".
    if (role === "provider") {
      const existing = await getProviderByUserId(user.id).catch(() => null);
      if (!existing) {
        await insertProvider({
          user_id: user.id,
          name: name || null,
          phone: cleanPhone || user.phone || null,
          slug: makeSlug(name),
          services: [],
          available: true,
          source: "app",
          claimed: true,
        }).catch((e) => console.error("[set-role] provider row create:", e.message));
      } else if (cleanPhone && !existing.phone) {
        await updateProvider(existing.id, { phone: cleanPhone }).catch(() => {});
      }
    }

    return res.status(200).json({ role: profile.role, name: profile.name });
  } catch (err) {
    console.error("[auth/set-role]", err);
    return res.status(500).json({ error: err.message });
  }
}
