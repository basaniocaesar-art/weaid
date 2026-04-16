import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
      return res.status(401).json({ error: "No token provided" });
    }

    // Verify the JWT with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    // Get user profile from users table
    const { data: profile } = await supabase
      .from("users")
      .select("*")
      .eq("id", user.id)
      .single();

    return res.status(200).json({
      id: user.id,
      phone: user.phone,
      email: user.email,
      role: profile?.role || null,
      name: profile?.name || null,
      createdAt: user.created_at,
      isNewUser: !profile?.role,
    });
  } catch (err) {
    console.error("[auth/me]", err);
    return res.status(500).json({ error: err.message });
  }
}
