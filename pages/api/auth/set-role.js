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

    const { role, name } = req.body;

    if (!role || !["customer", "provider", "admin"].includes(role)) {
      return res.status(400).json({ error: "Invalid role. Must be customer, provider, or admin" });
    }

    // Upsert user profile
    const { data: profile, error: upsertErr } = await supabase
      .from("users")
      .upsert({
        id: user.id,
        phone: user.phone,
        role,
        name: name || null,
        phone_verified: true,
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
