import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars");
}

export const supabase = createClient(supabaseUrl, supabaseKey);

/* ── Helper queries ── */

export async function insertBooking(booking) {
  const { data, error } = await supabase
    .from("bookings")
    .insert(booking)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateBooking(id, updates) {
  const { data, error } = await supabase
    .from("bookings")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getBooking(id) {
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function getProvidersByService(service, city) {
  const { data, error } = await supabase
    .from("providers")
    .select("*")
    .contains("services", [service])
    .eq("city", city)
    .eq("available", true);
  if (error) throw error;
  return data;
}

export async function getPendingBookings() {
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .in("status", ["pending", "accepted"])
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function getCompletedPayouts(since) {
  const { data, error } = await supabase
    .from("bookings")
    .select("*, providers(*)")
    .eq("status", "completed")
    .eq("provider_paid", false)
    .gte("completed_at", since);
  if (error) throw error;
  return data;
}
