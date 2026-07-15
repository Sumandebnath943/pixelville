/* ============================================================
   PixelVille — procedural pixel-art sprite generation.
   Everything is drawn in code at 16px/tile into offscreen
   canvases, then rendered scaled with smoothing off.
   ============================================================ */
'use strict';

const T = 16; // tile size in px

/* ---------- tiny seeded RNG ---------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* ---------- color helpers ---------- */
function shade(hex, f) { // f>0 lighter, f<0 darker
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
  return '#' + ((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1);
}

/* ---------- painter ---------- */
function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  return [c, g];
}
class P {
  constructor(w, h) { [this.c, this.g] = mkCanvas(w, h); this.w = w; this.h = h; this.windows = []; }
  px(x, y, c) { this.g.fillStyle = c; this.g.fillRect(x, y, 1, 1); }
  rect(x, y, w, h, c) { this.g.fillStyle = c; this.g.fillRect(x, y, w, h); }
  fr(x, y, w, h, c) { // frame / outline
    this.g.fillStyle = c;
    this.g.fillRect(x, y, w, 1); this.g.fillRect(x, y + h - 1, w, 1);
    this.g.fillRect(x, y, 1, h); this.g.fillRect(x + w - 1, y, 1, h);
  }
  hl(x, y, w, c) { this.g.fillStyle = c; this.g.fillRect(x, y, w, 1); }
  vl(x, y, h, c) { this.g.fillStyle = c; this.g.fillRect(x, y, 1, h); }
  disc(cx, cy, r, c) {
    this.g.fillStyle = c;
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++)
      if (x * x + y * y <= r * r + r * 0.4) this.g.fillRect(cx + x, cy + y, 1, 1);
  }
  dither(x, y, w, h, c, p, R) {
    this.g.fillStyle = c;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++)
      if (R() < p) this.g.fillRect(x + i, y + j, 1, 1);
  }
  win(x, y, w, h) { // window: drawn + recorded for the night "lit" layer
    this.rect(x, y, w, h, '#5f83a4');
    this.px(x, y, '#c7e0f2');
    this.fr(x - 1, y - 1, w + 2, h + 2, 'rgba(0,0,0,0.35)');
    this.windows.push([x, y, w, h]);
  }
}

/* ============================================================
   CATALOG — every placeable thing (visuals + simulation data)
   cat: res | work | shop | leisure | civic | nature | tool
   hours {s,e} in game-minutes; wkd=true → also open Sundays
   visit: is it a shopping / leisure destination?
   ============================================================ */
const CAT = {};
function def(key, o) { o.key = key; CAT[key] = o; }

/* ---------- generic building painter ---------- */
/* opt: wall, roof, style:'gable'|'flat'|'tower', wallH, sign:{c,txt}, awning:[c1,c2],
        door:'wood'|'glass'|'garage'|'arch'|'none', winW,winH, rows (tower), noWin */
function baseBld(p, W, H, ex, R, opt) {
  const out = shade(opt.wall, -0.55);
  if (opt.style === 'tower') {
    // tall facade occupying the whole sprite
    p.rect(1, 0, W - 2, H - 1, opt.wall);
    p.fr(1, 0, W - 2, H - 1, out);
    p.rect(1, 0, W - 2, 3, opt.roof); p.hl(1, 3, W - 2, out);
    const ww = opt.winW || 3, wh = opt.winH || 4;
    for (let y = 6; y < H - 14; y += wh + 3)
      for (let x = 4; x + ww < W - 3; x += ww + 3)
        p.win(x, y, ww, wh);
    // lobby
    p.rect(3, H - 12, W - 6, 11, shade(opt.wall, -0.18));
    return { wallTop: H - 12, cx: W >> 1 };
  }
  const wallH = opt.wallH || Math.max(11, Math.round(H * 0.34));
  const wallTop = H - wallH;
  // walls
  p.rect(2, wallTop, W - 4, wallH - 1, opt.wall);
  p.fr(2, wallTop, W - 4, wallH - 1, out);
  // roof
  if (opt.style === 'flat') {
    p.rect(1, 0, W - 2, wallTop - 1, opt.roof);
    p.fr(1, 0, W - 2, wallTop - 1, shade(opt.roof, -0.4));
    p.hl(2, wallTop - 4, W - 4, shade(opt.roof, -0.25));
    // AC units
    const n = 1 + Math.floor(R() * 2 + W / 40);
    for (let i = 0; i < n; i++) {
      const ax = 4 + Math.floor(R() * (W - 14)), ay = 3 + Math.floor(R() * (wallTop - 12));
      p.rect(ax, ay, 6, 5, '#b9bcc2'); p.fr(ax, ay, 6, 5, '#7e828a'); p.hl(ax + 1, ay + 2, 4, '#8f939b');
    }
  } else { // gable
    const rTop = 0, rBot = wallTop + 1;
    p.rect(0, rTop + 4, W, rBot - rTop - 4, opt.roof);
    p.rect(2, rTop + 1, W - 4, 4, shade(opt.roof, 0.12));
    p.fr(0, rTop + 4, W, rBot - rTop - 4, shade(opt.roof, -0.4));
    p.hl(2, rTop + 1, W - 4, shade(opt.roof, -0.35));
    for (let y = rTop + 7; y < rBot - 2; y += 3) p.hl(1, y, W - 2, shade(opt.roof, -0.14));
    p.hl(0, rBot, W, 'rgba(0,0,0,0.25)'); // drop shadow on wall
  }
  // windows on wall
  if (!opt.noWin) {
    const ww = opt.winW || 4, wh = opt.winH || 5;
    const y = wallTop + 3;
    for (let x = 5; x + ww < W - 4; x += ww + 4) {
      if (Math.abs(x + ww / 2 - W / 2) < 5 && opt.door !== 'none') continue; // leave door gap
      p.win(x, y, ww, wh);
    }
  }
  // door
  const cx = W >> 1;
  if (opt.door !== 'none') {
    const dh = Math.min(9, wallH - 3), dw = 6;
    const dx = cx - dw / 2, dy = H - 1 - dh;
    if (opt.door === 'glass') {
      p.rect(dx - 1, dy, dw + 2, dh, '#9fc3d8'); p.fr(dx - 1, dy, dw + 2, dh, out);
      p.vl(cx, dy + 1, dh - 1, out);
    } else if (opt.door === 'garage') {
      p.rect(dx - 3, dy, dw + 6, dh, '#c8ccd2'); p.fr(dx - 3, dy, dw + 6, dh, out);
      for (let yy = dy + 2; yy < dy + dh - 1; yy += 2) p.hl(dx - 2, yy, dw + 4, '#9aa0a8');
    } else if (opt.door === 'arch') {
      p.rect(dx, dy, dw, dh, '#6b4a2f'); p.fr(dx, dy, dw, dh, out);
      p.hl(dx + 1, dy - 1, dw - 2, '#6b4a2f');
    } else {
      p.rect(dx, dy, dw, dh, '#7a5233'); p.fr(dx, dy, dw, dh, out);
      p.px(dx + dw - 2, dy + Math.floor(dh / 2), '#e8c66a');
    }
    // awning above door
    if (opt.awning) {
      const aw = dw + 8, ax = cx - aw / 2, ay = H - 1 - Math.min(9, wallH - 3) - 4;
      for (let i = 0; i < aw; i++) p.vl(ax + i, ay, 3, opt.awning[Math.floor(i / 2) % 2]);
      p.hl(ax, ay + 3, aw, 'rgba(0,0,0,0.3)');
    }
  }
  // sign band
  if (opt.sign) {
    const sw = Math.min(W - 10, 8 + (opt.sign.txt || 3) * 4);
    const sx = cx - sw / 2, sy = wallTop - (opt.style === 'flat' ? 7 : 0) + (opt.style === 'flat' ? 0 : 2);
    const yy = opt.style === 'flat' ? wallTop - 8 : wallTop + 1;
    p.rect(sx, yy, sw, 6, opt.sign.c); p.fr(sx, yy, sw, 6, shade(opt.sign.c, -0.45));
    for (let i = 0; i < (opt.sign.txt || 3); i++) p.rect(sx + 3 + i * 4, yy + 2, 2, 2, '#fffbe8');
  }
  return { wallTop, cx };
}

/* ---------- per-type extras & definitions ---------- */
const HOUSE_WALLS = ['#f0e0bd', '#e6c69c', '#d8e4ef', '#f2d4cc', '#e4e0d4', '#cfe0c2'];
const HOUSE_ROOFS = ['#c0574f', '#7a8fb1', '#8a9a5b', '#a86f4f', '#6d5b8e', '#b0883f'];

def('house', {
  name: 'House', emoji: '🏠', cat: 'res', w: 2, h: 2, ex: 10, vars: 4, res: 'family', cars: 1,
  draw(p, W, H, ex, R, v) {
    const wall = HOUSE_WALLS[v % HOUSE_WALLS.length], roof = HOUSE_ROOFS[v % HOUSE_ROOFS.length];
    baseBld(p, W, H, ex, R, { wall, roof, style: 'gable' });
    p.rect(W - 9, 1, 4, 7, '#9a9089'); p.fr(W - 9, 1, 4, 7, '#6e665f'); // chimney
    p.rect(W - 8, 0, 2, 1, '#5b544d');
  }
});
/* upgraded homes — hidden from the palette, used when a household levels up */
def('house2', {
  name: 'Family House +', emoji: '🏠', cat: 'hidden', w: 2, h: 2, ex: 20, vars: 4,
  draw(p, W, H, ex, R, v) {
    const wall = HOUSE_WALLS[v % HOUSE_WALLS.length], roof = HOUSE_ROOFS[v % HOUSE_ROOFS.length];
    baseBld(p, W, H, ex, R, { wall, roof, style: 'gable', wallH: 22 });
    // second floor windows
    p.win(5, H - 20, 4, 5); p.win(W - 9, H - 20, 4, 5);
    p.hl(2, H - 13, W - 4, shade(wall, -0.25)); // floor line
    p.rect(W - 9, 1, 4, 7, '#9a9089'); p.fr(W - 9, 1, 4, 7, '#6e665f');
  }
});
def('house3', {
  name: 'Family Villa', emoji: '🏡', cat: 'hidden', w: 2, h: 2, ex: 26, vars: 4,
  draw(p, W, H, ex, R, v) {
    const wall = HOUSE_WALLS[v % HOUSE_WALLS.length], roof = HOUSE_ROOFS[v % HOUSE_ROOFS.length];
    baseBld(p, W, H, ex, R, { wall, roof, style: 'gable', wallH: 26, door: 'arch' });
    p.win(5, H - 24, 4, 5); p.win(W - 9, H - 24, 4, 5);
    p.hl(2, H - 17, W - 4, shade(wall, -0.25));
    // dormer window
    p.rect((W >> 1) - 4, 5, 8, 8, wall); p.fr((W >> 1) - 4, 5, 8, 8, shade(wall, -0.5));
    p.rect((W >> 1) - 5, 3, 10, 3, shade(roof, 0.1));
    p.win((W >> 1) - 2, 7, 4, 4);
    // solar panels
    p.rect(3, 14, 9, 6, '#2c4a6e'); p.fr(3, 14, 9, 6, '#1c3450');
    p.hl(4, 16, 7, '#4a6a90'); p.vl(7, 15, 4, '#4a6a90');
    p.rect(2, H - 4, 3, 3, '#7fae5c'); p.px(W - 4, H - 3, '#e05a5a'); // hedge + gnome
  }
});

