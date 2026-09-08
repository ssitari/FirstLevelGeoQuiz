"""Turn the cached Natural Earth layers into the two files the web app loads:

    data/admin1.topojson  one geometry per first-level admin unit + properties:
                          cleaned names, country + continent, difficulty tier,
                          prominence, largest-city hint. TopoJSON so we can ship
                          real shape fidelity in a small file.
    data/manifest.json    country list with counts + tier totals, for the menus.

Pipeline:  enrich each feature with area / city / tier / names, keeping the
           FULL-resolution geometry (here)  ->  mapshaper simplify + de-sliver +
           TopoJSON encode (one pass)  ->  done.

The admin-1 source is the "_lakes" variant, whose unit boundaries follow lake
shorelines (Great Lakes, Caspian, Victoria…) instead of running straight through
open water — the plain variant makes e.g. Wisconsin's north edge unrecognizable.

Run:  python scripts/fetch.py  &&  python scripts/build.py
Needs Node on PATH (mapshaper is run via `npx --yes mapshaper`).
"""

import json
import math
import os
import re
import subprocess
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
DATA = os.path.join(HERE, "..", "data")

SRC_A1 = os.path.join(CACHE, "ne_10m_admin_1_states_provinces_lakes.geojson")
SRC_A0 = os.path.join(CACHE, "ne_50m_admin_0_countries.geojson")
SRC_PP = os.path.join(CACHE, "ne_10m_populated_places_simple.geojson")

# Countries where Natural Earth's admin-1 set is out of date. NE's own units for
# these `adm0_a3`s are dropped; geometry + names come from geoBoundaries
# (gbHumanitarian ADM1, CC BY 3.0 IGO) in scripts/cache/overrides/. Full
# provenance in docs/data-currency.md.
OVERRIDES = {
    "KEN": {"type": "County",   "note": "47 counties (2010 constitution)"},
    "COD": {"type": "Province", "note": "26 provinces (2015 découpage)"},
    "NPL": {"type": "Province", "note": "7 provinces (2015 constitution)",
            "rename": {
                "Province 1": ("Koshi", ["Province 1", "Province No. 1"]),
                "Province 2": ("Madhesh", ["Madhes", "Madhesh Pradesh", "Province 2"]),
            }},
    # State of Palestine promoted to its own country with its 16 governorates as
    # the first-level units, instead of Natural Earth's two Israeli-sovereign
    # "West Bank" / "Gaza Strip" polygons. Key is NE's adm0_a3 (PSX, which its
    # 50m admin-0 already labels "Palestine"); geoBoundaries ships the 16 as ADM2.
    "PSX": {"iso3": "PSE", "type": "Governorate",
            "note": "16 governorates (State of Palestine)",
            "rename": {
                "Ramallah": ("Ramallah and al-Bireh", ["Ramallah"]),
                "Khan Younis": ("Khan Yunis", ["Khan Younis"]),
                "Deir Al-Balah": ("Deir al-Balah", []),
                "Jericho": ("Jericho", ["Ariha"]),
                "Jerusalem": ("Jerusalem", ["Al-Quds"]),
                "Hebron": ("Hebron", ["Al-Khalil"]),
                "Bethlehem": ("Bethlehem", ["Bayt Lahm"]),
                "Tulkarm": ("Tulkarm", ["Tulkarem"]),
                "Qalqilya": ("Qalqilya", ["Qalqiliya"]),
            }},
    # geoBoundaries gives the 10 regions in undisputed territory; the two Western
    # Sahara regions are intentionally not attributed to Morocco (NE carries a
    # separate "Western Sahara" unit). Names de-diacriticked in the source, so
    # restore the usual forms and keep the plain ones as alternates.
    "MAR": {"type": "Region", "note": "regions of the 2015 reform, undisputed territory only",
            "rename": {
                "Tangier Tetouan Al Hoceima": ("Tanger-Tétouan-Al Hoceïma", ["Tangier-Tetouan-Al Hoceima", "Tangier-Tetouan"]),
                "Oriental": ("Oriental", []),
                "Fez Meknes": ("Fès-Meknès", ["Fez-Meknes"]),
                "Rabat Sale Kenitra": ("Rabat-Salé-Kénitra", ["Rabat-Sale-Kenitra"]),
                "Beni Mellal Khenifra": ("Béni Mellal-Khénifra", ["Beni Mellal-Khenifra"]),
                "Casablanca Settat": ("Casablanca-Settat", []),
                "Marrakech Safi": ("Marrakech-Safi", []),
                "Draa Tafilalet": ("Drâa-Tafilalet", ["Draa-Tafilalet"]),
                "Souss Massa": ("Souss-Massa", []),
                "Guelmim Oued Noun": ("Guelmim-Oued Noun", ["Guelmim-Oued-Noun"]),
            }},
}

