import { listServices, calculatePrice, AREA_MULTIPLIERS } from "../../../lib/pricing.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { city, scope, slot } = req.query;

    const services = listServices().map((svc) => {
      if (city) {
        const price = calculatePrice({
          service: svc.id,
          city,
          scope: scope || "small",
          slot: slot || "standard",
        });
        return { ...svc, price };
      }
      return svc;
    });

    return res.status(200).json({
      services,
      cities: Object.keys(AREA_MULTIPLIERS),
    });
  } catch (err) {
    console.error("[marketplace]", err);
    return res.status(500).json({ error: err.message });
  }
}