def('cottage', {
  name: 'Cottage', emoji: '🛖', cat: 'res', w: 2, h: 2, ex: 8, vars: 3, res: 'family', cars: 1,
  draw(p, W, H, ex, R, v) {
    const walls = ['#e9d9b8', '#dcc9a4', '#e2d3c0'];
    baseBld(p, W, H, ex, R, { wall: walls[v % 3], roof: '#8a7452', style: 'gable', winW: 3, winH: 4 });
    for (let y = 5; y < H * 0.55; y += 2) p.hl(1, y, W - 2, 'rgba(90,70,40,0.25)'); // thatch
    p.rect(2, H - 4, 3, 3, '#7fae5c'); p.rect(W - 5, H - 4, 3, 3, '#7fae5c'); // bushes
  }
});
def('apartment', {
  name: 'Apartments', emoji: '🏢', cat: 'res', w: 3, h: 3, ex: 24, vars: 3, res: 'block', cars: 2,
  draw(p, W, H, ex, R, v) {
    const walls = ['#d9cbb4', '#c9d2da', '#d8c2be'];
    baseBld(p, W, H, ex, R, { wall: walls[v % 3], roof: '#8d8478', style: 'tower', winW: 4, winH: 5 });
    for (let y = 14; y < H - 16; y += 8) p.hl(2, y, W - 4, shade(walls[v % 3], -0.22)); // balconies
  }
});

def('office', {
  name: 'Office', emoji: '🏬', cat: 'work', w: 3, h: 3, ex: 26, jobs: 12, hours: { s: 480, e: 1020 }, vars: 3,
  draw(p, W, H, ex, R, v) {
    const walls = ['#9db8d0', '#a8c0b0', '#c2b4a2'], roofs = ['#5b7188', '#5f7a66', '#7a6a58'];
    baseBld(p, W, H, ex, R, { wall: walls[v % 3], roof: roofs[v % 3], style: 'tower', winW: 4, winH: 4 });
    p.rect(4, H - 12, W - 8, 2, roofs[v % 3]);
  }
});
def('skyscraper', {
  name: 'Skyscraper', emoji: '🏙️', cat: 'work', w: 3, h: 3, ex: 58, jobs: 30, hours: { s: 480, e: 1050 },
  draw(p, W, H, ex, R) {
    // stepped glass tower
    p.rect(4, 12, W - 8, H - 13, '#7e99b8'); p.fr(4, 12, W - 8, H - 13, '#43597a');
    p.rect(10, 2, W - 20, 12, '#8fa9c6'); p.fr(10, 2, W - 20, 12, '#43597a');
    p.vl(W >> 1, 0, 3, '#43597a'); p.px(W >> 1, 0, '#e05a5a'); // antenna
    for (let y = 15; y < H - 14; y += 6)
      for (let x = 7; x + 3 < W - 6; x += 6) p.win(x, y, 3, 3);
    p.rect(6, H - 12, W - 12, 11, '#5f7793'); // lobby
    p.rect((W >> 1) - 3, H - 9, 6, 8, '#cfe2ef'); p.fr((W >> 1) - 3, H - 9, 6, 8, '#39506e');
  }
});
def('factory', {
  name: 'Factory', emoji: '🏭', cat: 'work', w: 4, h: 3, ex: 14, jobs: 16, hours: { s: 420, e: 990 }, smoke: true,
  draw(p, W, H, ex, R) {
    baseBld(p, W, H, ex, R, { wall: '#b8ada0', roof: '#8b8378', style: 'flat', door: 'garage', winW: 5, winH: 4 });
    // sawtooth roof
    for (let x = 3; x < W - 10; x += 10) { p.rect(x, 4, 8, 5, '#a19a8e'); p.rect(x, 3, 4, 2, '#c8dce8'); }
    p.rect(W - 12, 0, 5, 13, '#98836f'); p.fr(W - 12, 0, 5, 13, '#6b5a4a'); // smokestack
    p.hl(W - 12, 2, 5, '#c65f4e');
    p.rect(W - 20, 2, 4, 11, '#98836f'); p.fr(W - 20, 2, 4, 11, '#6b5a4a');
  }
});
def('airport', {
  name: 'Airport', emoji: '✈️', cat: 'work', w: 9, h: 5, ex: 12, jobs: 18, hours: { s: 0, e: 1440 }, wkd: true,
  draw(p, W, H, ex, R) {
    // apron
    p.rect(0, ex, W, H - ex, '#9a9ea6'); p.fr(0, ex, W, H - ex, '#6e727a');
    p.dither(0, ex, W, H - ex, '#8f939b', 0.15, R);
    // runway (bottom rows)
    p.rect(2, H - 26, W - 4, 20, '#565a62'); p.fr(2, H - 26, W - 4, 20, '#3c4048');
    for (let x = 8; x < W - 12; x += 12) p.rect(x, H - 17, 7, 2, '#e8e4cf');
    for (let i = 0; i < 5; i++) { p.rect(4, H - 24 + i * 4, 2, 2, '#e8e4cf'); p.rect(W - 8, H - 24 + i * 4, 2, 2, '#e8e4cf'); }
    // terminal
    p.rect(6, 2, 52, 20, '#dde2e8'); p.fr(6, 2, 52, 20, '#8a9098');
    p.rect(8, 8, 48, 8, '#9cc4dc'); p.fr(8, 8, 48, 8, '#5f83a4');
    for (let x = 10; x < 54; x += 6) p.vl(x, 9, 6, '#7ea6c0');
    p.rect(26, 16, 12, 6, '#b8bec6');
    // control tower
    p.rect(W - 40, 0, 12, 8, '#c8ced6'); p.fr(W - 40, 0, 12, 8, '#7e848c');
    p.rect(W - 38, 2, 8, 4, '#9cc4dc');
    p.rect(W - 36, 8, 4, 14, '#aab0b8'); p.fr(W - 36, 8, 4, 14, '#7e848c');
    p.px(W - 34, 0, '#e05a5a');
    // parked plane on the apron
    p.rect(W - 24, 26, 16, 4, '#eef0f4'); p.fr(W - 24, 26, 16, 4, '#8a9098');
    p.rect(W - 19, 22, 4, 12, '#dde2e8');
    p.rect(W - 26, 27, 3, 2, '#c05f5f');
    // windsock
    p.vl(4, ex + 2, 8, '#8a8f96'); p.rect(5, ex + 2, 5, 2, '#e08a3c');
  }
});

def('farm', {
  name: 'Farm', emoji: '🌾', cat: 'work', w: 5, h: 4, ex: 8, jobs: 4, hours: { s: 360, e: 960 }, wkd: true,
  draw(p, W, H, ex, R) {
    // field rows
    p.rect(0, ex, W, H - ex, '#c9b877');
    for (let y = ex + 1; y < H; y += 3) p.hl(0, y, W, '#a8945c');
    p.dither(0, ex, W, H - ex, '#8fae55', 0.12, R);
    // barn (top-left)
    p.rect(2, 8, 26, 22, '#b8524a'); p.fr(2, 8, 26, 22, '#6e2f2b');
    p.rect(0, 0, 30, 10, '#8a5a40'); p.fr(0, 0, 30, 10, '#5d3b28');
    p.rect(11, 20, 8, 10, '#7a4438'); p.fr(11, 20, 8, 10, '#4f2b23');
    p.px(13, 22, '#e8d9b0'); p.px(16, 22, '#e8d9b0');
    // silo
    p.rect(W - 14, 2, 9, 26, '#cfd2d6'); p.fr(W - 14, 2, 9, 26, '#8b8f95');
    p.rect(W - 14, 0, 9, 4, '#9aa0a8');
  }
});

