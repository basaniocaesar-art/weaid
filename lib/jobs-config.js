/** WeAid Jobs — browser-safe constants and helpers (server code lives in lib/jobportal.js). */
export const PLANS = {
  m1: { label: "1 month", price: 1499, days: 30, unlocks: 100, boosts: 3 },
  m3: { label: "3 months", price: 2999, days: 90, unlocks: 200, boosts: 9 },
  y1: { label: "1 year", price: 5999, days: 365, unlocks: 350, boosts: 36 },
};

export const ROLES = [
  "Driver", "Delivery boy", "Cook", "Housemaid", "Babysitter / nanny", "Home nurse", "Caregiver", "Security guard",
  "Office assistant", "Receptionist", "Sales executive", "Telecaller", "Shop staff", "Cashier", "Accountant",
  "Fitness trainer", "Beautician", "Hotel / restaurant staff", "Waiter", "Chef", "Kitchen helper", "Housekeeping",
  "Electrician", "Plumber", "AC technician", "Mechanic", "Welder", "Carpenter", "Painter", "Mason", "Helper / labour",
  "Teacher / tutor", "Data entry", "Field executive", "Warehouse / packing", "Tailor", "Other",
];

export const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

export function publicJob(j) {
  return { id: j.id, slug: j.slug, title: j.title, role: j.role, description: j.description, area: j.area, salaryMin: j.salary_min, salaryMax: j.salary_max,
    experience: j.experience, education: j.education, shift: j.shift, openings: j.openings, gender: j.gender, type: j.job_type,
    employer: j.jp_employers?.business_name || "", household: j.jp_employers?.kind === "household", posted: j.created_at, boosted: Boolean(j.boosted_until && Date.parse(j.boosted_until) > Date.now()) };
}

