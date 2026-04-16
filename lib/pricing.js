/* ── WeAid Pricing Engine (server-side) ── */

const SERVICES = {
  // Home Services
  electrical:   { base: 499,   commission: 0.125 },
  plumbing:     { base: 399,   commission: 0.125 },
  cleaning:     { base: 1499,  commission: 0.15  },
  ac:           { base: 599,   commission: 0.125 },
  carpentry:    { base: 699,   commission: 0.125 },
  renovation:   { base: 5000,  commission: 0.08  },
  pickup:       { base: 799,   commission: 0.10  },
  caretaking:   { base: 999,   commission: 0.12  },

  // Beauty & Grooming
  haircut:      { base: 399,   commission: 0.15  },
  barber:       { base: 199,   commission: 0.15  },
  nails:        { base: 499,   commission: 0.15  },
  makeup:       { base: 999,   commission: 0.12  },
  facial:       { base: 699,   commission: 0.15  },
  waxing:       { base: 499,   commission: 0.15  },
  mehendi:      { base: 799,   commission: 0.10  },

  // Health & Wellness
  massage:      { base: 999,   commission: 0.12  },
  physio:       { base: 799,   commission: 0.10  },
  trainer:      { base: 599,   commission: 0.12  },
  yoga:         { base: 499,   commission: 0.10  },

  // Care Services
  eldercare:    { base: 899,   commission: 0.10  },
  babysit:      { base: 499,   commission: 0.12  },
  pet_grooming: { base: 599,   commission: 0.15  },
  pet_walking:  { base: 299,   commission: 0.15  },
};

const AREA_MULTIPLIERS = {
  mumbai:    1.50,
  delhi:     1.45,
  bangalore: 1.40,
  hyderabad: 1.35,
  chennai:   1.35,
  pune:      1.30,
  kochi:     1.15,
  ahmedabad: 1.15,
  jaipur:    1.10,
};
const DEFAULT_AREA_MULTIPLIER = 0.9;

const SCOPE_MULTIPLIERS = {
  small:  1.0,
  medium: 1.6,
  large:  2.8,
};

const SLOT_MULTIPLIERS = {
  standard:  1.0,
  evening:   1.15,
  weekend:   1.25,
  emergency: 1.50,
};

const PLATFORM_FEE = 49;

export function calculatePrice({ service, city, scope, slot }) {
  const svc = SERVICES[service];
  if (!svc) throw new Error(`Unknown service: ${service}`);

  const areaM  = AREA_MULTIPLIERS[city?.toLowerCase()] ?? DEFAULT_AREA_MULTIPLIER;
  const scopeM = SCOPE_MULTIPLIERS[scope]  ?? 1.0;
  const slotM  = SLOT_MULTIPLIERS[slot]    ?? 1.0;

  const subtotal   = Math.round(svc.base * areaM * scopeM * slotM);
  const total      = subtotal + PLATFORM_FEE;
  const commission = Math.round(subtotal * svc.commission);
  const providerEarnings = subtotal - commission;

  return {
    service,
    city,
    scope,
    slot,
    subtotal,
    platformFee: PLATFORM_FEE,
    total,
    commission,
    providerEarnings,
  };
}

export function listServices() {
  return Object.entries(SERVICES).map(([key, val]) => ({
    id: key,
    basePrice: val.base,
    commission: val.commission,
  }));
}

export { SERVICES, AREA_MULTIPLIERS, SCOPE_MULTIPLIERS, SLOT_MULTIPLIERS, PLATFORM_FEE };
