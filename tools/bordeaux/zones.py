# Zones de l'encadrement des loyers de Bordeaux, à partir de la carte officielle (image) :
#   1. chaque pixel est classé en zone 1 à 4 d'après sa couleur (rose, bleu-gris, jaune, vert) ;
#   2. la carte est calée sur le contour de la commune (IGN Admin Express) en maximisant leur recouvrement ;
#   3. une grille géographique d'environ 28 m de côté reçoit la zone majoritaire, puis est nettoyée.
# Écrit extension/lib/data/bordeaux-zones.js. À relancer seulement si la préfecture change le découpage.
#
# Usage : python3 tools/bordeaux/zones.py   (numpy et Pillow requis)
import json, math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'extension', 'lib', 'data', 'bordeaux-zones.js')
img = Image.open(os.path.join(HERE, 'carte-zones.webp')).convert('RGB')
ring = json.load(open(os.path.join(HERE, 'contour-bordeaux.geojson')))['features'][0]['geometry']['coordinates'][0]

# --- 1. Couleurs : rose = zone 1, bleu-gris = zone 2, jaune = zone 3, vert = zone 4 ---
a = np.array(img).astype(int)
r, g, b = a[..., 0], a[..., 1], a[..., 2]
z = np.zeros(r.shape, np.uint8)
z[(r > g + 25) & (r > b + 20)] = 1
z[(b > r + 15) & (b >= g) & ((r + g + b) / 3 < 200)] = 2   # plus sombre que l'eau, du même bleu
z[(r > b + 40) & (g > b + 40)] = 3
z[(g > r + 20) & (g > b + 15)] = 4
H, W = z.shape

# --- 2. Calage : position, échelle, rotation et rapport d'aspect qui superposent la carte au contour ---
LAT0, LON0 = 44.86, -0.585
def to_m(lon, lat):
    return ((lon - LON0) * math.cos(math.radians(LAT0)) * 111320, (lat - LAT0) * 110574)
ring_m = np.array([to_m(*p) for p in ring])

def project(params, pts):
    x0, y0, s, th, k = params
    c, si = math.cos(th), math.sin(th)
    return np.stack([x0 + s * (c * pts[:, 0] - si * pts[:, 1]), y0 - s * k * (si * pts[:, 0] + c * pts[:, 1])], 1)

m = Image.fromarray(((z > 0) * 255).astype(np.uint8))
m = m.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.MinFilter(7)).filter(ImageFilter.MinFilter(9)).filter(ImageFilter.MaxFilter(9))
mask = np.array(m) > 0

def iou(params):
    im = Image.new('1', (W, H), 0)
    ImageDraw.Draw(im).polygon([tuple(p) for p in project(params, ring_m)], fill=1)
    p = np.array(im, bool)
    return (p & mask).sum() / (p | mask).sum()

def nelder_mead(f, x, steps, iters=400):
    n = len(x)
    pts = [x] + [x + np.eye(n)[i] * steps[i] for i in range(n)]
    vals = [f(p) for p in pts]
    for _ in range(iters):
        order = np.argsort(vals); pts = [pts[i] for i in order]; vals = [vals[i] for i in order]
        c = np.mean(pts[:-1], 0)
        xr = c + (c - pts[-1]); fr = f(xr)
        if fr < vals[0]:
            xe = c + 2 * (c - pts[-1]); fe = f(xe)
            pts[-1], vals[-1] = (xe, fe) if fe < fr else (xr, fr)
        elif fr < vals[-2]:
            pts[-1], vals[-1] = xr, fr
        else:
            xc = c + 0.5 * (pts[-1] - c); fc = f(xc)
            if fc < vals[-1]: pts[-1], vals[-1] = xc, fc
            else:
                pts = [pts[0]] + [pts[0] + 0.5 * (p - pts[0]) for p in pts[1:]]
                vals = [vals[0]] + [f(p) for p in pts[1:]]
    i = int(np.argmin(vals)); return pts[i], vals[i]