def('shop', {
  name: 'Shop', emoji: '🏪', cat: 'shop', w: 2, h: 2, ex: 8, jobs: 3, hours: { s: 540, e: 1140 }, wkd: true, visit: 'shop', vars: 3,
  draw(p, W, H, ex, R, v) {
    const signs = ['#e0704f', '#4f9ed0', '#5fae62'];
    baseBld(p, W, H, ex, R, { wall: '#efe6d2', roof: '#77797d', style: 'flat', door: 'glass', awning: [signs[v % 3], '#f5f1e4'], sign: { c: signs[v % 3], txt: 4 } });
  }
});
def('market', {
  name: 'Supermarket', emoji: '🛒', cat: 'shop', w: 3, h: 2, ex: 10, jobs: 6, hours: { s: 480, e: 1260 }, wkd: true, visit: 'shop',
  draw(p, W, H, ex, R) {
    baseBld(p, W, H, ex, R, { wall: '#e8e2d2', roof: '#8f9296', style: 'flat', door: 'glass', sign: { c: '#e08a3c', txt: 6 }, winW: 6, winH: 5 });
  }
});
def('mall', {
  name: 'Mall', emoji: '🏦', cat: 'shop', w: 5, h: 3, ex: 16, jobs: 24, hours: { s: 540, e: 1290 }, wkd: true, visit: 'shop',
  draw(p, W, H, ex, R) {
    baseBld(p, W, H, ex, R, { wall: '#d8dde4', roof: '#aab0b8', style: 'flat', door: 'glass', sign: { c: '#c05fa8', txt: 6 }, winW: 7, winH: 6 });
    p.rect(6, 2, 12, 8, '#bcd8e8'); p.fr(6, 2, 12, 8, '#7e98a8'); // skylight
    p.rect(W - 18, 2, 12, 8, '#bcd8e8'); p.fr(W - 18, 2, 12, 8, '#7e98a8');
  }
});
def('restaurant', {
  name: 'Restaurant', emoji: '🍽️', cat: 'shop', w: 2, h: 2, ex: 8, jobs: 5, hours: { s: 660, e: 1380 }, wkd: true, visit: 'leisure',
  draw(p, W, H, ex, R) {
    baseBld(p, W, H, ex, R, { wall: '#f2d8c0', roof: '#a8524a', style: 'gable', door: 'wood', awning: ['#c0574f', '#f5eede'], sign: { c: '#a8524a', txt: 3 } });
    p.disc(5, H - 4, 2, '#e8e0cc'); p.px(5, H - 7, '#c0574f'); // umbrella table
  }
});
def('cafe', {
  name: 'Café', emoji: '☕', cat: 'shop', w: 2, h: 2, ex: 8, jobs: 3, hours: { s: 420, e: 1200 }, wkd: true, visit: 'leisure',
  draw(p, W, H, ex, R) {
    baseBld(p, W, H, ex, R, { wall: '#e6d2b8', roof: '#6f5843', style: 'gable', door: 'glass', awning: ['#8a6a4f', '#e8dcc8'], sign: { c: '#8a6a4f', txt: 2 } });
  }
});
def('bakery', {
  name: 'Bakery', emoji: '🥐', cat: 'shop', w: 2, h: 2, ex: 8, jobs: 3, hours: { s: 330, e: 1080 }, wkd: true, visit: 'shop',
  draw(p, W, H, ex, R) {
    baseBld(p, W, H, ex, R, { wall: '#f4e4c8', roof: '#c88a4f', style: 'gable', door: 'wood', awning: ['#d8a050', '#f8f0dc'], sign: { c: '#c88a4f', txt: 3 } });
  }
});
def('hotel', {
  name: 'Hotel', emoji: '🏨', cat: 'shop', w: 3, h: 3, ex: 30, jobs: 10, hours: { s: 0, e: 1440 }, wkd: true,
  draw(p, W, H, ex, R) {
    baseBld(p, W, H, ex, R, { wall: '#e2d4c2', roof: '#7c5f8e', style: 'tower', winW: 4, winH: 5 });
    p.rect((W >> 1) - 6, 4, 12, 8, '#7c5f8e'); p.fr((W >> 1) - 6, 4, 12, 8, '#4f3a5e');
    p.rect((W >> 1) - 4, 6, 3, 4, '#f5e9c8'); p.rect((W >> 1) + 1, 6, 3, 4, '#f5e9c8'); // "H"
    p.rect((W >> 1) - 2, 7, 4, 1, '#f5e9c8');
  }
});
def('bank', {
  name: 'Bank', emoji: '🏛️', cat: 'shop', w: 3, h: 2, ex: 12, jobs: 6, hours: { s: 540, e: 1020 },
  draw(p, W, H, ex, R) {
    baseBld(p, W, H, ex, R, { wall: '#e8e4d8', roof: '#b8b2a2', style: 'flat', door: 'arch', noWin: true });
    for (let x = 6; x < W - 6; x += 8) p.rect(x, H - 14, 3, 13, '#d8d2c2'), p.vl(x, H - 14, 13, '#a8a292'); // columns
    p.rect((W >> 1) - 4, 3, 8, 7, '#c8a84f'); p.fr((W >> 1) - 4, 3, 8, 7, '#8a713a');
    p.px(W >> 1, 6, '#fff7d8'); p.px((W >> 1) - 1, 5, '#fff7d8');
  }
});
def('gas', {
  name: 'Gas Station', emoji: '⛽', cat: 'shop', w: 2, h: 2, ex: 6, jobs: 2, hours: { s: 0, e: 1440 }, wkd: true,
  draw(p, W, H, ex, R) {
    p.rect(1, 0, W - 2, 9, '#e05a5a'); p.fr(1, 0, W - 2, 9, '#8a3535'); p.rect(3, 2, W - 6, 5, '#f2ede0'); // canopy
    p.vl(4, 9, H - 10, '#8a8f96'); p.vl(W - 5, 9, H - 10, '#8a8f96'); // poles
    p.rect(8, H - 12, 5, 10, '#d8dce2'); p.fr(8, H - 12, 5, 10, '#7e838b'); p.rect(9, H - 10, 3, 3, '#e05a5a');
    p.rect(W - 13, H - 12, 5, 10, '#d8dce2'); p.fr(W - 13, H - 12, 5, 10, '#7e838b'); p.rect(W - 12, H - 10, 3, 3, '#4f9ed0');
  }
});

def('school', {
  name: 'School', emoji: '🏫', cat: 'civic', w: 4, h: 3, ex: 14, jobs: 8, hours: { s: 460, e: 960 }, school: true,
  draw(p, W, H, ex, R) {
    baseBld(p, W, H, ex, R, { wall: '#d8a088', roof: '#8a5a4a', style: 'gable', winW: 5, winH: 6, door: 'arch' });
    p.disc(W >> 1, 8, 4, '#f2ede0'); p.px(W >> 1, 8, '#5a5a5a'); p.vl(W >> 1, 6, 3, '#5a5a5a'); // clock
    p.vl(3, 0, 12, '#8a8f96'); p.rect(4, 0, 6, 4, '#e05a5a'); // flag
  }
});
def('college', {
  name: 'College', emoji: '🎓', cat: 'civic', w: 5, h: 3, ex: 18, jobs: 15, hours: { s: 520, e: 1000 }, college: true,
  draw(p, W, H, ex, R) {
    baseBld(p, W, H, ex, R, { wall: '#e4dcc8', roof: '#7a8fb1', style: 'flat', door: 'arch', winW: 5, winH: 6 });
    p.disc(W >> 1, 8, 7, '#9db0c8'); p.disc(W >> 1, 8, 5, '#b8c8da'); p.vl(W >> 1, 0, 3, '#6a7a90'); // dome
    for (let x = 8; x < W - 8; x += 10) p.rect(x, H - 15, 3, 14, '#d4ccb8'), p.vl(x, H - 15, 14, '#a49c88');
  }
});
def('hospital', {
  name: 'Hospital', emoji: '🏥', cat: 'civic', w: 4, h: 3, ex: 20, jobs: 14, hours: { s: 0, e: 1440 }, wkd: true,
  draw(p, W, H, ex, R) {
    baseBld(p, W, H, ex, R, { wall: '#eef0f2', roof: '#c8ced6', style: 'tower', winW: 5, winH: 5 });
    p.rect((W >> 1) - 5, 5, 10, 10, '#f2f4f6'); p.fr((W >> 1) - 5, 5, 10, 10, '#a0a8b2');
    p.rect((W >> 1) - 1, 7, 2, 6, '#e05a5a'); p.rect((W >> 1) - 3, 9, 6, 2, '#e05a5a'); // red cross
  }
});
def('police', {
  name: 'Police', emoji: '🚓', cat: 'civic', w: 3, h: 2, ex: 10, jobs: 6, hours: { s: 0, e: 1440 }, wkd: true,
  draw(p, W, H, ex, R) {
    baseBld(p, W, H, ex, R, { wall: '#c8d2dc', roof: '#4f6d8e', style: 'flat', sign: { c: '#3f5f80', txt: 5 } });
    p.px(4, 1, '#e05a5a'); p.px(6, 1, '#4f9ed0'); // rooftop lights
  }
});
def('fire', {
  name: 'Fire Station', emoji: '🚒', cat: 'civic', w: 3, h: 2, ex: 10, jobs: 6, hours: { s: 0, e: 1440 }, wkd: true,
  draw(p, W, H, ex, R) {
    baseBld(p, W, H, ex, R, { wall: '#d8938a', roof: '#8a3a35', style: 'flat', door: 'garage', sign: { c: '#a83a30', txt: 4 } });
    p.rect(W - 8, 2, 3, 8, '#b8bec6'); // siren tower
  }
});
def('townhall', {
  name: 'Town Hall', emoji: '🏛️', cat: 'civic', w: 3, h: 3, ex: 24, jobs: 8, hours: { s: 510, e: 1020 },
  draw(p, W, H, ex, R) {
    baseBld(p, W, H, ex, R, { wall: '#ece6d6', roof: '#b0a890', style: 'flat', door: 'arch', winW: 4, winH: 6 });
    p.rect((W >> 1) - 4, 2, 8, 14, '#e0dac8'); p.fr((W >> 1) - 4, 2, 8, 14, '#9a9480'); // clock tower
    p.disc(W >> 1, 7, 2, '#f8f4e8'); p.px(W >> 1, 7, '#4a4a4a');
    p.rect((W >> 1) - 5, 0, 10, 3, '#8a9a5b');
  }
});
def('temple', {
  name: 'Temple', emoji: '⛪', cat: 'civic', w: 3, h: 2, ex: 24, hours: { s: 480, e: 1200 }, wkd: true, visit: 'leisure',
  draw(p, W, H, ex, R) {
    baseBld(p, W, H, ex, R, { wall: '#efe9dc', roof: '#8a7a9e', style: 'gable', door: 'arch', winW: 3, winH: 6 });
    // spire
    p.rect((W >> 1) - 3, 6, 6, 14, '#e6e0d2'); p.fr((W >> 1) - 3, 6, 6, 14, '#a8a294');
    p.rect((W >> 1) - 2, 2, 4, 5, '#8a7a9e'); p.rect((W >> 1) - 1, 0, 2, 3, '#8a7a9e');
    p.px(W >> 1, 8, '#c8a84f');
  }
});
def('library', {
  name: 'Library', emoji: '📚', cat: 'civic', w: 3, h: 2, ex: 10, jobs: 4, hours: { s: 540, e: 1140 }, visit: 'leisure',
  draw(p, W, H, ex, R) {
    baseBld(p, W, H, ex, R, { wall: '#dcd2bc', roof: '#7a6a52', style: 'gable', door: 'arch', winW: 4, winH: 6 });
    p.rect(5, 4, 4, 3, '#c0574f'); p.rect(10, 4, 4, 3, '#4f9ed0'); p.rect(15, 4, 4, 3, '#8a9a5b'); // books on sign
  }
});

