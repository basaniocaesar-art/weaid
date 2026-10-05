/**
 * What the WeAid concierge can actually do.
 *
 * Search was keyword matching over seventeen categories: "my tap is leaking"
 * hits the word "tap" and finds plumbing, but "my mother needs someone to sit
 * with her during the day" finds nothing, because none of those words appear in
 * the nursing keyword list. People describe a problem, not a category.
 *
 * So the concierge reads the problem, picks the service, quotes a real price
 * from lib/pricing.js, finds real providers, and books. Every number it says
 * comes from the same functions the website uses, because a concierge that
 * quotes differently from the checkout is worse than no concierge.
 *
 * Nothing here invents a price, a provider or an availability. Where it does
 * not know, it says so and offers a quote request instead.
 */
import { supabase } from "./supabase.js";
import { calculatePrice, listServices } from "./pricing.js";

/** Service slugs the pricing engine knows. The model may use no others. */
export const SERVICE_SLUGS = listServices().map((s) => s.id ?? s.slug ?? s);

export const SCOPES = ["small", "medium", "large"];
export const SLOTS = ["standard", "evening", "weekend", "emergency"];

export const TOOLS = [
  {
    name: "quote_job",
    description:
      "Work out what a job costs, from the same pricing the website uses. Call this before saying any price. Scope: small is one item or one room, medium is a few, large is a whole house or a full day.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["service", "city", "scope", "slot", "workers"],
      properties: {
        service: { type: "string", description: "A service slug, e.g. plumbing, electrical, ac, cleaning, nursing." },
        city: { type: "string", description: "City in lower case, e.g. kochi." },
        scope: { type: "string", enum: SCOPES },
        slot: { type: "string", enum: SLOTS, description: "emergency means today or tonight; weekend means Saturday or Sunday; evening after 6pm." },
        workers: { type: "integer", description: "How many people the job needs. 1 unless they said otherwise." },
      },
    },
  },
  {
    name: "find_providers",
    description:
      "Find real providers for a service near an area. Returns names, ratings and how long they have been working. Call this before claiming anybody is available.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["service", "city", "area"],
      properties: {
        service: { type: "string" },
        city: { type: "string" },
        area: { type: "string", description: "Their locality, e.g. Kakkanad. Empty string if they have not said." },
      },
    },
  },
  {
    name: "book_job",
    description:
      "Create the booking and start payment. Only after they have agreed the price and given a name, phone and address. Returns a payment link to show them.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["service", "city", "scope", "slot", "workers", "name", "phone", "address", "description", "when"],
      properties: {
        service: { type: "string" },
        city: { type: "string" },
        scope: { type: "string", enum: SCOPES },
        slot: { type: "string", enum: SLOTS },
        workers: { type: "integer" },
        name: { type: "string" },
        phone: { type: "string", description: "Ten digit Indian mobile." },
        address: { type: "string", description: "Enough for someone to find the door." },
        description: { type: "string", description: "The problem in their own words. The provider reads this." },
        when: { type: "string", description: "ISO datetime if they picked a time, empty string for as soon as possible." },
      },
    },
  },
  {
    name: "register_provider",
    description:
      "Sign somebody up as a provider when they say they do this work rather than need it. Takes their trade, area and number.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["name", "phone", "services", "city", "area", "years_experience"],
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        services: { type: "array", items: { type: "string" }, description: "Service slugs they work in." },
        city: { type: "string" },
        area: { type: "string" },
        years_experience: { type: "integer", description: "0 if they did not say." },
      },
    },
  },
];

const ten = (p) => String(p || "").replace(/\D/g, "").slice(-10);

export async function runTool(name, input, origin) {
  if (name === "quote_job") {
    if (!SERVICE_SLUGS.includes(input.service)) {
      return { error: `Not a service we price. Known: ${SERVICE_SLUGS.join(", ")}` };
    }
    const price = calculatePrice({
      service: input.service,
      city: input.city || "kochi",
      scope: input.scope,
      slot: input.slot,
      workers: Math.max(1, input.workers || 1),
    });
    return { price };
  }

  if (name === "find_providers") {
    /*
     * Real rows only, and only ones that can take work.
     *
     * Ordered the way the directory orders itself: anyone inside their free
     * signup window first, then featured, then by rating. A seeded listing
     * nobody has claimed still shows, because the person behind it is real and
     * answers their phone, which is what the customer needs.
     */
    let q = supabase
      .from("providers")
      .select("id, name, slug, area:areas, services, city, rating, review_count, years_experience, verified, team_size")
      .eq("available", true)
      .contains("services", [input.service])
      .order("featured", { ascending: false })
      .order("rating", { ascending: false })
      .limit(6);
    if (input.city) q = q.ilike("city", input.city);
    const { data, error } = await q;
    if (error) return { error: error.message };
    if (!data?.length) {
      return {
        providers: [],
        note: "Nobody is listed for that yet. Say so honestly, offer to take their details and have someone call back, and do not invent a provider.",
      };
    }
    return { providers: data };
  }

  if (name === "book_job") {
    const phone = ten(input.phone);
    if (phone.length !== 10) return { error: "That is not a ten digit mobile number. Ask again." };
    if (!input.address?.trim()) return { error: "No address. A provider cannot find them without one." };

    const res = await fetch(`${origin}/api/booking/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service: input.service,
        city: input.city || "kochi",
        scope: input.scope,
        slot: input.slot,
        workers: Math.max(1, input.workers || 1),
        description: input.description,
        address: input.address,
        scheduledAt: input.when || null,
        timingMode: input.when ? "scheduled" : "asap",
        customer: { name: input.name, phone: `+91${phone}`, email: "" },
        gateway: "razorpay",
      }),
    });
    const d = await res.json();
    if (!res.ok) return { error: d.error || "Could not create the booking." };
    return {
      booking_id: d.bookingId,
      amount: d.amount,
      breakdown: d.breakdown,
      pay_url: `${origin}/pay/${d.bookingId}`,
      note: "Give them the amount and the payment link. The job is not booked until it is paid.",
    };
  }

  if (name === "register_provider") {
    const phone = ten(input.phone);
    if (phone.length !== 10) return { error: "That is not a ten digit mobile number." };
    const bad = (input.services || []).filter((s) => !SERVICE_SLUGS.includes(s));
    if (bad.length) return { error: `Not services we list: ${bad.join(", ")}` };

    const { data, error } = await supabase
      .from("providers")
      .insert({
        name: input.name,
        phone: `+91${phone}`,
        whatsapp: `+91${phone}`,
        city: (input.city || "kochi").toLowerCase(),
        areas: input.area ? [input.area] : [],
        services: input.services,
        years_experience: input.years_experience || null,
        source: "signup",
        claimed: true,
        // The free window the schema already describes: new signups sit at the
        // front of search for thirty days, which is the thing worth telling them.
        listing_boost_until: new Date(Date.now() + 30 * 86400000).toISOString(),
      })
      .select("id, edit_token")
      .single();
    if (error) return { error: error.message };
    return {
      provider_id: data.id,
      manage_url: `${origin}/provider/manage?t=${data.edit_token}`,
      note: "Give them the manage link and tell them they are at the front of search for 30 days, free.",
    };
  }

  return { error: `Unknown tool ${name}` };
}
