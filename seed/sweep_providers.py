#!/usr/bin/env python3
"""
Find every service provider in and around Kochi, for WeAid's directory.

A marketplace with no providers is a website. WeAid's schema already plans for
this: `source='seed'` marks an imported listing, `claimed=false` says nobody has
taken it over yet, and `edit_token` is the private link they use when they do.
Nothing has ever been imported.

So this fills the directory first, and the concierge gets built on top of
something that can actually answer.

Method, borrowed from the Kerala gym sweep that found 2,981 businesses in an
afternoon: Google's Text Search caps at 60 results per query, so one search for
"plumber in Kochi" misses most of them. Instead, every service is searched
against every area of Kochi separately, which keeps each query well under the
cap and picks up the small operators who only show up locally.

Phone numbers need a second Details call each, which is the expensive part, so
they are only fetched for places we are keeping.

    GOOGLE_PLACES_KEY=... python3 sweep_providers.py            # dry run, counts only
    GOOGLE_PLACES_KEY=... python3 sweep_providers.py --go       # fetch phones too

Outputs, in this folder:
    providers-raw.json     everything found, with place_id
    providers.csv          deduped, with phones, ready to import
    sweep.log              what happened
"""
import csv
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
KEY = os.environ.get("GOOGLE_PLACES_KEY")
GO = "--go" in sys.argv
MAX_CALLS = int(os.environ.get("MAX_CALLS", "1200"))   # hard spend ceiling

# The classic Places API. The newer places.googleapis.com rejects this key:
# it is service-restricted, and finding that out cost an afternoon once already.
TEXT = "https://maps.googleapis.com/maps/api/place/textsearch/json"
DETAILS = "https://maps.googleapis.com/maps/api/place/details/json"

# Areas, not one big "Kochi".
#
# A single city-wide search returns the 60 best-ranked businesses, which are the
# big established ones. The one-man electrician in Thevara who answers his own
# phone never appears. Searching each area separately is how you find the people
# who would actually want the work.
AREAS = [
    "Fort Kochi", "Mattancherry", "Ernakulam North", "Ernakulam South",
    "Kakkanad", "Edappally", "Palarivattom", "Vyttila", "Kaloor",
    "Panampilly Nagar", "Thevara", "Thripunithura", "Aluva", "Angamaly",
    "Perumbavoor", "Muvattupuzha", "Kothamangalam", "Piravom",
    "North Paravur", "Kalamassery", "Thrikkakara", "Maradu", "Cheranallur",
    "Vypin", "Kumbalangi", "Chottanikkara", "Nedumbassery",
]

# Keyed to WeAid's own service slugs in pages/api/search.js, so an import maps
# straight onto services[] with no translation layer to drift out of date.
SERVICES = {
    "electrical":   ["electrician", "electrical contractor"],
    "plumbing":     ["plumber", "plumbing service"],
    "cleaning":     ["house cleaning service", "deep cleaning service"],
    "ac":           ["ac repair service", "washing machine repair", "refrigerator repair"],
    "carpentry":    ["carpenter", "furniture maker"],
    "renovation":   ["home renovation contractor", "interior contractor"],
    "painting":     ["house painter", "painting contractor"],
    "pest_control": ["pest control service"],
    "cctv":         ["cctv installation", "security system installer"],
    "movers":       ["packers and movers", "house shifting service"],
    "tutor":        ["home tutor", "tuition centre"],
    "nursing":      ["home nursing service", "elder care service", "physiotherapist home visit"],
    "laundry":      ["laundry service", "dry cleaner"],
    "caretaking":   ["property management service", "caretaker service"],
    "pickup":       ["airport taxi service", "car rental with driver"],
}

calls = 0
log_f = open(os.path.join(HERE, "sweep.log"), "a")


def log(msg):
    line = f"{time.strftime('%H:%M:%S')}  {msg}"
    print(line, flush=True)
    log_f.write(line + "\n")
    log_f.flush()


