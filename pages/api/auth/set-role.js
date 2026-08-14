import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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

    return res.status(200).json({ role: profile.role, name: profile.name });
  } catch (err) {
    console.error("[auth/set-role]", err);
    return res.status(500).json({ error: err.message });
  }
}
