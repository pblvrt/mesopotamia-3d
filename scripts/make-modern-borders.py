#!/usr/bin/env python3
"""Clip + simplify Natural Earth admin-0 land boundary lines to the map bbox.

Usage:
  curl -L -o /tmp/ne/b50.geojson \
    https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_boundary_lines_land.geojson
  python3 -I scripts/make-modern-borders.py /tmp/ne/b50.geojson src/data/modern-borders.geojson
"""
import json
import sys

W, E, S, N = 37.5, 50.5, 28.5, 38.5
TOL = 0.012  # degrees (~1.2 km) Douglas-Peucker tolerance


def inside(p):
    return W <= p[0] <= E and S <= p[1] <= N


def clip_segment(a, b):
    """Liang-Barsky clip of segment a-b to the bbox; returns (p0, p1) or None."""
    x0, y0 = a
    dx, dy = b[0] - x0, b[1] - y0
    t0, t1 = 0.0, 1.0
    for p, q in ((-dx, x0 - W), (dx, E - x0), (-dy, y0 - S), (dy, N - y0)):
        if p == 0:
            if q < 0:
                return None
            continue
        r = q / p
        if p < 0:
            if r > t1:
                return None
            t0 = max(t0, r)
        else:
            if r < t0:
                return None
            t1 = min(t1, r)
    return (x0 + t0 * dx, y0 + t0 * dy), (x0 + t1 * dx, y0 + t1 * dy)


def clip_line(line):
    out, cur = [], []
    for a, b in zip(line, line[1:]):
        seg = clip_segment(a, b)
        if not seg:
            if len(cur) > 1:
                out.append(cur)
            cur = []
            continue
        p0, p1 = seg
        if not cur:
            cur = [p0]
        elif cur[-1] != p0:
            if len(cur) > 1:
                out.append(cur)
            cur = [p0]
        cur.append(p1)
        if p1 != tuple(b) and p1 != b:
            out.append(cur)
            cur = []
    if len(cur) > 1:
        out.append(cur)
    return out


def rdp(pts, tol):
    if len(pts) < 3:
        return pts
    (x0, y0), (x1, y1) = pts[0], pts[-1]
    dx, dy = x1 - x0, y1 - y0
    L = (dx * dx + dy * dy) ** 0.5 or 1e-12
    dmax, idx = 0, 0
    for i in range(1, len(pts) - 1):
        d = abs(dy * pts[i][0] - dx * pts[i][1] + x1 * y0 - y1 * x0) / L
        if d > dmax:
            dmax, idx = d, i
    if dmax <= tol:
        return [pts[0], pts[-1]]
    return rdp(pts[: idx + 1], tol)[:-1] + rdp(pts[idx:], tol)


def main(src, dst):
    data = json.load(open(src))
    lines = []
    for f in data['features']:
        g = f['geometry']
        parts = g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]
        for part in parts:
            for piece in clip_line([tuple(p) for p in part]):
                s = rdp(piece, TOL)
                if len(s) >= 2:
                    lines.append([[round(x, 3), round(y, 3)] for x, y in s])
    out = {
        'type': 'FeatureCollection',
        'properties': {
            'source': 'Natural Earth 1:50m admin-0 boundary lines (land), public domain',
            'note': 'Clipped to lon 37.5-50.5, lat 28.5-38.5 and simplified; for orientation only',
        },
        'features': [{'type': 'Feature', 'properties': {'kind': 'border'},
                      'geometry': {'type': 'MultiLineString', 'coordinates': lines}}],
    }
    with open(dst, 'w') as fh:
        json.dump(out, fh, separators=(',', ':'))
    print(f'{len(lines)} lines, {sum(len(l) for l in lines)} points -> {dst}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