def get(url, params):
    """One API call, counted against the ceiling and retried once on a wobble."""
    global calls
    if calls >= MAX_CALLS:
        raise SystemExit(f"Stopping: hit the {MAX_CALLS} call ceiling.")
    calls += 1
    q = urllib.parse.urlencode({**params, "key": KEY})
    for attempt in (1, 2):
        try:
            with urllib.request.urlopen(f"{url}?{q}", timeout=25) as r:
                return json.load(r)
        except Exception as e:
            if attempt == 2:
                log(f"  ! {e}")
                return {}
            time.sleep(2)


def search(service, query, area):
    """Every page of one search. Google pages in 20s, up to 60."""
    out, token = [], None
    for page in range(3):
        params = {"query": f"{query} in {area}, Kochi, Kerala"}
        if token:
            params = {"pagetoken": token}
            time.sleep(2)   # Google rejects a page token used too quickly
        d = get(TEXT, params)
        results = d.get("results", [])
        for r in results:
            out.append({
                "place_id": r.get("place_id"),
                "name": r.get("name"),
                "address": r.get("formatted_address", ""),
                "rating": r.get("rating"),
                "reviews": r.get("user_ratings_total", 0),
                "lat": (r.get("geometry", {}).get("location", {}) or {}).get("lat"),
                "lng": (r.get("geometry", {}).get("location", {}) or {}).get("lng"),
                "service": service,
                "area": area,
            })
        token = d.get("next_page_token")
        if not token:
            break
    return out


def phone_for(place_id):
    d = get(DETAILS, {"place_id": place_id, "fields": "formatted_phone_number,website"})
    r = d.get("result", {}) or {}
    return r.get("formatted_phone_number", ""), r.get("website", "")


def ten(phone):
    """Last ten digits, which is how two listings of one business are spotted."""
    digits = re.sub(r"\D", "", phone or "")
    return digits[-10:] if len(digits) >= 10 else ""


def main():
    if not KEY:
        raise SystemExit("GOOGLE_PLACES_KEY is not set.")

    found = {}
    for service, queries in SERVICES.items():
        for area in AREAS:
            for query in queries:
                try:
                    hits = search(service, query, area)
                except SystemExit as e:
                    log(str(e))
                    hits = []
                    break
                for h in hits:
                    pid = h["place_id"]
                    if pid in found:
                        # One business can do two trades. Keep both, rather than
                        # pretending an electrician who also does AC is two people.
                        if h["service"] not in found[pid]["services"]:
                            found[pid]["services"].append(h["service"])
                        continue
                    h["services"] = [h.pop("service")]
                    found[pid] = h
            log(f"{service:<13} {area:<20} running total {len(found)}  (calls {calls})")

    with open(os.path.join(HERE, "providers-raw.json"), "w") as f:
        json.dump(list(found.values()), f, indent=1)
    log(f"\n{len(found)} distinct businesses, {calls} calls so far")

    if not GO:
        log("Dry run. Re-run with --go to fetch phone numbers.")
        return

    rows, seen_phones = [], set()
    for i, p in enumerate(found.values(), 1):
        phone, website = phone_for(p["place_id"])
        key = ten(phone)
        if not key or key in seen_phones:
            continue      # no phone is no use to us, and a duplicate is the same business
        seen_phones.add(key)
        rows.append({
            "name": p["name"],
            "phone": "+91" + key,
            "services": "|".join(p["services"]),
            "area": p["area"],
            "address": p["address"],
            "rating": p["rating"] or "",
            "reviews": p["reviews"],
            "lat": p["lat"] or "",
            "lng": p["lng"] or "",
            "website": website,
            "place_id": p["place_id"],
        })
        if i % 50 == 0:
            log(f"  phones: {len(rows)} kept of {i} checked  (calls {calls})")

    path = os.path.join(HERE, "providers.csv")
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    log(f"\n{len(rows)} providers with phone numbers -> {path}")
    log(f"{calls} API calls total")


if __name__ == "__main__":
    main()