def('courthouse', {
  name: 'Courthouse', emoji: '⚖️', cat: 'civic', w: 4, h: 3, ex: 18, jobs: 10, hours: { s: 540, e: 1020 },
  draw(p, W, H, ex, R) {
    baseBld(p, W, H, ex, R, { wall: '#e9e2d0', roof: '#8a8272', style: 'flat', door: 'arch', noWin: true });
    for (let x = 6; x < W - 6; x += 9) p.rect(x, H - 17, 3, 16, '#dcd4c0'), p.vl(x, H - 17, 16, '#a89e88');
    p.rect(2, 10, W - 4, 5, '#d0c8b2'); // pediment
    p.g.fillStyle = '#c8b880';
    p.g.beginPath(); p.g.moveTo(W / 2, 2); p.g.lineTo(W / 2 - 12, 11); p.g.lineTo(W / 2 + 12, 11); p.g.closePath(); p.g.fill();
    p.px(W >> 1, 6, '#8a7a4a'); p.hl((W >> 1) - 2, 7, 5, '#8a7a4a'); // scales
  }
});

def('park', {
  name: 'Park', emoji: '🌳', cat: 'leisure', w: 3, h: 3, ex: 6, hours: { s: 360, e: 1320 }, wkd: true, visit: 'leisure', noroof: true,
  draw(p, W, H, ex, R) {
    p.rect(0, ex, W, H - ex, '#85bb62'); p.dither(0, ex, W, H - ex, '#75ab52', 0.25, R);
    p.fr(0, ex, W, H - ex, '#6a9c4a');
    // paths
    p.rect(4, ex + 4, W - 8, H - ex - 8, '#85bb62');
    p.hl(0, (H + ex) >> 1, W, '#d8cba0'); p.vl(W >> 1, ex, H - ex, '#d8cba0');
    p.hl(0, ((H + ex) >> 1) + 1, W, '#c8bb90');
    // fountain
    p.disc(W >> 1, (H + ex) >> 1, 5, '#9ab0b8'); p.disc(W >> 1, (H + ex) >> 1, 3, '#6db4e8');
    p.px(W >> 1, ((H + ex) >> 1) - 1, '#eaf6ff'); p.px((W >> 1) + 1, (H + ex) >> 1, '#eaf6ff');
    // trees & flowers
    const tr = (x, y) => { p.disc(x, y, 4, '#5f9648'); p.disc(x - 1, y - 1, 3, '#74ab58'); p.px(x, y + 4, '#6b4a2f'); };
    tr(6, ex + 7); tr(W - 7, ex + 7); tr(6, H - 8); tr(W - 7, H - 8);
    for (let i = 0; i < 10; i++) p.px(2 + Math.floor(R() * (W - 4)), ex + 2 + Math.floor(R() * (H - ex - 4)), ['#f2d94f', '#f298b8', '#ffffff'][i % 3]);
    // benches
    p.rect(8, ((H + ex) >> 1) - 4, 5, 2, '#8a6a45'); p.rect(W - 13, ((H + ex) >> 1) + 3, 5, 2, '#8a6a45');
  }
});
def('playground', {
  name: 'Playground', emoji: '🛝', cat: 'leisure', w: 2, h: 2, ex: 6, hours: { s: 420, e: 1200 }, wkd: true, visit: 'leisure', noroof: true,
  draw(p, W, H, ex, R) {
    p.rect(0, ex, W, H - ex, '#e4d3a0'); p.fr(0, ex, W, H - ex, '#c4b380'); p.dither(0, ex, W, H - ex, '#d4c390', 0.3, R);
    // slide
    p.rect(5, ex + 3, 3, 8, '#e0704f'); p.rect(8, ex + 7, 6, 2, '#e0704f'); p.vl(13, ex + 9, 4, '#a05038');
    // swing
    p.vl(20, ex + 3, 9, '#7a8288'); p.vl(27, ex + 3, 9, '#7a8288'); p.hl(20, ex + 3, 8, '#7a8288');
    p.vl(22, ex + 4, 5, '#5a6268'); p.vl(25, ex + 4, 5, '#5a6268'); p.rect(21, ex + 9, 3, 1, '#c8a050'); p.rect(24, ex + 9, 3, 1, '#c8a050');
  }
});
def('amusement', {
  name: 'Amusement Park', emoji: '🎡', cat: 'leisure', w: 5, h: 4, ex: 32, jobs: 8, hours: { s: 600, e: 1350 }, wkd: true, visit: 'leisure', noroof: true,
  draw(p, W, H, ex, R) {
    p.rect(0, ex, W, H - ex, '#8cba66'); p.dither(0, ex, W, H - ex, '#7aa856', 0.2, R);
    p.fr(0, ex, W, H - ex, '#b8506e'); p.fr(1, ex + 1, W - 2, H - ex - 2, '#e8a0b8'); // festive fence
    // ferris wheel
    const cx = 22, cy = 22, r = 18;
    p.g.strokeStyle = '#c8ccd4'; p.g.lineWidth = 1;
    p.g.beginPath(); p.g.arc(cx, cy, r, 0, 7); p.g.stroke();
    p.g.beginPath(); p.g.arc(cx, cy, r - 3, 0, 7); p.g.stroke();
    const cabCols = ['#e05a5a', '#f2c14f', '#4f9ed0', '#5fae62', '#c05fa8', '#e08a3c', '#7c5f8e', '#4fc0b0'];
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      p.g.beginPath(); p.g.moveTo(cx, cy); p.g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); p.g.stroke();
      p.rect(Math.round(cx + Math.cos(a) * r) - 2, Math.round(cy + Math.sin(a) * r) - 1, 4, 4, cabCols[i]);
    }
    p.disc(cx, cy, 2, '#8a8f96');
    p.vl(cx - 6, cy + 4, H - cy - 6, '#7a8288'); p.vl(cx + 6, cy + 4, H - cy - 6, '#7a8288');
    // circus tent
    p.rect(W - 30, ex + 10, 24, 14, '#e8e0d0');
    for (let i = 0; i < 24; i += 4) p.rect(W - 30 + i, ex + 10, 2, 14, '#d05858');
    p.rect(W - 32, ex + 4, 28, 7, '#d05858'); p.rect(W - 26, ex + 1, 16, 4, '#d05858');
    p.px(W - 18, ex, '#f2c14f');
    // ticket booth
    p.rect(W - 14, H - 12, 9, 10, '#f2c14f'); p.fr(W - 14, H - 12, 9, 10, '#a8823a'); p.rect(W - 12, H - 9, 5, 4, '#6a5a8a');
  }
});
def('stadium', {
  name: 'Stadium', emoji: '🏟️', cat: 'leisure', w: 6, h: 4, ex: 14, jobs: 10, hours: { s: 900, e: 1380 }, wkd: true, visit: 'leisure', noroof: true,
  draw(p, W, H, ex, R) {
    const g = p.g;
    g.fillStyle = '#c8ccd4'; g.beginPath(); g.ellipse(W / 2, (H + ex) / 2, W / 2 - 1, (H - ex) / 2 + 5, 0, 0, 7); g.fill();
    g.fillStyle = '#9aa0aa'; g.beginPath(); g.ellipse(W / 2, (H + ex) / 2, W / 2 - 5, (H - ex) / 2 + 1, 0, 0, 7); g.fill();
    g.fillStyle = '#6cae52'; g.beginPath(); g.ellipse(W / 2, (H + ex) / 2, W / 2 - 12, (H - ex) / 2 - 6, 0, 0, 7); g.fill();
    p.fr((W >> 1) - 10, ((H + ex) >> 1) - 6, 20, 12, '#e8f0e0'); p.vl(W >> 1, ((H + ex) >> 1) - 6, 12, '#e8f0e0');
    // floodlights
    p.vl(3, 2, 8, '#7a8288'); p.rect(1, 0, 5, 3, '#f2e8b0');
    p.vl(W - 4, 2, 8, '#7a8288'); p.rect(W - 6, 0, 5, 3, '#f2e8b0');
  }
});
def('cinema', {
  name: 'Cinema', emoji: '🎬', cat: 'leisure', w: 3, h: 3, ex: 14, jobs: 6, hours: { s: 720, e: 1410 }, wkd: true, visit: 'leisure',
  draw(p, W, H, ex, R) {
    baseBld(p, W, H, ex, R, { wall: '#5a5f6e', roof: '#3f4350', style: 'flat', door: 'glass', winW: 0, winH: 0, noWin: true });
    // marquee
    p.rect(4, H - 22, W - 8, 9, '#f2e8d0'); p.fr(4, H - 22, W - 8, 9, '#c8a84f');
    for (let x = 6; x < W - 6; x += 3) { p.px(x, H - 21, '#f2c14f'); p.px(x, H - 15, '#f2c14f'); }
    p.rect(8, H - 19, 8, 3, '#e05a5a'); p.rect(18, H - 19, 6, 3, '#4f9ed0');
    // film reel sign
    p.disc(W >> 1, 6, 5, '#c8ccd4'); p.disc(W >> 1, 6, 2, '#5a5f6e');
  }
});
def('theater', {
  name: 'Theater', emoji: '🎭', cat: 'leisure', w: 3, h: 3, ex: 14, jobs: 6, hours: { s: 960, e: 1410 }, visit: 'leisure',
  draw(p, W, H, ex, R) {
    baseBld(p, W, H, ex, R, { wall: '#c9a45c', roof: '#8e3f4a', style: 'gable', door: 'arch', winW: 3, winH: 6 });
    for (let x = 6; x < W - 6; x += 9) p.rect(x, H - 15, 3, 14, '#e2cfa0'), p.vl(x, H - 15, 14, '#a8925c');
    p.rect((W >> 1) - 6, 4, 12, 8, '#f2ead0'); p.fr((W >> 1) - 6, 4, 12, 8, '#8e3f4a');
    p.px((W >> 1) - 2, 7, '#3a3a3a'); p.px((W >> 1) + 2, 7, '#3a3a3a'); // masks
  }
});
def('museum', {
  name: 'Museum', emoji: '🖼️', cat: 'leisure', w: 3, h: 3, ex: 12, jobs: 5, hours: { s: 600, e: 1080 }, wkd: true, visit: 'leisure',
  draw(p, W, H, ex, R) {
    baseBld(p, W, H, ex, R, { wall: '#e6e0d0', roof: '#a8a08c', style: 'flat', door: 'arch', noWin: true });
    for (let x = 5; x < W - 5; x += 8) p.rect(x, H - 16, 3, 15, '#d8d2c0'), p.vl(x, H - 16, 15, '#a8a290');
    p.rect(3, 8, W - 6, 4, '#c8c0aa'); // pediment step
    p.rect((W >> 1) - 8, 2, 16, 6, '#5f83a4'); p.fr((W >> 1) - 8, 2, 16, 6, '#3d5a75'); // banner
  }
});
def('gym', {
  name: 'Gym', emoji: '🏋️', cat: 'leisure', w: 2, h: 2, ex: 8, jobs: 3, hours: { s: 360, e: 1320 }, wkd: true, visit: 'leisure',
  draw(p, W, H, ex, R) {
    baseBld(p, W, H, ex, R, { wall: '#b0b8c2', roof: '#6a7280', style: 'flat', door: 'glass', sign: { c: '#e0704f', txt: 3 } });
    p.rect(4, 2, 3, 5, '#4a4f58'); p.rect(11, 2, 3, 5, '#4a4f58'); p.rect(7, 4, 4, 1, '#4a4f58'); // dumbbell
  }
});
def('pool', {
  name: 'Swimming Pool', emoji: '🏊', cat: 'leisure', w: 3, h: 2, ex: 6, jobs: 2, hours: { s: 540, e: 1200 }, wkd: true, visit: 'leisure', noroof: true,
  draw(p, W, H, ex, R) {
    p.rect(0, ex, W, H - ex, '#d8d2c0'); p.fr(0, ex, W, H - ex, '#b0aa98');
    p.rect(4, ex + 4, W - 8, H - ex - 8, '#5fb4e8'); p.fr(4, ex + 4, W - 8, H - ex - 8, '#3f94c8');
    p.dither(5, ex + 5, W - 10, H - ex - 10, '#8fd0f4', 0.15, R);
    p.vl(W - 8, ex + 2, 5, '#c8ccd4'); p.vl(W - 6, ex + 2, 5, '#c8ccd4'); p.hl(W - 8, ex + 2, 3, '#c8ccd4'); // ladder
    p.rect(6, ex + 1, 6, 2, '#e05a5a'); p.rect(14, ex + 1, 6, 2, '#f2c14f'); // towels
  }
});

