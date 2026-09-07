"""Download the source layers this project builds from.

Files land in scripts/cache/ (git-ignored). Re-run only when you want fresh
upstream data; build.py reads whatever is already cached.

Sources:
  - Natural Earth 1:10m, public domain
    (https://www.naturalearthdata.com/about/terms-of-use/)
  - geoBoundaries (gbHumanitarian), CC BY 3.0 IGO, for countries whose Natural
    Earth admin-1 set is out of date. See docs/data-currency.md.
"""

import os
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")

NE_BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
NE_FILES = [
    "ne_10m_admin_1_states_provinces_lakes.geojson",  # the silhouettes (lake-clipped)
    "ne_50m_admin_0_countries.geojson",               # country -> continent / subregion
    "ne_10m_populated_places_simple.geojson",         # largest-city hint
]

# Pinned geoBoundaries release. gbHumanitarian ADM1, served from the LFS media host
# so we get the file itself and not an LFS pointer.
GB_RELEASE = "9469f09"
GB_ISOS = ["KEN", "NPL", "COD", "MAR"]


def gb_url(iso):
    return (f"https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/"
            f"{GB_RELEASE}/releaseData/gbHumanitarian/{iso}/ADM1/"
            f"geoBoundaries-{iso}-ADM1.geojson")


def get(url, dest, label):
    if os.path.exists(dest):
        print(f"  have  {label}")
        return
    print(f"  get   {label} ...")
    req = urllib.request.Request(url, headers={"User-Agent": "flgq-build"})
    with urllib.request.urlopen(req) as r, open(dest, "wb") as f:
        f.write(r.read())


def main():
    os.makedirs(CACHE, exist_ok=True)
    for name in NE_FILES:
        get(NE_BASE + name, os.path.join(CACHE, name), name)

    ov = os.path.join(CACHE, "overrides")
    os.makedirs(ov, exist_ok=True)
    for iso in GB_ISOS:
        get(gb_url(iso), os.path.join(ov, f"{iso}.geojson"),
            f"geoBoundaries {iso} ADM1")
    print("done")


if __name__ == "__main__":
    main()