# Countries where Natural Earth ships a level *below* the country's real first
# level — NE's UK is 232 districts and boroughs, its Italy is 110 provinces. Each
# is dissolved on one of NE's own grouping fields, so no outside data and no
# hand-keyed names: the field value becomes the unit name verbatim.
#
# Judgement calls, flagged as such in docs/data-currency.md: LVA and MLT roll up
# to historical/statistical regions rather than an administrative level (neither
# country has a meaningful admin-1), and PHL rolls up to the 17 administrative
# regions because NE's provinces-plus-cities set is internally inconsistent.
ROLLUPS = {
    "GBR": {"field": "geonunit", "type": "Country",
            "note": "England / Scotland / Wales / Northern Ireland"},
    "FRA": {"field": "region", "type": "Region",
            "note": "18 régions; NE models the 101 departments"},
    "ITA": {"field": "region", "type": "Region",
            "note": "20 regions; NE models the 110 provinces"},
    "PHL": {"field": "region", "type": "Region",
            "note": "17 administrative regions; NE mixes provinces with cities"},
    "SVN": {"field": "region", "type": "Statistical Region",
            "note": "12 statistical regions; NE models 181 municipalities"},
    "LVA": {"field": "region", "type": "Region",
            "note": "5 historical regions; NE models 119 municipalities"},
    "MLT": {"field": "region", "type": "Region",
            "note": "3 regions; NE models 68 local councils"},
    "UGA": {"field": "region", "type": "Region",
            "note": "4 regions; NE models 112 districts/counties"},
}

# Units the quiz will not ask, because the hint ladder would have to state a
# sovereignty the project is not willing to assert. This is the conservative
# default written down in docs/data-currency.md §2: where a unit cannot be
# attributed cleanly under the UN/ISO view, drop it rather than pick a side.
# They stay in the data — the reveal map still draws them as neighbours — they
# are just never the answer. Keyed (adm0_a3, NE name); the build fails if one
# stops matching, so a Natural Earth rename can't silently re-enable it.
EXCLUDE_UNITS = {
    ("RUS", "Crimea"),              # NE attributes to Russia; UN/ISO: Ukraine
    ("RUS", "Sevastopol"),          # ditto
    ("IND", "Jammu and Kashmir"),   # no clean UN/ISO attribution
    ("IND", "Ladakh"),              # ditto
    ("PAK", "Azad Kashmir"),        # ditto
    ("PAK", "Northern Areas"),      # Gilgit-Baltistan, ditto
}

# Simplify to a per-feature distance threshold ≈ SIMPLIFY_K × (linear size of the
# unit): sqrt(area_km²) × K metres. A percentage retention instead would gut a
# small province (28% of few points) while a huge one keeps thousands it will
# never show — this gives every silhouette the same on-screen fidelity.
SIMPLIFY_K = 6
QUANTIZATION = "1e6"     # TopoJSON coord grid (~40 m); no visible stair-stepping


# ---------------------------------------------------------------- helpers

def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def norm(s):
    """Loose key for name matching: lowercase, no accents, no punctuation."""
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"\b(saint|sankt|santa|santo)\b", "st", s.lower())
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return s.strip()