ys, xs = np.where(mask)
s0 = (xs.max() - xs.min()) / (ring_m[:, 0].max() - ring_m[:, 0].min())
params = np.array([xs.min() - s0 * ring_m[:, 0].min(), ys.min() + s0 * ring_m[:, 1].max(), s0, 0.0, 1.0])
for _ in range(3):
    params, val = nelder_mead(lambda p: -iou(p), params, [20, 20, s0 * 0.03, 0.03, 0.03])
print(f'calage : recouvrement {-val:.3f}, {1 / params[2]:.1f} m par pixel, rotation {math.degrees(params[3]):.2f}°')
x0, y0, s, th, k = params
c, si = math.cos(th), math.sin(th)
def to_px(lon, lat):
    E, N = to_m(lon, lat)
    return x0 + s * (c * E - si * N), y0 - s * k * (si * E + c * N)

# --- 3. Grille géographique ---
D_LAT, D_LON = 0.00025, 0.00035
LAT_MIN, LAT_MAX, LON_MIN, LON_MAX = 44.805, 44.922, -0.645, -0.527
rows = int(round((LAT_MAX - LAT_MIN) / D_LAT)); cols = int(round((LON_MAX - LON_MIN) / D_LON))
clip = Image.new('L', (cols, rows), 0)
ImageDraw.Draw(clip).polygon([((lon - LON_MIN) / D_LON, (LAT_MAX - lat) / D_LAT) for lon, lat in ring], fill=1, outline=1)
clip = np.array(clip.filter(ImageFilter.MaxFilter(5))) > 0   # contour élargi d'environ 60 m

grid = np.zeros((rows, cols), np.uint8)
for i in range(rows):
    lat = LAT_MAX - (i + 0.5) * D_LAT
    for j in range(cols):
        if not clip[i, j]: continue
        x, y = to_px(LON_MIN + (j + 0.5) * D_LON, lat)
        xi, yi = int(round(x)), int(round(y))
        win = z[max(0, yi - 2):yi + 3, max(0, xi - 2):xi + 3].ravel()
        win = win[win > 0]
        # Au moins 6 pixels colorés sur 25 : un pixel isolé (trait, étiquette) ne décide pas de la zone.
        if win.size >= 6: grid[i, j] = np.bincount(win, minlength=5)[1:].argmax() + 1

# Retire les traits fins (contour de la commune, routes) : au moins 6 voisines de même zone sur 25.
cleaned = grid.copy()
for i, j in zip(*np.where(grid > 0)):
    if (grid[max(0, i - 2):i + 3, max(0, j - 2):j + 3] == grid[i, j]).sum() < 6: cleaned[i, j] = 0
grid = cleaned
# Comble les rues blanches entre les îlots : une case vide prend la zone majoritaire de ses voisines.
for _ in range(8):
    filled = grid.copy()
    for i, j in zip(*np.where((grid == 0) & clip)):
        nb = grid[max(0, i - 1):i + 2, max(0, j - 1):j + 2].ravel(); nb = nb[nb > 0]
        if nb.size >= 3: filled[i, j] = np.bincount(nb, minlength=5)[1:].argmax() + 1
    grid = filled

# Encodage par plages : « zone » puis longueur en base 36, séparés par des virgules.
def rle(row):
    out, cur, n = [], row[0], 0
    for v in row:
        if v == cur: n += 1
        else: out.append(f'{cur}{np.base_repr(n, 36).lower()}'); cur, n = v, 1
    out.append(f'{cur}{np.base_repr(n, 36).lower()}')
    return ','.join(out)

data = {'latMax': LAT_MAX, 'lonMin': LON_MIN, 'dLat': D_LAT, 'dLon': D_LON, 'rows': rows, 'cols': cols}
with open(OUT, 'w') as fh:
    fh.write('// Généré par tools/bordeaux/zones.py à partir de la carte officielle des zones : ne pas modifier à la main.\n')
    fh.write('// Grille de zones (1 à 4, 0 hors de la commune), une ligne par bande de latitude, encodée par plages.\n')
    fh.write(f'export const BORDEAUX_ZONES = {json.dumps(data)};\n')
    fh.write('export const BORDEAUX_ZONE_RUNS = [\n')
    for row in grid: fh.write(f"  '{rle(row)}',\n")
    fh.write('];\n')
print('zones :', {i: int((grid == i).sum()) for i in range(1, 5)}, '→', os.path.relpath(OUT))