/* nature + tools (no draw fn — handled specially) */
def('tree', { name: 'Tree', emoji: '🌲', cat: 'nature', tool: 'tree' });
def('forest', { name: 'Forest', emoji: '🌲', cat: 'nature', tool: 'forest' });
def('pond', { name: 'Pond', emoji: '💧', cat: 'nature', tool: 'pond' });
def('lake', { name: 'Lake', emoji: '🌊', cat: 'nature', tool: 'lake' });
def('river', { name: 'River', emoji: '🏞️', cat: 'nature', tool: 'river', drag: true });
def('mountain', { name: 'Mountain', emoji: '⛰️', cat: 'nature', tool: 'mountain' });
def('road', { name: 'Road', emoji: '🛣️', cat: 'tool', tool: 'road', drag: true });
def('bulldoze', { name: 'Bulldoze', emoji: '🚜', cat: 'tool', tool: 'bulldoze', drag: true });

/* ============================================================
   Sprite factory
   ============================================================ */
const SPR = {
  grass: [], waterFrames: [], rockTile: null, treeVars: [], roads: [],
  bridgeH: null, bridgeV: null, mountain: null, b: {},
  _people: new Map(), _cars: [],

  init() {
    this.makeGrass(); this.makeWater(); this.makeIce(); this.makeRock(); this.makeTrees();
    this.makeRoads(); this.makeBridges(); this.makeMountains(); this.makeCars();
    this.makeGlow(); this.makeLamp(); this.makePuddles(); this.makePolice();
    this.makeCritters(); this.makeUmbrellas(); this.makeDecor();
    for (const key in CAT) {
      const d = CAT[key];
      if (!d.draw) continue;
      const vars = d.vars || 1;
      this.b[key] = [];
      for (let v = 0; v < vars; v++) {
        const R = mulberry32(hashStr(key) + v * 7919);
        const W = d.w * T, H = d.h * T + d.ex;
        const p = new P(W, H);
        d.draw(p, W, H, d.ex, R, v);
        // night windows layer
        const [litC, litG] = mkCanvas(W, H);
        for (const [x, y, w, h] of p.windows) {
          litG.fillStyle = 'rgba(255,200,90,0.28)';
          litG.fillRect(x - 1, y - 1, w + 2, h + 2);
          litG.fillStyle = Math.random() < 0.75 ? '#ffd166' : '#7a6a4a';
          litG.fillRect(x, y, w, h);
        }
        this.b[key].push({ img: p.c, lit: litC, oy: d.ex, snow: this.snowCap(p.c), sh: this.shadowOf(p.c) });
      }
    }
    this.makeAircraft();
  },

  /* black silhouette for SimCity-style cast shadows */
  shadowOf(src) {
    const [c, g] = mkCanvas(src.width, src.height);
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#0a1410';
    g.fillRect(0, 0, src.width, src.height);
    return c;
  },

  makeAircraft() {
    // small jet, flying east (flip for west)
    let p = new P(20, 14);
    p.rect(2, 6, 15, 3, '#eef0f4'); p.fr(2, 6, 15, 3, '#8a9098');   // fuselage
    p.rect(15, 5, 4, 2, '#9cc4dc');                                   // cockpit
    p.g.fillStyle = '#dde2e8';
    p.g.beginPath(); p.g.moveTo(9, 7); p.g.lineTo(3, 13); p.g.lineTo(7, 13); p.g.lineTo(12, 7); p.g.fill(); // wing low
    p.g.beginPath(); p.g.moveTo(9, 6); p.g.lineTo(5, 1); p.g.lineTo(8, 1); p.g.lineTo(12, 6); p.g.fill();  // wing high
    p.rect(2, 3, 3, 4, '#c05f5f');                                    // tail
    this.plane = p.c;
    // hot-air balloon
    p = new P(14, 20);
    const cols = ['#e05a5a', '#f2c14f', '#4f9ed0', '#5fae62'];
    for (let i = 0; i < 4; i++) { p.g.fillStyle = cols[i]; p.g.beginPath(); p.g.arc(7, 7, 6.5, (i / 4) * 6.283 - 1.57, ((i + 1) / 4) * 6.283 - 1.57); p.g.lineTo(7, 7); p.g.fill(); }
    p.disc(7, 7, 3, cols[1]);
    p.vl(4, 13, 3, '#6b4a2f'); p.vl(10, 13, 3, '#6b4a2f');
    p.rect(4, 16, 7, 4, '#8a6a45'); p.fr(4, 16, 7, 4, '#5d4630');
    this.balloon = p.c;
    // UFO
    p = new P(16, 8);
    p.g.fillStyle = '#8a94a4'; p.g.beginPath(); p.g.ellipse(8, 5, 8, 2.6, 0, 0, 7); p.g.fill();
    p.g.fillStyle = '#b8c2d0'; p.g.beginPath(); p.g.ellipse(8, 4, 5, 2, 0, 0, 7); p.g.fill();
    p.disc(8, 2, 2.4, '#9adcb8');
    for (const x of [3, 8, 13]) p.px(x, 5, '#baffd0');
    this.ufo = p.c;
    // fire truck
    const mkF = () => {
      let q = new P(13, 8);
      q.rect(0, 2, 13, 4, '#d84a42'); q.fr(0, 2, 13, 4, '#7e2622');
      q.rect(9, 1, 3, 2, '#9cc4dc');
      q.rect(1, 3, 7, 1, '#c8ccd4'); // ladder
      q.px(6, 1, '#ffd160');
      q.rect(2, 6, 2, 2, '#141418'); q.rect(9, 6, 2, 2, '#141418');
      const h = q.c;
      q = new P(8, 13);
      q.rect(2, 0, 4, 13, '#d84a42'); q.fr(2, 0, 4, 13, '#7e2622');
      q.rect(3, 1, 2, 2, '#9cc4dc'); q.rect(3, 5, 1, 6, '#c8ccd4');
      q.rect(0, 2, 2, 2, '#141418'); q.rect(6, 2, 2, 2, '#141418');
      q.rect(0, 9, 2, 2, '#141418'); q.rect(6, 9, 2, 2, '#141418');
      return { h, v: q.c };
    };
    this.fireTruck = mkF();
  },

  /* construction scaffolds & rubble, cached per footprint */
  _sites: new Map(),
  site(w, h) {
    const key = w + 'x' + h;
    if (this._sites.has(key)) return this._sites.get(key);
    const W = w * T, H = h * T;
    const p = new P(W, H + 10);
    // dirt pad
    p.rect(0, 10, W, H, '#b09a72'); p.fr(0, 10, W, H, '#8a7550');
    p.dither(1, 11, W - 2, H - 2, '#9c8760', 0.3, mulberry32(hashStr(key)));
    // scaffold frame
    p.g.strokeStyle = '#8a6a3f'; p.g.lineWidth = 1;
    for (let x = 3; x < W - 2; x += 12) { p.vl(x, 2, H + 4, '#8a6a3f'); }
    p.hl(3, 6, W - 6, '#a5824f'); p.hl(3, 10 + (H >> 1), W - 6, '#a5824f');
    p.g.beginPath(); p.g.moveTo(3, 10 + H * 0.5); p.g.lineTo(15, 6); p.g.stroke();
    // material piles + mixer
    p.rect(3, H - 2, 8, 4, '#c8845a'); p.hl(4, H - 1, 6, '#e0a070');
    p.rect(W - 12, H - 1, 7, 5, '#9aa0a8'); p.disc(W - 9, H, 3, '#b8bec6');
    if (w >= 3) { // crane
      p.vl(W - 6, 0, H + 6, '#d8a03c');
      p.hl(W - 16, 2, 14, '#d8a03c');
      p.vl(W - 15, 2, 5, '#8a6a3f');
      p.rect(W - 17, 7, 4, 3, '#c8ccd4');
    }
    const out = { img: p.c, oy: 10 };
    this._sites.set(key, out);
    return out;
  },
  _rubble: new Map(),
  rubble(w, h) {
    const key = w + 'x' + h;
    if (this._rubble.has(key)) return this._rubble.get(key);
    const W = w * T, H = h * T;
    const p = new P(W, H);
    const R = mulberry32(hashStr(key) + 7);
    p.rect(0, 0, W, H, '#7e7a72'); p.fr(0, 0, W, H, '#5a564e');
    p.dither(1, 1, W - 2, H - 2, '#6e6a62', 0.4, R);
    p.dither(1, 1, W - 2, H - 2, '#928e86', 0.25, R);
    for (let i = 0; i < w * h * 2; i++) {
      const x = 2 + R() * (W - 6), y = 2 + R() * (H - 6);
      p.rect(x, y, 2 + R() * 3, 2 + R() * 2, R() < 0.5 ? '#4a463e' : '#a8a49c');
    }
    p.px(3, 2, '#2c2a26'); p.px(W - 5, H - 4, '#2c2a26');
    const out = { img: p.c, oy: 0 };
    this._rubble.set(key, out);
    return out;
  },

  /* white top-edge highlights, drawn over sprites in winter */
  snowCap(src) {
    const [c, g] = mkCanvas(src.width, src.height);
    const sg = src.getContext('2d');
    const data = sg.getImageData(0, 0, src.width, src.height).data;
    const a = (x, y) => (x < 0 || y < 0 || x >= src.width || y >= src.height) ? 0 : data[(y * src.width + x) * 4 + 3];
    for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
      if (a(x, y) > 40 && a(x, y - 1) <= 40) {
        g.fillStyle = '#f4f7fb'; g.fillRect(x, y, 1, 1);
        if (a(x, y + 1) > 40 && ((x * 31 + y * 17) % 3)) { g.fillStyle = 'rgba(238,243,250,0.75)'; g.fillRect(x, y + 1, 1, 1); }
      }
    }
    return c;
  },

  makeGrass() {
    // per-season ground tiles: [spring, summer, autumn, winter] x 4 variants
    const bases = ['#8fc06a', '#84b95f', '#a8a95c', '#e8edf3'];
    const flowerSets = [['#ffffff', '#f2d94f', '#f298b8'], ['#f2d94f', '#ffffff'], ['#c87f3a', '#b85c3a'], []];
    this.grassSeasons = [];
    for (let s = 0; s < 4; s++) {
      const set = [];
      for (let v = 0; v < 4; v++) {
        const R = mulberry32(1000 + s * 10 + v);
        const p = new P(T, T);
        const base = bases[s];
        p.rect(0, 0, T, T, base);
        if (s === 3) { // snow: soft blue shading + sparkles
          p.dither(0, 0, T, T, '#dde5ee', 0.16, R);
          p.dither(0, 0, T, T, '#f8fbff', 0.10, R);
          if (v === 2) p.px(4 + (v * 3) % 8, 6, '#c9d4e2');
        } else {
          p.dither(0, 0, T, T, shade(base, -0.08), 0.18, R);
          p.dither(0, 0, T, T, shade(base, 0.09), 0.10, R);
          if (s === 2) p.dither(0, 0, T, T, '#c07840', 0.05, R); // fallen leaves
          if (v === 1 || v === 3) {
            const fs = flowerSets[s];
            if (fs.length) p.px(3 + ((v * 5) % 9), 4 + ((v * 3 + s) % 8), fs[v % fs.length]);
          }
        }
        set.push(p.c);
      }
      this.grassSeasons.push(set);
    }
    this.grass = this.grassSeasons[0];
  },

  makeIce() {
    const R = mulberry32(2500);
    const p = new P(T, T);
    p.rect(0, 0, T, T, '#b8d4ea');
    p.dither(0, 0, T, T, '#a9c8e0', 0.2, R);
    p.dither(0, 0, T, T, '#d5e8f6', 0.14, R);
    p.hl(3, 5, 6, '#e8f4fc'); p.px(9, 6, '#e8f4fc'); // crack glints
    p.hl(8, 11, 4, '#9dbdd8');
    this.iceTile = p.c;
  },

  makeWater() {
    for (let f = 0; f < 2; f++) {
      const R = mulberry32(2000 + f);
      const p = new P(T, T);
      p.rect(0, 0, T, T, '#57a5e8');
      p.dither(0, 0, T, T, '#4a97da', 0.2, R);
      for (let i = 0; i < 3; i++) {
        const y = (f * 3 + i * 5 + 2) % T;
        p.hl((f * 7 + i * 4) % 10, y, 4, '#7cc0f2');
      }
      this.waterFrames.push(p.c);
    }
  },

  makeRock() {
    const R = mulberry32(3000);
    const p = new P(T, T);
    p.rect(0, 0, T, T, '#98938a');
    p.dither(0, 0, T, T, '#8a857c', 0.25, R);
    p.dither(0, 0, T, T, '#a6a198', 0.15, R);
    p.px(4, 6, '#767168'); p.px(11, 11, '#767168'); p.px(8, 3, '#767168');
    this.rockTile = p.c;
  },

  makeTrees() {
    // seasonal canopies: spring (blossom), summer (deep green), autumn (fire), winter (bare + snow)
    const palettes = [
      [['#5f9648', '#74ab58'], ['#548c40', '#68a04e'], ['#6ba050', '#80b562']],
      [['#4e8a3c', '#639e4a'], ['#457f34', '#589342'], ['#578f40', '#6ca350']],
      [['#c07830', '#d4903e'], ['#b05a2c', '#c8703a'], ['#a8862e', '#c0a040']],
      null, // winter drawn separately
    ];
    this.treeSeasons = [];
    for (let s = 0; s < 4; s++) {
      const set = [];
      for (let v = 0; v < 3; v++) {
        const p = new P(T, T + 6);
        if (s === 3) { // bare branches with snow
          p.rect(7, 8, 2, T - 3, '#6b4a2f');
          p.vl(5, 9, 4, '#5d3f28'); p.vl(10, 8, 5, '#5d3f28');
          p.vl(3, 6, 4, '#5d3f28'); p.vl(12, 5, 5, '#5d3f28');
          p.px(5, 8, '#f4f7fb'); p.px(10, 7, '#f4f7fb'); p.px(3, 5, '#f4f7fb'); p.px(12, 4, '#f4f7fb');
          p.hl(6, 7, 4, '#f4f7fb');
        } else {
          const [d, l] = palettes[s][v];
          p.rect(7, T + 1, 2, 4, '#6b4a2f');
          p.disc(8, 9, 6, d);
          p.disc(7, 7, 4, l);
          p.px(5, 5, shade(l, 0.2)); p.px(9, 6, shade(l, 0.15));
          if (s === 0 && v !== 1) { p.px(4, 8, '#f2b8cc'); p.px(10, 5, '#f8d8e4'); } // blossom
          if (s === 2) { p.px(4, 13, '#c07830'); p.px(11, 14, '#b05a2c'); }          // dropped leaves
        }
        set.push({ img: p.c, oy: 6 });
      }
      this.treeSeasons.push(set);
    }
    this.treeVars = this.treeSeasons[0];
  },

  makeRoads() {
    // mask bits: 1=N 2=E 4=S 8=W
    const ASPH = '#7b7f88', EDGE = '#585c66', DASH = '#e8e4cf', SIDE = '#cfcaba', CURB = '#a29d8e';
    for (let m = 0; m < 16; m++) {
      const p = new P(T, T);
      p.rect(0, 0, T, T, ASPH);
      const R = mulberry32(4000 + m);
      p.dither(0, 0, T, T, '#747881', 0.15, R);
      const n = m & 1, e = m & 2, s = m & 4, w = m & 8;
      // sidewalks on unconnected sides
      if (!n) { p.rect(0, 0, T, 3, SIDE); p.hl(0, 3, T, CURB); }
      if (!s) { p.rect(0, T - 3, T, 3, SIDE); p.hl(0, T - 4, T, CURB); }
      if (!w) { p.rect(0, 0, 3, T, SIDE); p.vl(3, 0, T, CURB); }
      if (!e) { p.rect(T - 3, 0, 3, T, SIDE); p.vl(T - 4, 0, T, CURB); }
      // center dashes on straights
      if (n && s && !e && !w) { p.rect(7, 1, 2, 4, DASH); p.rect(7, 8, 2, 4, DASH); }
      if (e && w && !n && !s) { p.rect(1, 7, 4, 2, DASH); p.rect(8, 7, 4, 2, DASH); }
      this.roads.push(p.c);
    }
  },

  makeBridges() {
    const PLANK = '#c08c58', GAP = '#9a6c40', RAIL = '#6f4b28';
    let p = new P(T, T);
    p.rect(0, 2, T, T - 4, PLANK);
    for (let x = 2; x < T; x += 4) p.vl(x, 2, T - 4, GAP);
    p.rect(0, 0, T, 2, RAIL); p.rect(0, T - 2, T, 2, RAIL);
    p.hl(0, 1, T, shade(RAIL, 0.25)); p.hl(0, T - 2, T, shade(RAIL, 0.25));
    this.bridgeH = p.c;
    p = new P(T, T);
    p.rect(2, 0, T - 4, T, PLANK);
    for (let y = 2; y < T; y += 4) p.hl(2, y, T - 4, GAP);
    p.rect(0, 0, 2, T, RAIL); p.rect(T - 2, 0, 2, T, RAIL);
    p.vl(1, 0, T, shade(RAIL, 0.25)); p.vl(T - 2, 0, T, shade(RAIL, 0.25));
    this.bridgeV = p.c;
  },

  makeMountains() {
    // massive 5x5-footprint ranges — hazy back ridges, peaks with shaded west
    // faces and sunlit ridgelines, crags, jagged snow caps with gullies, and
    // a mossy pine-fringed foothill that blends into the grass
    this.mountains = [];
    for (let v = 0; v < 2; v++) {
      const W = 5 * T, EX = 60, H = 5 * T + EX;
      const p = new P(W, H);
      const g = p.g;
      const R = mulberry32(7100 + v * 313);
      const peaks = [];
      const baseY = H - 10;

      // distant haze ridge behind everything
      const haze = (cx, topY, bw) => {
        g.fillStyle = '#a9b4bf';
        g.beginPath();
        g.moveTo(cx - bw / 2, baseY);
        const n = 6;
        for (let i = 1; i < n; i++) {
          const f = i / n;
          g.lineTo(cx - bw / 2 + bw * f,
            baseY - Math.sin(f * Math.PI) * (baseY - topY) * (0.8 + (R() - 0.5) * 0.35));
        }
        g.lineTo(cx + bw / 2, baseY);
        g.closePath(); g.fill();
      };

      const poly = pts => {
        g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
        for (const [x, y] of pts) g.lineTo(x, y);
        g.closePath(); g.fill();
      };

      // one peak: shadowed west face, lit east face, bright ridgeline, crags, snow
      const peak = (cx, topY, bw, tone) => {
        const Lt = [], Rt = [];
        const n = 5;
        for (let i = 0; i <= n; i++) {
          const f = i / n;
          const y = topY + (baseY - topY) * f;
          const spread = (bw / 2) * Math.pow(f, 0.72); // steep summit, splayed base
          Lt.push([cx - spread + (i > 0 && i < n ? R() * 6 - 3 : 0), y]);
          Rt.push([cx + spread + (i > 0 && i < n ? R() * 6 - 3 : 0), y]);
        }
        g.fillStyle = tone.dark;                       // whole body in shadow tone
        poly(Lt.concat([...Rt].reverse()));
        const RD = [];                                 // ridge drifts a touch west
        for (let i = 0; i <= n; i++) {
          const f = i / n;
          RD.push([cx - bw * 0.06 * f + (i ? R() * 4 - 2 : 0), topY + (baseY - topY) * f]);
        }
        g.fillStyle = tone.mid;                        // sunlit east face
        poly(RD.concat([...Rt].reverse()));
        g.strokeStyle = tone.lit; g.lineWidth = 1.5;   // bright band along the ridge
        g.beginPath(); g.moveTo(RD[0][0], RD[0][1]);
        for (const [x, y] of RD) g.lineTo(x + 1, y);
        g.stroke();
        g.strokeStyle = 'rgba(30,28,24,0.30)'; g.lineWidth = 1; // crag shadows
        for (let i = 0; i < 5; i++) {
          const sx = cx + (R() - 0.6) * bw * 0.4;
          const sy = topY + (baseY - topY) * (0.25 + R() * 0.5);
          g.beginPath(); g.moveTo(sx, sy);
          g.lineTo(sx - 2 - R() * 5, sy + 6 + R() * 10);
          g.stroke();
        }
        p.dither(cx - bw / 2 + 2, topY + (baseY - topY) * 0.45, bw - 4, (baseY - topY) * 0.5, tone.spk, 0.10, R);
        // snow cap with a jagged hem
        const snowH = (baseY - topY) * (0.26 + R() * 0.08);
        const hem = topY + snowH;
        const hw = (bw / 2) * Math.pow(snowH / (baseY - topY), 0.72);
        g.fillStyle = '#eef3f8';
        g.beginPath();
        g.moveTo(RD[0][0], topY);
        g.lineTo(cx - hw, hem);
        for (let x = cx - hw; x < cx + hw; x += 4) {
          g.lineTo(x + 2, hem - 2 - R() * 3);
          g.lineTo(x + 4, hem + R() * 2);
        }
        g.lineTo(cx + hw, hem);
        g.closePath(); g.fill();
        g.fillStyle = 'rgba(160,180,200,0.5)';         // cap's shaded west half
        g.beginPath(); g.moveTo(RD[0][0], topY); g.lineTo(cx - hw, hem); g.lineTo(cx - bw * 0.05, hem); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(238,243,248,0.75)';      // snow gullies below the hem
        for (let i = 0; i < 3; i++) {
          const gx = cx - bw * 0.18 + i * bw * 0.16 + R() * 3;
          g.beginPath(); g.moveTo(gx, hem - 1);
          g.lineTo(gx + R() * 4 - 2, hem + 5 + R() * 7);
          g.stroke();
        }
        peaks.push([cx, topY + 3]);
      };

      const warm = { dark: '#5f594f', mid: '#7e766a', lit: '#a89f8f', spk: '#8d8577' };
      const cool = { dark: '#565c63', mid: '#747b83', lit: '#9aa2ab', spk: '#848b93' };
      if (v === 0) {
        haze(30, 26, 66); haze(58, 30, 60);
        peak(20, 30, 46, warm);
        peak(56, 6, 56, warm);
        peak(37, 44, 36, { dark: '#544f46', mid: '#6e675c', lit: '#948b7b', spk: '#7e7669' });
      } else {
        haze(46, 22, 78);
        peak(60, 26, 48, cool);
        peak(25, 4, 58, cool);
        peak(44, 48, 32, { dark: '#4d5257', mid: '#676d74', lit: '#8b939b', spk: '#767d85' });
      }

      // foothill fringe: mossy mounds, scree, and a stand of pines
      g.fillStyle = '#57724d';
      for (let x = -6; x < W + 6; x += 9) {
        const r = 6 + R() * 5;
        g.beginPath(); g.ellipse(x + 4, baseY + 4, r, r * 0.55, 0, 0, 7); g.fill();
      }
      p.dither(2, baseY - 8, W - 4, 9, '#6e695f', 0.22, R);
      p.dither(0, baseY - 2, W, 9, '#4c6344', 0.30, R);
      const pine = (x, y) => {
        g.fillStyle = '#2e4b34';
        for (let i = 0; i < 3; i++) {
          const w2 = 5 - i * 1.4, y2 = y - i * 2.6;
          g.beginPath(); g.moveTo(x, y2 - 3); g.lineTo(x - w2 / 2, y2); g.lineTo(x + w2 / 2, y2); g.closePath(); g.fill();
        }
        g.fillStyle = '#5d4630'; g.fillRect(x - 0.5, y + 0.5, 1, 2);
      };
      for (let i = 0; i < 9; i++) pine(4 + R() * (W - 8), baseY + 1 + R() * 5);

      // winding hiking trail up the tallest peak
      const main = peaks.reduce((a, b) => (a[1] < b[1] ? a : b));
      g.strokeStyle = 'rgba(214,199,164,0.55)'; g.lineWidth = 1;
      g.beginPath();
      g.moveTo(main[0] + 16, H - 8);
      g.quadraticCurveTo(main[0] - 18, H - 34, main[0] + 10, H - 52);
      g.quadraticCurveTo(main[0] + 20, main[1] + 26, main[0], main[1] + 6);
      g.stroke();

      this.mountains.push({ img: p.c, oy: EX, peaks });
    }
    this.mountain = this.mountains[0];
  },

  makeCars() {
    const cols = ['#e05a5a', '#4f9ed0', '#f2c14f', '#5fae62', '#c8ccd4', '#8a6fc0', '#e08a3c', '#4a4f58'];
    for (const c of cols) {
      // horizontal (facing E — same used for W)
      let p = new P(12, 8);
      p.rect(0, 2, 12, 4, c); p.fr(0, 2, 12, 4, shade(c, -0.5));
      p.rect(3, 1, 6, 2, c); p.rect(4, 1, 4, 2, '#bfe0ef');
      p.px(0, 3, '#fff2b0'); p.px(11, 3, '#e88'); // lights
      p.rect(2, 6, 2, 2, '#2c2c30'); p.rect(8, 6, 2, 2, '#2c2c30');
      const h = p.c;
      // vertical (facing S — same used for N)
      p = new P(8, 12);
      p.rect(2, 0, 4, 12, c); p.fr(2, 0, 4, 12, shade(c, -0.5));
      p.rect(1, 3, 6, 6, c); p.rect(3, 3, 2, 5, '#bfe0ef');
      p.rect(0, 2, 2, 2, '#2c2c30'); p.rect(6, 2, 2, 2, '#2c2c30');
      p.rect(0, 8, 2, 2, '#2c2c30'); p.rect(6, 8, 2, 2, '#2c2c30');
      this._cars.push({ h, v: p.c });
    }
  },
  car(seed) { return this._cars[seed % this._cars.length]; },

  /* soft radial light disc — used to punch holes in the darkness layer */
  makeGlow() {
    const S = 64;
    const [c, g] = mkCanvas(S, S);
    const grad = g.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.42)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, S, S);
    this.glow = c;
    // pre-tinted color glows
    this.glowTints = {};
    for (const [name, col] of [['warm', '#ffca7a'], ['orange', '#ff9040'], ['red', '#ff5050'],
                               ['blue', '#5090ff'], ['green', '#a0ff90'], ['pink', '#ff80c0'], ['cool', '#bcd8ff']]) {
      const [tc, tg] = mkCanvas(S, S);
      tg.drawImage(c, 0, 0);
      tg.globalCompositeOperation = 'source-in';
      tg.fillStyle = col; tg.fillRect(0, 0, S, S);
      this.glowTints[name] = tc;
    }
  },

  makeLamp() {
    const p = new P(5, 14);
    p.vl(2, 3, 11, '#3c4048');
    p.rect(1, 0, 3, 4, '#2e323a'); p.fr(1, 0, 3, 4, '#1e2228');
    p.px(2, 1, '#ffd88a'); p.px(2, 2, '#f2c060');
    this.lamp = p.c;
  },

  makePuddles() {
    this.puddles = [];
    const dims = [[10, 6], [14, 8], [8, 5]];
    for (let i = 0; i < 3; i++) {
      const [w, h] = dims[i];
      const [c, g] = mkCanvas(w, h);
      g.fillStyle = '#5a7590';
      g.beginPath(); g.ellipse(w / 2, h / 2, w / 2 - 0.5, h / 2 - 0.5, 0, 0, 7); g.fill();
      g.fillStyle = '#7c99b4';
      g.beginPath(); g.ellipse(w / 2 - 1, h / 2 - 1, w / 3, h / 3, 0, 0, 7); g.fill();
      g.fillStyle = 'rgba(220,235,248,0.8)';
      g.fillRect(Math.floor(w / 2), Math.floor(h / 2) - 1, 2, 1);
      this.puddles.push(c);
    }
  },

  makePolice() {
    const mk2 = (flash) => {
      let p = new P(12, 8); // horizontal
      p.rect(0, 2, 12, 4, '#e8eaee'); p.fr(0, 2, 12, 4, '#26282e');
      p.rect(3, 1, 6, 2, '#26282e'); p.rect(4, 1, 4, 2, '#9cc4dc');
      p.rect(0, 4, 12, 2, '#26282e');
      p.px(5, 0, flash ? '#ff4040' : '#4070ff'); p.px(6, 0, flash ? '#4070ff' : '#ff4040');
      p.rect(2, 6, 2, 2, '#141418'); p.rect(8, 6, 2, 2, '#141418');
      const h = p.c;
      p = new P(8, 12); // vertical
      p.rect(2, 0, 4, 12, '#e8eaee'); p.fr(2, 0, 4, 12, '#26282e');
      p.rect(1, 3, 6, 6, '#e8eaee'); p.rect(3, 3, 2, 5, '#9cc4dc');
      p.rect(2, 8, 4, 3, '#26282e');
      p.px(3, 5, flash ? '#ff4040' : '#4070ff'); p.px(4, 5, flash ? '#4070ff' : '#ff4040');
      p.rect(0, 2, 2, 2, '#141418'); p.rect(6, 2, 2, 2, '#141418');
      p.rect(0, 8, 2, 2, '#141418'); p.rect(6, 8, 2, 2, '#141418');
      return { h, v: p.c };
    };
    this.policeCar = [mk2(false), mk2(true)];
  },

  makeCritters() {
    // dog: 2 trotting frames
    this.dog = [];
    for (let f = 0; f < 2; f++) {
      const p = new P(7, 5);
      const col = '#a4783c';
      p.rect(1, 1, 5, 2, col);
      p.rect(5, 0, 2, 2, col); p.px(6, 0, '#7c5628');           // head + ear
      p.px(0, 0 + f, col);                                       // tail wag
      if (f === 0) { p.px(1, 3, '#7c5628'); p.px(5, 4, '#7c5628'); }
      else { p.px(2, 4, '#7c5628'); p.px(4, 3, '#7c5628'); }
      this.dog.push(p.c);
    }
    // bird: 2 flap frames
    this.bird = [];
    for (let f = 0; f < 2; f++) {
      const p = new P(7, 4);
      p.px(3, 2, '#3a3e46');
      if (f === 0) { p.px(1, 0, '#3a3e46'); p.px(2, 1, '#3a3e46'); p.px(4, 1, '#3a3e46'); p.px(5, 0, '#3a3e46'); }
      else { p.px(1, 3, '#3a3e46'); p.px(2, 2, '#3a3e46'); p.px(4, 2, '#3a3e46'); p.px(5, 3, '#3a3e46'); }
      this.bird.push(p.c);
    }
  },

  /* small ground props per season: tuft, rock, flower clump, bush */
  makeDecor() {
    this.decor = [];
    const flowerCols = [['#f2b8cc', '#ffffff'], ['#f2d94f', '#e0704f'], ['#c8a040', '#b05a2c'], null];
    const bushCols = [['#548c40', '#68a04e'], ['#4a8038', '#5e9446'], ['#a06a30', '#b8823e'], null];
    let p;
    for (let s = 0; s < 4; s++) {
      const set = {};
      p = new P(6, 5); // tuft
      if (s === 3) { p.disc(3, 3, 2, '#f4f7fb'); p.px(2, 4, '#d8e2ec'); }
      else {
        const c = ['#6da24e', '#5f9846', '#8a9a4a'][s];
        p.vl(1, 1, 4, c); p.vl(3, 0, 5, c); p.vl(5, 2, 3, c); p.px(2, 3, shade(c, 0.15)); p.px(4, 2, shade(c, 0.15));
      }
      set.tuft = p.c;
      p = new P(6, 4); // rocks
      p.disc(2, 2, 2, '#a09a90'); p.px(1, 1, '#b8b2a8'); p.disc(5, 3, 1, '#8e887e');
      set.rock = p.c;
      if (flowerCols[s]) {
        p = new P(8, 6);
        const [c1, c2] = flowerCols[s];
        p.px(1, 2, c1); p.px(2, 1, c1); p.px(2, 3, c1); p.px(3, 2, c2);
        p.px(6, 4, c2); p.px(5, 3, c1); p.px(6, 2, c1);
        p.px(2, 5, '#5f9846'); p.px(6, 5, '#5f9846');
        set.flower = p.c;
      }
      p = new P(9, 7); // bush
      if (s === 3) {
        p.vl(4, 2, 5, '#6b4a2f'); p.vl(2, 4, 3, '#5d3f28'); p.vl(6, 3, 4, '#5d3f28');
        p.px(2, 3, '#f4f7fb'); p.px(6, 2, '#f4f7fb'); p.px(4, 1, '#f4f7fb');
      } else {
        const [d, l] = bushCols[s];
        p.disc(4, 4, 3, d); p.disc(3, 3, 2, l); p.px(6, 3, l);
      }
      set.bush = p.c;
      this.decor.push(set);
    }
    // duck (2 bob frames)
    this.duck = [];
    for (let f = 0; f < 2; f++) {
      p = new P(7, 6);
      p.rect(1, 2 + f, 4, 2, '#e6e0d0');           // body
      p.px(1, 1 + f, '#8a6a45');                    // tail
      p.rect(4, 0 + f, 2, 2, '#3a7a4a');            // head
      p.px(6, 1 + f, '#e0862c');                    // beak
      p.px(4, 0 + f, '#2c5e38');
      this.duck.push(p.c);
    }
    // butterfly (wings open / closed)
    this.butterfly = [];
    for (const cols of [['#f2e8ff', '#e0c0ff'], ['#fff2c0', '#f2c14f'], ['#ffd0c0', '#e0704f']]) {
      const frames = [];
      p = new P(5, 4);
      p.px(1, 1, cols[0]); p.px(3, 1, cols[0]); p.px(1, 2, cols[1]); p.px(3, 2, cols[1]); p.px(2, 1, '#4a4038'); p.px(2, 2, '#4a4038');
      frames.push(p.c);
      p = new P(5, 4);
      p.px(2, 1, '#4a4038'); p.px(2, 2, '#4a4038'); p.px(1, 1, cols[1]); p.px(3, 2, cols[0]);
      frames.push(p.c);
      this.butterfly.push(frames);
    }
  },

  makeUmbrellas() {
    this.umbrellas = [];
    for (const col of ['#e05a5a', '#4f9ed0', '#f2c14f', '#8a6fc0']) {
      const p = new P(9, 5);
      p.disc(4, 4, 4, col);
      p.rect(0, 4, 9, 1, shade(col, -0.25));
      p.g.clearRect(0, 5, 9, 4);
      this.umbrellas.push(p.c);
    }
  },

  person(kind, seed) {
    const key = kind + ':' + (seed % 8);
    if (this._people.has(key)) return this._people.get(key);
    const R = mulberry32(seed * 131 + hashStr(kind));
    const skins = ['#f2c9a0', '#e0a878', '#b07a4a', '#8a5a35'];
    const shirts = ['#e05a5a', '#4f9ed0', '#5fae62', '#f2c14f', '#c05fa8', '#7c5f8e', '#e08a3c', '#4fc0b0'];
    const hairs = ['#3a2c20', '#6b4a2f', '#c8a050', '#8a8f96', '#4a3548'];
    let skin = skins[Math.floor(R() * skins.length)];
    let shirt = shirts[Math.floor(R() * shirts.length)];
    let hair = hairs[Math.floor(R() * hairs.length)];
    let pants = kind === 'woman' ? shade(shirt, -0.3) : '#3f4a5a';
    if (kind === 'burglar') { shirt = '#23252d'; hair = '#16181e'; pants = '#1c1e26'; skin = '#c9a583'; }
    if (kind === 'hiker') { shirt = ['#d9542c', '#2c8ad9', '#3aa050'][seed % 3]; pants = '#5a4a38'; }
    const kid = kind === 'kid';
    const w = 6, h = kid ? 7 : 9;
    const frames = [];
    for (let f = 0; f < 2; f++) {
      const p = new P(w, h);
      const hy = 0;
      p.rect(1, hy, 4, 3, skin);               // head
      p.rect(1, hy, 4, 1, hair);               // hair top
      p.px(1, hy + 1, hair);
      if (kind === 'woman') { p.px(4, hy + 1, hair); p.px(0, hy + 2, hair); p.px(5, hy + 2, hair); }
      p.rect(1, hy + 3, 4, kid ? 2 : 3, shirt); // body
      const ly = hy + 3 + (kid ? 2 : 3);
      if (f === 0) { p.rect(1, ly, 2, h - ly, pants); p.rect(3, ly, 2, h - ly - 1, pants); }
      else { p.rect(1, ly, 2, h - ly - 1, pants); p.rect(3, ly, 2, h - ly, pants); }
      frames.push(p.c);
    }
    const out = { f: frames, w, h };
    this._people.set(key, out);
    return out;
  }
};