def haversine(lon1, lat1, lon2, lat2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def ring_area_km2(ring):
    """Signed area of a lon/lat ring via an equirectangular approximation."""
    if len(ring) < 3:
        return 0.0
    lat0 = sum(p[1] for p in ring) / len(ring)
    k = math.cos(math.radians(lat0))
    deg_km = 111.32
    s = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        s += (x1 * k * deg_km) * (y2 * deg_km) - (x2 * k * deg_km) * (y1 * deg_km)
    return s / 2.0


def geom_polygons(geom):
    """Normalise Polygon / MultiPolygon to a list of polygons (each a list of
    rings: exterior first, then holes). Holes matter for a few silhouettes --
    Berlin inside Brandenburg, Lesotho inside South Africa."""
    if not geom:
        return []
    t, c = geom["type"], geom["coordinates"]
    if t == "Polygon":
        return [c]
    if t == "MultiPolygon":
        return list(c)
    return []


def _xy_km(p, lat0):
    k = math.cos(math.radians(lat0))
    return (p[0] * k * 111.32, p[1] * 110.57)


def ring_perimeter_km(ring, lat0):
    return sum(math.dist(_xy_km(ring[i], lat0), _xy_km(ring[i + 1], lat0))
               for i in range(len(ring) - 1))


def convex_hull(points):
    pts = sorted(set(map(tuple, points)))
    if len(pts) < 3:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def straight_fraction(ring, lat0, run_min):
    """Share of a ring's perimeter that sits in long, near-straight runs — the
    signature of a surveyed / colonial border that tells you nothing.

    `run_min` (km) is where a straight run stops being a bend and starts being a
    ruled line. It scales with the unit: a fixed threshold meant a small district
    could never register a "long" straight edge, which quietly told the score
    that every small unit was interesting."""
    if len(ring) < 4:
        return 1.0
    pk = [_xy_km(p, lat0) for p in ring]
    total = 0.0
    straight = 0.0
    run = 0.0
    for i in range(1, len(pk) - 1):
        a, b, c = pk[i - 1], pk[i], pk[i + 1]
        seg = math.dist(a, b)
        total += seg
        v1 = (b[0] - a[0], b[1] - a[1])
        v2 = (c[0] - b[0], c[1] - b[1])
        n1 = math.hypot(*v1) or 1e-9
        n2 = math.hypot(*v2) or 1e-9
        cosang = max(-1.0, min(1.0, (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)))
        turn = math.degrees(math.acos(cosang))
        if turn < 10:
            run += seg
        else:
            if run > run_min:
                straight += run
            run = 0.0
    if run > run_min:
        straight += run
    return straight / total if total else 1.0


def distinctiveness_raw(polys, area):
    """How much identifying information the outline carries, as a raw score.

    Two things matter about how this is measured. It runs on the *simplified*
    geometry the player is actually shown, not the full-resolution source — the
    old version scored source vertex density, which is why 2,000 km² capital
    districts (Moskva, Tokyo, Hovedstaden) came out at 1.00. And every term is
    either a ratio or expressed relative to the unit's own linear size, so units
    three orders of magnitude apart in area are judged on the same footing.

    The absolute value means nothing on its own; percentile_ranks() turns the
    population into the 0..1 the draw weight in config.js assumes."""
    if not polys or area <= 0:
        return 0.0
    exteriors = [poly[0] for poly in polys]
    exteriors.sort(key=lambda r: abs(ring_area_km2(r)), reverse=True)
    main = exteriors[0]
    lat0 = sum(p[1] for p in main) / len(main)

    size_km = math.sqrt(area)                          # the unit's own linear scale
    interval_km = max(0.15, size_km * SIMPLIFY_K / 1000.0)   # what simplify left it

    verts = sum(len(r) for r in exteriors)
    perim = sum(ring_perimeter_km(r, lat0) for r in exteriors) or 1.0
    # vertices per simplification interval of edge: ~1 means the outline resisted
    # simplification the whole way round (a crinkly coast), low means long smooth
    # or ruled runs. Scale-free, unlike vertices per 100 km.
    detail_score = min(1.0, verts * interval_km / perim)

    straight = straight_fraction(main, lat0, max(2.0, 0.12 * size_km))

    hull = convex_hull([p for r in exteriors for p in r])
    hull_area = abs(ring_area_km2(list(hull) + [hull[0]])) if len(hull) >= 3 else area
    concavity = max(0.0, 1.0 - area / hull_area) if hull_area else 0.0

    big = [r for r in exteriors if abs(ring_area_km2(r)) >= 0.02 * area]
    part_bonus = min(len(big) - 1, 3) / 3.0

    return (0.42 * detail_score
            + 0.30 * (1.0 - straight)
            + 0.20 * min(1.0, concavity * 2.5)
            + 0.08 * part_bonus)


def percentile_ranks(values):
    """Raw scores -> their rank in the population, 0..1, ties sharing a rank.

    The raw score clusters: the old fixed (d - 0.35) / 0.55 stretch left the
    shipped `distinct` with a median of 0.85 and 18% of units pinned above 0.95,
    so DISTINCT_WEIGHT_EXP was being applied to what was very nearly a constant
    and the draw weighting did almost nothing. Ranking makes the spread uniform
    by construction, which is the distribution config.js is written against."""
    n = len(values)
    if n < 2:
        return [0.5] * n
    order = sorted(range(n), key=lambda i: values[i])
    out = [0.0] * n
    i = 0
    while i < n:
        j = i
        while j + 1 < n and values[order[j + 1]] == values[order[i]]:
            j += 1
        r = (i + j) / 2.0 / (n - 1)
        for k in range(i, j + 1):
            out[order[k]] = round(r, 3)
        i = j + 1
    return out


def bbox_of(polys):
    xs = [x for poly in polys for x, _ in poly[0]]
    ys = [y for poly in polys for _, y in poly[0]]
    return (min(xs), min(ys), max(xs), max(ys))


# ---------------------------------------------------------------- load context

def country_lookup():
    d = load(SRC_A0)
    out = {}
    for f in d["features"]:
        p = f["properties"]
        out[p["ADM0_A3"]] = {
            "name": p.get("ADMIN"),
            "iso2": p.get("ISO_A2") if p.get("ISO_A2") not in ("-99", None) else None,
            "cont": p.get("CONTINENT"),
            "subr": p.get("SUBREGION"),
        }
    return out


def places_by_country():
    d = load(SRC_PP)
    by = defaultdict(list)
    for f in d["features"]:
        p = f["properties"]
        fc = p.get("featurecla") or ""
        by[p.get("adm0_a3")].append({
            "name": p.get("name"),
            "adm1": p.get("adm1name"),
            "pop": p.get("pop_max") or 0,
            "cap": p.get("adm0cap") == 1,
            "adm1cap": fc.startswith("Admin-1"),
            "lon": p.get("longitude"),
            "lat": p.get("latitude"),
        })
    return by


def has_capital(name, a3, places):
    key = norm(name)
    for c in places.get(a3, []):
        if c["cap"] and key and norm(c["adm1"]) == key:
            return True
    return False


def point_in_rings(x, y, rings):
    """Ray casting against a polygon's rings (exterior + holes)."""
    inside = False
    for ring in rings:
        n = len(ring)
        j = n - 1
        for i in range(n):
            xi, yi = ring[i]
            xj, yj = ring[j]
            if (yi > y) != (yj > y):
                if x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                    inside = not inside
            j = i
    return inside


def pick_city(name, a3, lon, lat, polys, bbox, places):
    pool = places.get(a3, [])
    if not pool:
        return None
    x0, y0, x1, y1 = bbox
    key = norm(name)

    inside = []
    for c in pool:
        cx, cy = c["lon"], c["lat"]
        if cx is None:
            continue
        hit = (x0 <= cx <= x1 and y0 <= cy <= y1
               and any(point_in_rings(cx, cy, poly) for poly in polys))
        if not hit and key and norm(c["adm1"]) == key:
            hit = True                       # trust the adm1name tag too
        if hit:
            inside.append(c)
    if inside:
        # prefer a real largest city; an admin-1 capital breaks ties upward
        best = max(inside, key=lambda c: (c["pop"], c["adm1cap"]))
        return {"name": best["name"], "pop": best["pop"], "in_unit": True}

    near = min(pool, key=lambda c: haversine(lon, lat, c["lon"], c["lat"]))
    return {"name": near["name"], "pop": near["pop"], "in_unit": False}


# ---------------------------------------------------------------- prominence

# "Would a reasonably worldly person recognize this unit?" Natural Earth's
# labelrank turns out to just encode the country, not unit fame, so we don't use
# it. The real signals we have are: how big the unit is, how big its largest
# city is, whether it holds the national capital, and whether it's in a country
# whose subdivisions get talked about internationally.

_KNOWN_COUNTRIES = {
    "USA", "CAN", "AUS", "GBR", "DEU", "FRA", "ITA", "ESP", "PRT", "NLD", "BEL",
    "CHE", "AUT", "IRL", "SWE", "NOR", "DNK", "FIN", "POL", "GRC", "CZE", "HUN",
    "RUS", "UKR", "CHN", "IND", "JPN", "KOR", "IDN", "THA", "VNM", "PHL", "MYS",
    "BRA", "ARG", "MEX", "CHL", "COL", "PER", "VEN",
    "ZAF", "EGY", "MAR", "NGA", "KEN", "ETH", "TUR", "SAU", "ARE", "ISR", "IRN",
    "IRQ", "PAK", "BGD", "NZL",
}


def prominence(area, city, is_capital, a3):
    pop = (city or {}).get("pop") or 0
    if city and not city.get("in_unit"):
        pop *= 0.4                                    # nearest-city guess, discount it
    pop_score = max(0.0, math.log10(max(pop, 3000)) - 3.0)   # 30k->0.5, 300k->1.5, 3M->2.5
    area_score = min(2.2, math.sqrt(max(area, 0)) / 500.0)   # 250k km²->1.0, 1M->2.0
    prom = 0.5 + 1.5 * pop_score + 1.1 * area_score
    if is_capital:
        # Holding the national capital does make a unit talked about. But a
        # capital *district* is a city with a border drawn round it, and a flat
        # +5.5 on a scale whose 99th percentile was 11.1 put those districts at
        # the top of the distribution outright — the Daily was drawing five of
        # them at a time. Ramp the bonus in with size so it rewards "the province
        # containing the capital" rather than "the city".
        prom += 2.0 * min(1.0, math.sqrt(area / 50000.0))
    if a3 in _KNOWN_COUNTRIES:
        prom *= 1.35
    if area < 2000:      # Maltese councils, London boroughs, Andorran parishes…
        prom *= math.sqrt(max(area, 20) / 2000.0)
    return round(prom, 3)


def tier_for(prom):
    if prom >= 7.0:      # ~ the top 12%: US/Indian/Chinese states, capitals, big regions
        return "easy"
    if prom >= 4.7:      # ~ the next 28%
        return "medium"
    return "hard"


# ---------------------------------------------------------------- assembling units

def ne_alt_names(p, name):
    alt = set()
    for v in (p.get("name_alt"), p.get("name_en"), p.get("gn_name"),
              p.get("woe_name"), p.get("postal"), p.get("abbrev")):
        if not v:
            continue
        for piece in str(v).split("|"):
            piece = piece.strip()
            if piece and norm(piece) != norm(name):
                alt.add(piece)
    return sorted(alt)


def load_overrides():
    """geoBoundaries replacements, as raw units in the same shape build() consumes
    from Natural Earth. Returns {a3: [unit, ...]}."""
    out = {}
    for a3, spec in OVERRIDES.items():
        iso3 = spec.get("iso3", a3)
        path = os.path.join(CACHE, "overrides", f"{iso3}.geojson")
        if not os.path.exists(path):
            sys.exit(f"missing override {path} -- run scripts/fetch.py first")
        rename = spec.get("rename", {})
        units = []
        for f in load(path)["features"]:
            nm = (f["properties"].get("shapeName") or "").strip()
            if not nm or not f.get("geometry"):
                continue
            alt = []
            if nm in rename:
                nm, alt = rename[nm][0], list(rename[nm][1])
            units.append({
                "id": f"{a3}-o{len(units):02d}", "name": nm, "a3": a3,
                "alt": alt, "type": spec["type"], "country": None,
                "lon": None, "lat": None, "geometry": f["geometry"],
            })
        out[a3] = units
    return out


def load_rollups(ne_features):
    """NE's own units for a ROLLUPS country, dissolved up a level by one of NE's
    grouping fields. Returns {a3: [unit, ...]} in the shape build() consumes."""
    out = {}
    rdir = os.path.join(CACHE, "rollups")
    os.makedirs(rdir, exist_ok=True)
    for a3, spec in ROLLUPS.items():
        field = spec["field"]
        subset = [f for f in ne_features if f["properties"].get("adm0_a3") == a3]
        if not subset:
            sys.exit(f"rollup {a3}: no Natural Earth units matched")
        missing = [f for f in subset if not f["properties"].get(field)]
        if missing:
            sys.exit(f"rollup {a3}: {len(missing)} units have no '{field}' value")
        src = os.path.join(rdir, f"{a3}_src.geojson")
        dst = os.path.join(rdir, f"{a3}.geojson")
        with open(src, "w", encoding="utf-8") as fh:
            json.dump({"type": "FeatureCollection", "features": subset}, fh)
        mapshaper(src, dst, "-dissolve", field)

        admin = subset[0]["properties"].get("admin")
        units = []
        for f in load(dst)["features"]:
            nm = (f["properties"].get(field) or "").strip()
            if not nm or not f.get("geometry"):
                continue
            units.append({
                "id": f"{a3}-r{len(units):02d}", "name": nm, "a3": a3,
                "alt": [], "type": spec["type"], "country": admin,
                "lon": None, "lat": None, "geometry": f["geometry"],
            })
        out[a3] = units
    return out


def enrich_one(u, countries, places):
    """u: {id, name, a3, alt[], type, country|None, lon|None, lat|None, geometry}"""
    a3 = u["a3"]
    name = u["name"]
    ctx = countries.get(a3, {})
    polys = geom_polygons(u["geometry"])
    if not polys:
        return None
    area = abs(sum(ring_area_km2(poly[0]) for poly in polys))
    bbox = bbox_of(polys)
    lon, lat = u.get("lon"), u.get("lat")
    if lon is None or lat is None:
        lon = (bbox[0] + bbox[2]) / 2
        lat = (bbox[1] + bbox[3]) / 2

    city = pick_city(name, a3, lon, lat, polys, bbox, places)
    prom = prominence(area, city, has_capital(name, a3, places), a3)
    alt = sorted({x.strip() for x in u["alt"] if x and norm(x) != norm(name)})
    return {
        "id": u["id"],
        "name": name,
        "alt": "|".join(alt),
        "country": u.get("country") or ctx.get("name") or a3,
        "a3": a3,
        "iso2": ctx.get("iso2"),
        "cont": ctx.get("cont") or "—",
        "subr": ctx.get("subr") or "—",
        "type": u["type"],
        "prom": prom,
        # "distinct" is added after simplification — see main()
        "tier": tier_for(prom),
        "lon": round(lon, 3),
        "lat": round(lat, 3),
        "area": round(area),
        "cityName": city["name"] if city else "",
        "cityPop": city["pop"] if city else 0,
        "cityIn": bool(city and city["in_unit"]),
    }


# ---------------------------------------------------------------- mapshaper

def mapshaper(src, dst, *ops):
    fmt = "topojson" if dst.endswith(".topojson") else "geojson"
    out = ["-o", dst, f"format={fmt}"]
    if fmt == "topojson":
        out += [f"quantization={QUANTIZATION}", "id-field=id"]
    cmd = ["npx", "--yes", "mapshaper", src, *ops, *out]
    print("  mapshaper:", " ".join(cmd[3:]))
    subprocess.run(cmd, check=True, shell=(os.name == "nt"))


def build_land():
    """A dissolved, heavily simplified world coastline for the reveal's globe
    inset — tens of KB, out of the same NE 50m admin-0 layer already cached."""
    out_path = os.path.join(DATA, "land.topojson")
    mapshaper(
        SRC_A0, out_path,
        "-dissolve",
        "-simplify", "4%", "keep-shapes",
        "-filter-islands", "min-area=3000km2", "remove-empty",
    )
    return out_path


# ---------------------------------------------------------------- main

def main():
    for p in (SRC_A1, SRC_A0, SRC_PP):
        if not os.path.exists(p):
            sys.exit(f"missing {p} -- run scripts/fetch.py first")

    countries = country_lookup()
    places = places_by_country()
    overrides = load_overrides()
    ne_features = load(SRC_A1)["features"]
    rollups = load_rollups(ne_features)

    # ---- gather every unit: Natural Earth (minus the overridden countries) plus
    #      the geoBoundaries replacements, all in one shape.
    units = []
    for f in ne_features:
        p = f["properties"]
        a3 = p.get("adm0_a3")
        if a3 in overrides or a3 in rollups:
            continue
        name = (p.get("name") or "").strip()
        if not name or not f.get("geometry"):
            continue
        units.append({
            "id": p.get("adm1_code") or f"{a3}-{name}",
            "name": name, "a3": a3, "alt": ne_alt_names(p, name),
            "type": p.get("type_en") or p.get("type") or "region",
            "country": p.get("admin"),
            "lon": p.get("longitude"), "lat": p.get("latitude"),
            "geometry": f["geometry"],
        })
    for repl in overrides.values():
        units.extend(repl)
    for repl in rollups.values():
        units.extend(repl)

    # ---- enrich: area / city / prominence / distinctiveness / tier, full-res
    #      geometry kept for mapshaper.
    enriched = {"type": "FeatureCollection", "features": []}
    manifest_rows = []
    for u in units:
        props = enrich_one(u, countries, places)
        if props is None:
            continue
        enriched["features"].append(
            {"type": "Feature", "properties": props, "geometry": u["geometry"]})
        manifest_rows.append(props)

    enr_path = os.path.join(CACHE, "_enriched.geojson")
    with open(enr_path, "w", encoding="utf-8") as f:
        json.dump(enriched, f)

    os.makedirs(DATA, exist_ok=True)
    out_path = os.path.join(DATA, "admin1.topojson")
    simp_path = os.path.join(CACHE, "_simplified.geojson")

    # ---- pass 1: simplify, drop slivers / tiny islands. Out as GeoJSON so the
    #      shape score can be taken from the geometry the player is really shown.
    mapshaper(
        enr_path, simp_path,
        "-simplify", "variable",
        f"interval=Math.max(150,Math.sqrt(area)*{SIMPLIFY_K})", "keep-shapes",
        "-filter-islands", "min-vertices=6", "remove-empty",
        "-clean",
    )

    # ---- shape distinctiveness, on the simplified outlines, percentile-ranked
    simp = load(simp_path)
    raws = [distinctiveness_raw(geom_polygons(f["geometry"]),
                                f["properties"].get("area") or 0)
            for f in simp["features"]]
    for f, d in zip(simp["features"], percentile_ranks(raws)):
        f["properties"]["distinct"] = d

    # ---- playable: may this unit be the answer to a question?
    # Two reasons it may not. A country with a single admin-1 unit isn't
    # subdivided at all — the "unit" is the country outline, which is a different
    # game — and that set is where the non-subdivisions live (Antarctica, Baykonur,
    # Clipperton, the sovereign base areas) along with the entities whose status is
    # contested (Somaliland, Northern Cyprus, Western Sahara, Siachen Glacier).
    # The other reason is an explicit EXCLUDE_UNITS entry. Unplayable units stay in
    # the data and are still drawn on the reveal map as neighbours.
    per_country = Counter(f["properties"]["a3"] for f in simp["features"])
    hit = Counter()
    for f in simp["features"]:
        pr = f["properties"]
        key = (pr["a3"], pr["name"])
        if key in EXCLUDE_UNITS:
            hit[key] += 1
        pr["playable"] = bool(per_country[pr["a3"]] >= 2 and key not in EXCLUDE_UNITS)
    stale = [k for k in EXCLUDE_UNITS if not hit[k]]
    if stale:
        sys.exit("EXCLUDE_UNITS no longer matches Natural Earth: "
                 + ", ".join(f"{a}/{n}" for a, n in sorted(stale)))

    with open(simp_path, "w", encoding="utf-8") as f:
        json.dump(simp, f)

    # ---- pass 2: TopoJSON encode (shared arcs + quantization), no resimplify
    mapshaper(simp_path, out_path)

    # ---- globe inset coastline
    land_path = build_land()

    # The manifest has to describe what actually shipped: mapshaper's
    # filter-islands / remove-empty drop units, and counting before that left two
    # countries (Ashmore and Cartier, Coral Sea Islands) advertised in the Novice
    # picker with a unit each and none in the data — an instantly-empty round.
    manifest_rows = [f["properties"] for f in simp["features"]]

    # ---- manifest for the menus
    by_country = defaultdict(lambda: {"n": 0, "np": 0})
    tier_counts = Counter()
    for r in manifest_rows:
        c = by_country[r["a3"]]
        c["n"] += 1
        c["np"] += 1 if r.get("playable") else 0     # what Novice can actually ask
        c["name"] = r["country"]
        c["cont"] = r["cont"]
        c["type"] = r["type"]
        tier_counts[r["tier"]] += 1
    manifest = {
        "generated": date.today().isoformat(),
        "source": "Natural Earth 1:10m Admin 1 (lakes variant), public domain; "
                  + ", ".join(sorted(s.get("iso3", a3) for a3, s in OVERRIDES.items()))
                  + " from geoBoundaries (CC BY 3.0 IGO)",
        "total": len(manifest_rows),
        "playable": sum(1 for r in manifest_rows if r.get("playable")),
        "tiers": dict(tier_counts),
        "countries": sorted(
            ({"a3": a3, **v} for a3, v in by_country.items()),
            key=lambda c: (-c["n"], c["name"]),
        ),
    }
    with open(os.path.join(DATA, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, separators=(",", ":"), ensure_ascii=False)

    land_kb = os.path.getsize(land_path) / 1024
    kb = os.path.getsize(out_path) / 1024
    for a3 in sorted(OVERRIDES):
        n = sum(1 for r in manifest_rows if r["a3"] == a3)
        print(f"  override {a3}: {n} units ({OVERRIDES[a3]['note']})")
    for a3 in sorted(ROLLUPS):
        n = sum(1 for r in manifest_rows if r["a3"] == a3)
        print(f"  rollup   {a3}: {n} units ({ROLLUPS[a3]['note']})")
    n_play = sum(1 for r in manifest_rows if r.get("playable"))
    print(f"\n  {len(manifest_rows)} units  |  {len(by_country)} countries  |  "
          f"tiers {dict(tier_counts)}")
    print(f"  {n_play} playable  |  {len(manifest_rows) - n_play} held out "
          f"(single-unit countries + {len(EXCLUDE_UNITS)} contested)")
    print(f"  data/admin1.topojson  {kb:,.0f} KB  (~{kb / 3:,.0f} KB gzipped)")
    print(f"  data/land.topojson    {land_kb:,.0f} KB")


if __name__ == "__main__":
    main()
