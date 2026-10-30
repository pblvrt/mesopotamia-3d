#!/usr/bin/env python3
"""Build terrain assets for the Mesopotamia 3D map.

Downloads AWS Open Data Terrain Tiles (Terrarium PNG), mosaics them, reprojects
Web Mercator -> equirectangular over the contract bbox, and writes:

  public/terrain/height.png     Terrarium RGB, full resolution
  public/terrain/height-lo.png  Terrarium RGB, 1/4 resolution
  public/terrain/relief.jpg     colour relief x hillshade texture
  public/terrain/terrain.json   metadata (see CONTRACT.md)

Pixel registration: "area" - pixel (col,row) covers the cell whose centre is at
lon = west + (col+0.5)*(east-west)/W, lat = north - (row+0.5)*(north-south)/H,
so the image edges coincide exactly with the bbox edges (same as GL texture UVs).

Usage:  python3 scripts/build-terrain.py [--zoom 8] [--width 2048]
Needs:  numpy, Pillow.  Tiles are cached in .cache/terrarium/.
If direct download fails, it retries via $PROXY_URL from
~/.config/proxy/residential.env (never printed).
"""
import argparse
import json
import math
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache", "terrarium")
OUT = os.path.join(ROOT, "public", "terrain")
URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"

WEST, EAST, SOUTH, NORTH = 37.5, 50.5, 28.5, 38.5
LAT0 = 33.0
SOURCE = "Terrain Tiles: Mapzen/AWS Open Data, includes SRTM, GMTED, ETOPO1"

# ---------------------------------------------------------------- download

_proxy_opener = None


def proxy_opener():
    global _proxy_opener
    if _proxy_opener is None:
        url = os.environ.get("PROXY_URL")
        envf = os.path.expanduser("~/.config/proxy/residential.env")
        if not url and os.path.exists(envf):
            for line in open(envf):
                line = line.strip()
                if line.startswith("export "):
                    line = line[7:]
                if line.startswith("PROXY_URL="):
                    url = line.split("=", 1)[1].strip().strip('"').strip("'")
        if not url:
            raise RuntimeError("no PROXY_URL available")
        _proxy_opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({"http": url, "https": url}))
    return _proxy_opener


def fetch(z, x, y):
    path = os.path.join(CACHE, str(z), str(x), f"{y}.png")
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    url = URL.format(z=z, x=x, y=y)
    req = urllib.request.Request(url, headers={"User-Agent": "mesopotamia-3d terrain build"})
    last = None
    for attempt in range(6):
        use_proxy = attempt >= 2
        try:
            opener = proxy_opener() if use_proxy else urllib.request.build_opener()
            with opener.open(req, timeout=60) as r:
                data = r.read()
            Image.open(BytesIO(data)).verify()
            tmp = path + ".tmp"
            with open(tmp, "wb") as f:
                f.write(data)
            os.replace(tmp, path)
            return path
        except Exception as e:  # noqa: BLE001
            last = type(e).__name__  # don't echo messages (could contain proxy URL)
            time.sleep(1 + attempt)
    raise RuntimeError(f"failed to fetch tile {z}/{x}/{y}: {last}")


def decode(path):
    a = np.asarray(Image.open(path).convert("RGB"), dtype=np.float64)
    return a[..., 0] * 256.0 + a[..., 1] + a[..., 2] / 256.0 - 32768.0


# ---------------------------------------------------------------- projection

def merc_px(lon, lat, z):
    n = 256.0 * (2 ** z)
    x = (lon + 180.0) / 360.0 * n
    lr = np.radians(lat)
    y = (1.0 - np.log(np.tan(lr) + 1.0 / np.cos(lr)) / math.pi) / 2.0 * n
    return x, y


