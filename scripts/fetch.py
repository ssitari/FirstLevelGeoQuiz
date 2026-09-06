"""Download the Natural Earth source layers this project builds from.

Files land in scripts/cache/ (git-ignored). Re-run only when you want fresh
upstream data; build.py reads whatever is already cached.

Natural Earth is public domain (https://www.naturalearthdata.com/about/terms-of-use/).
"""

import os
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")

BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
FILES = [
    "ne_10m_admin_1_states_provinces_lakes.geojson",  # the silhouettes (lake-clipped)
    "ne_50m_admin_0_countries.geojson",               # country -> continent / subregion
    "ne_10m_populated_places_simple.geojson",         # largest-city hint
]


def main():
    os.makedirs(CACHE, exist_ok=True)
    for name in FILES:
        dest = os.path.join(CACHE, name)
        if os.path.exists(dest):
            print(f"  have  {name}")
            continue
        print(f"  get   {name} ...")
        urllib.request.urlretrieve(BASE + name, dest)
    print("done")


if __name__ == "__main__":
    main()