def bilinear(img, x, y):
    h, w = img.shape
    x = np.clip(x, 0, w - 1.000001)
    y = np.clip(y, 0, h - 1.000001)
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    fx, fy = x - x0, y - y0
    a = img[y0, x0]
    b = img[y0, x0 + 1]
    c = img[y0 + 1, x0]
    d = img[y0 + 1, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def build_grid(z, W, H):
    # tile range (with 1-tile margin for bilinear at edges)
    x0p, y0p = merc_px(WEST, NORTH, z)
    x1p, y1p = merc_px(EAST, SOUTH, z)
    tx0, tx1 = int(x0p // 256) - 0, int(x1p // 256)
    ty0, ty1 = int(y0p // 256) - 0, int(y1p // 256)
    tiles = [(tx, ty) for ty in range(ty0, ty1 + 1) for tx in range(tx0, tx1 + 1)]
    print(f"zoom {z}: tiles x {tx0}..{tx1}, y {ty0}..{ty1} ({len(tiles)} tiles)")
    with ThreadPoolExecutor(8) as ex:
        paths = list(ex.map(lambda t: fetch(z, t[0], t[1]), tiles))
    nx, ny = tx1 - tx0 + 1, ty1 - ty0 + 1
    mosaic = np.zeros((ny * 256, nx * 256), dtype=np.float64)
    for (tx, ty), p in zip(tiles, paths):
        mosaic[(ty - ty0) * 256:(ty - ty0 + 1) * 256,
               (tx - tx0) * 256:(tx - tx0 + 1) * 256] = decode(p)

    lons = WEST + (np.arange(W) + 0.5) * (EAST - WEST) / W
    lats = NORTH - (np.arange(H) + 0.5) * (NORTH - SOUTH) / H
    LON, LAT = np.meshgrid(lons, lats)
    mx, my = merc_px(LON, LAT, z)
    # mercator pixel -> mosaic pixel (pixel centres at +0.5)
    return bilinear(mosaic, mx - tx0 * 256 - 0.5, my - ty0 * 256 - 0.5)


# ---------------------------------------------------------------- encoding

def encode_terrarium(elev, step=0.0):
    e = elev.copy()
    if step > 0:
        e = np.round(e / step) * step
    v = e + 32768.0
    r = np.floor(v / 256.0)
    g = np.floor(v - r * 256.0)
    b = np.round((v - r * 256.0 - g) * 256.0)
    # carry
    over = b >= 256
    b[over] = 0
    g[over] += 1
    over = g >= 256
    g[over] = 0
    r[over] += 1
    rgb = np.stack([r, g, b], -1).clip(0, 255).astype(np.uint8)
    return Image.fromarray(rgb, "RGB")


def decode_img(im):
    a = np.asarray(im, dtype=np.float64)
    return a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768


# ---------------------------------------------------------------- relief

LAND_STOPS = [  # elevation m, RGB
    (0, (196, 184, 140)),     # coastal / alluvial plain: pale olive-sand
    (60, (214, 196, 150)),    # low desert plain: sandy beige
    (250, (206, 180, 124)),   # upland desert / Jazira steppe
    (500, (190, 156, 98)),    # steppe ochre
    (900, (166, 126, 80)),    # foothills
    (1500, (138, 102, 70)),   # mountains brown
    (2300, (122, 104, 90)),   # high brown-grey
    (3100, (140, 134, 128)),  # grey rock
    (3700, (190, 188, 190)),  # high scree
    (4200, (248, 248, 252)),  # snow, highest peaks only
]
SEA_STOPS = [
    (0, (92, 152, 160)),      # shallow teal
    (-30, (62, 122, 142)),
    (-100, (40, 90, 122)),
    (-500, (26, 64, 100)),
    (-2000, (16, 42, 76)),
]


def ramp(v, stops):
    xs = np.array([s[0] for s in stops], dtype=np.float64)
    cs = np.array([s[1] for s in stops], dtype=np.float64)
    order = np.argsort(xs)
    xs, cs = xs[order], cs[order]
    return np.stack([np.interp(v, xs, cs[:, i]) for i in range(3)], -1)


def hillshade(elev, dx_m, dy_m, azimuth=315.0, altitude=45.0, zfactor=1.0):
    """Lambertian hillshade; rows run north->south, cols west->east."""
    gy, gx = np.gradient(elev * zfactor, dy_m, dx_m)
    dzdx, dzdy = gx, -gy  # east-positive, north-positive slopes
    az, alt = math.radians(azimuth), math.radians(altitude)
    lx, ly, lz = math.sin(az) * math.cos(alt), math.cos(az) * math.cos(alt), math.sin(alt)
    shade = (-dzdx * lx - dzdy * ly + lz) / np.sqrt(dzdx ** 2 + dzdy ** 2 + 1.0)
    return np.clip(shade, 0, 1)


def lonlat_grid(W, H):
    lons = WEST + (np.arange(W) + 0.5) * (EAST - WEST) / W
    lats = NORTH - (np.arange(H) + 0.5) * (NORTH - SOUTH) / H
    return np.meshgrid(lons, lats)


def grow(seed, allowed, max_iter=5000):
    """Flood-fill seed through 4-connected allowed pixels (iterative dilation)."""
    m = seed & allowed
    for _ in range(max_iter):
        d = m.copy()
        d[1:] |= m[:-1]
        d[:-1] |= m[1:]
        d[:, 1:] |= m[:, :-1]
        d[:, :-1] |= m[:, 1:]
        d &= allowed
        if (d == m).all():
            break
        m = d
    return m


CASPIAN_LEVEL = -28.0


def caspian_region(W, H):
    LON, LAT = lonlat_grid(W, H)
    return (LAT > 36.3) & (LON > 48.3)


def water_mask(elev, W, H):
    """Open sea (Gulf) connected to deep water, plus the Caspian (surface ~-28 m)."""
    casp = caspian_region(W, H)
    LON, LAT = lonlat_grid(W, H)
    gulf_seed = (LAT < 29.8) & (LON > 48.5) & (elev < -15)  # open Persian Gulf
    sea = grow(gulf_seed, (elev <= 0) & ~casp)
    caspian = grow((elev < -100) & casp, (elev < CASPIAN_LEVEL + 0.5) & casp)
    return sea, caspian


def build_relief(elev, sea, caspian, W, H):
    dx_m = (EAST - WEST) / W * 111320.0 * math.cos(math.radians(LAT0))
    dy_m = (NORTH - SOUTH) / H * 110574.0
    water = sea | caspian
    land_col = ramp(np.maximum(elev, 0), LAND_STOPS)
    sea_col = ramp(np.minimum(elev, 0), SEA_STOPS)
    casp_col = ramp(np.full(elev.shape, -150.0), SEA_STOPS)
    col = np.where(sea[..., None], sea_col, land_col)
    col = np.where(caspian[..., None], casp_col, col)

    hs = hillshade(np.where(water, 0.0, np.maximum(elev, CASPIAN_LEVEL)), dx_m, dy_m, zfactor=2.0)
    k = 0.35 + 0.65 * hs / math.sin(math.radians(45))  # flat ground ~1.0
    k = np.where(water, 1.0, k)
    out = col * k[..., None]
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")


# ---------------------------------------------------------------- main

def sample(elev, W, H, lat, lon):
    c = (lon - WEST) / (EAST - WEST) * W - 0.5
    r = (NORTH - lat) / (NORTH - SOUTH) * H - 0.5
    return float(bilinear(elev, np.array([c]), np.array([r]))[0])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zoom", type=int, default=8)
    ap.add_argument("--width", type=int, default=2048)
    ap.add_argument("--step", type=float, default=0.25,
                    help="quantisation step (m) for height.png; smaller = bigger file")
    args = ap.parse_args()

    W = args.width
    wkm = (EAST - WEST) * 111.32 * math.cos(math.radians(LAT0))
    hkm = (NORTH - SOUTH) * 110.574
    H = int(round(W * hkm / wkm))
    print(f"grid {W}x{H}  ({wkm:.1f} x {hkm:.1f} km, {wkm / W:.3f} x {hkm / H:.3f} km/px)")

    elev = build_grid(args.zoom, W, H)
    sea, caspian = water_mask(elev, W, H)
    # Source tiles mix Caspian bathymetry with a flat -29 m patch (data seam);
    # flatten the Caspian to its water surface, it's irrelevant to the map.
    elev[caspian] = CASPIAN_LEVEL
    # Remove isolated inland pits (voids in the source DEM) below sea level.
    # (The Caspian lowland legitimately lies at -28..0 m, so skip that region.)
    pits = ~(sea | caspian | caspian_region(W, H)) & (elev < -5)
    if pits.any():
        med = np.asarray(Image.fromarray(elev.astype(np.float32), "F")
                         .filter(ImageFilter.MedianFilter(7)), dtype=np.float64)
        elev[pits] = np.maximum(med[pits], 0.0)
    print(f"despiked {int(pits.sum())} inland pits")
    print(f"water: sea {sea.mean() * 100:.2f}% of pixels, caspian {caspian.mean() * 100:.2f}%")
    os.makedirs(OUT, exist_ok=True)
    relief_elev = elev.copy()

    # The renderer draws one sea plane at 0 m, which would flood the Caspian
    # lowland (-28..0 m). Lift that corner so -28 m maps to +0.5 m, blending
    # back to true values by 30 m. Relief colours still use real elevations.
    casp_r = caspian_region(W, H) & (elev < 30.0)
    elev[casp_r] = 0.5 + (elev[casp_r] - CASPIAN_LEVEL) * (29.5 / (30.0 - CASPIAN_LEVEL))

    hp = os.path.join(OUT, "height.png")
    encode_terrarium(elev, args.step).save(hp, optimize=True)
    # stats from what was actually written
    elev_q = decode_img(Image.open(hp).convert("RGB"))

    lo = Image.fromarray(elev.astype(np.float32), "F").resize((W // 4, H // 4), Image.BOX)
    lo_e = np.asarray(lo, dtype=np.float64)
    lp = os.path.join(OUT, "height-lo.png")
    encode_terrarium(lo_e, 1.0).save(lp, optimize=True)

    rp = os.path.join(OUT, "relief.jpg")
    relief = build_relief(relief_elev, sea, caspian, W, H)
    relief.save(rp, quality=85, optimize=True, progressive=True)
    relief.resize((W // 4, H // 4), Image.LANCZOS).save("/tmp/relief-preview.png")

    meta = {
        "bbox": {"west": WEST, "east": EAST, "south": SOUTH, "north": NORTH},
        "width": W, "height": H,
        "minElevation": round(float(elev_q.min()), 2),
        "maxElevation": round(float(elev_q.max()), 2),
        "encoding": "terrarium",
        "source": SOURCE,
        "pixelRegistration": "area",
        "lo": {"file": "height-lo.png", "width": lo_e.shape[1], "height": lo_e.shape[0]},
        "relief": "relief.jpg",
        "zoom": args.zoom,
    }
    with open(os.path.join(OUT, "terrain.json"), "w") as f:
        json.dump(meta, f, indent=2)

    for p in (hp, lp, rp, os.path.join(OUT, "terrain.json")):
        print(f"{os.path.relpath(p, ROOT):32s} {os.path.getsize(p) / 1e6:7.3f} MB")
    print(f"elevation min {meta['minElevation']} m, max {meta['maxElevation']} m, "
          f"mean {elev_q.mean():.1f} m")
    for name, lat, lon in [("Babylon", 32.536, 44.421), ("Mosul/Nineveh", 36.36, 43.15),
                           ("Ur", 30.962, 46.103), ("Baghdad", 33.315, 44.366),
                           ("Mari", 34.55, 40.89), ("Susa", 32.19, 48.25),
                           ("Persian Gulf", 27.0 + 2.5, 50.0),
                           ("Caspian", 37.3, 50.3)]:
        print(f"  {name:14s} {lat:7.3f}N {lon:7.3f}E  {sample(elev_q, W, H, lat, lon):8.1f} m")
    # highest point
    r, c = np.unravel_index(np.argmax(elev_q), elev_q.shape)
    print(f"  peak at {NORTH - (r + .5) * (NORTH - SOUTH) / H:.3f}N "
          f"{WEST + (c + .5) * (EAST - WEST) / W:.3f}E")
    return 0


if __name__ == "__main__":
    sys.exit(main())
