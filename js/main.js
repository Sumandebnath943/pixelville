/* ============================================================
   PixelVille — renderer, lighting, camera, input, UI.
   Render order:
     ground → puddles → lamps/entities (+shadows) → smoke →
     cloud shadows → dusk tint → darkness w/ punched lights →
     emissive layer (windows, torches, fireflies) → precip → UI
   ============================================================ */
'use strict';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const UI = {
  zoom: 2, camX: 0, camY: 0,
  speedIdx: 1, speeds: [0, 1, 3, 8],
  tool: null, hover: null, dragStart: null,
  panning: false, panStart: null,
  selected: null,
  waterTiles: [], staticEnts: [], lampSpots: [], smoke: [],
  groundCanvas: null, groundCtx: null,
  nightCanvas: null, nightCtx: null,
  lights: [],
  lastStats: 0, lastSeason: -1,
};

/* =============== ground layer (seasonal) =============== */
function rebuildGround() {
  if (!UI.groundCanvas) {
    UI.groundCanvas = document.createElement('canvas');
    UI.groundCanvas.width = GW * T; UI.groundCanvas.height = GH * T;
    UI.groundCtx = UI.groundCanvas.getContext('2d');
    UI.groundCtx.imageSmoothingEnabled = false;
  }
  const g = UI.groundCtx;
  const season = Weather.season;
  const winter = season === 3;
  const grassSet = SPR.grassSeasons[season];
  const decor = SPR.decor[season];
  UI.waterTiles = []; UI.lampSpots = [];
  const treePx = [];
  const h2 = (x, y) => (((x * 374761393 + y * 668265263) ^ ((x * 374761393 + y * 668265263) >>> 13)) >>> 0);

  const drought = typeof Calamity !== 'undefined' && Calamity.droughtLevel >= 0.5;
  const sandSpots = [];
  const snowmenSpots = [];

  /* pass 1 — base terrain + procedural ground props */
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const i = World.idx(x, y), gr = World.ground[i];
    if (gr === G_WATER) {
      if (drought && !winter) {
        g.drawImage(SPR.dryBed, x * T, y * T); // the drought drank the river
      } else if (winter) {
        g.drawImage(SPR.iceTile, x * T, y * T);
      } else {
        g.drawImage(SPR.waterFrames[0], x * T, y * T);
        UI.waterTiles.push([x, y]);
        g.fillStyle = '#bfe3fa';
        const land = (xx, yy) => World.inB(xx, yy) && World.ground[World.idx(xx, yy)] !== G_WATER;
        if (land(x, y - 1)) g.fillRect(x * T, y * T, T, 1);
        if (land(x, y + 1)) g.fillRect(x * T, y * T + T - 1, T, 1);
        if (land(x - 1, y)) g.fillRect(x * T, y * T, 1, T);
        if (land(x + 1, y)) g.fillRect(x * T + T - 1, y * T, 1, T);
      }
    } else if (gr === G_SAND) {
      const hh = h2(x, y);
      g.drawImage(SPR.sandTiles[hh % 4], x * T, y * T);
      if (winter) { g.fillStyle = 'rgba(238,243,248,0.45)'; g.fillRect(x * T, y * T, T, T); }
      else if (!World.roadMap[i] && !World.bmap[i] && !World.railMap[i]) sandSpots.push([x, y]);
    } else if (gr === G_ROCK) {
      // rock ground reads as scree-dusted meadow — the massif SPRITE carries
      // the drama, so no grey slab peeks out beside the peaks
      g.drawImage(grassSet[h2(x, y) % 4], x * T, y * T);
      const nearGrass = [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([ddx, ddy]) =>
        World.inB(x + ddx, y + ddy) && World.ground[World.idx(x + ddx, y + ddy)] === G_GRASS);
      g.globalAlpha = nearGrass ? 0.14 : 0.28;
      g.drawImage(SPR.rockTile, x * T, y * T);
      g.globalAlpha = 1;
      if (winter) { g.fillStyle = 'rgba(238,243,248,0.35)'; g.fillRect(x * T, y * T, T, T); }
    } else {
      const hh = h2(x, y);
      g.drawImage(grassSet[hh % 4], x * T, y * T);
      // scattered props on open grass
      if (!World.tree[i] && !World.roadMap[i] && !World.bmap[i]) {
        if (winter && hh % 47 === 0) snowmenSpots.push([x, y]); // the kids have been busy
        if (hh % 71 === 0) { // worn dirt patch
          g.fillStyle = winter ? 'rgba(210,220,232,0.5)' : 'rgba(150,124,80,0.28)';
          g.beginPath(); g.ellipse(x * T + 8, y * T + 8, 6, 4, 0, 0, 7); g.fill();
        }
        if (hh % 19 === 0) g.drawImage(decor.tuft, x * T + (hh % 9), y * T + (hh % 7) + 3);
        else if (hh % 43 === 0) g.drawImage(decor.rock, x * T + (hh % 8), y * T + (hh % 6) + 4);
        else if (decor.flower && hh % 29 === 0) g.drawImage(decor.flower, x * T + (hh % 7), y * T + (hh % 8) + 2);
        else if (hh % 61 === 0) g.drawImage(decor.bush, x * T + (hh % 6), y * T + (hh % 5) + 4);
      }
    }
    if (World.tree[i]) treePx.push([x * T + 8, y * T + 8]);
  }

  /* pass 2 — building plots: yards, fences, pavement aprons */
  for (const b of World.buildings) {
    const d = CAT[b.type];
    const px0 = b.x * T - 3, py0 = b.y * T - 3, pw = b.w * T + 6, ph = b.h * T + 6;
    if (d.cat === 'res') {
      g.fillStyle = winter ? 'rgba(238,243,250,0.4)' : 'rgba(158,203,116,0.55)';
      g.fillRect(px0, py0, pw, ph);
      g.strokeStyle = 'rgba(122,94,58,0.85)'; g.lineWidth = 1;
      g.strokeRect(px0 + 0.5, py0 + 0.5, pw - 1, ph - 1);
      g.fillStyle = '#a5824f';
      for (let fx = px0; fx <= px0 + pw - 2; fx += 4) { g.fillRect(fx, py0 - 1, 1, 3); g.fillRect(fx, py0 + ph - 2, 1, 3); }
      for (let fy = py0; fy <= py0 + ph - 2; fy += 4) { g.fillRect(px0 - 1, fy, 1, 1); g.fillRect(px0 + pw, fy, 1, 1); }
      if (!winter) { // front-garden flowers
        const hh = h2(b.x, b.y);
        const cols = ['#f2b8cc', '#f2d94f', '#ffffff', '#e0704f'];
        for (let k = 0; k < 4; k++)
          g.fillStyle = cols[(hh + k) % 4], g.fillRect(px0 + 3 + ((hh >> k) % (pw - 6)), py0 + ph - 4, 1, 1);
      }
    } else if (d.cat === 'shop' || d.cat === 'civic' || d.cat === 'work' && b.type === 'office' || d.cat === 'leisure' && !d.noroof) {
      g.fillStyle = winter ? 'rgba(225,231,240,0.75)' : 'rgba(203,199,184,0.8)';
      g.fillRect(px0, py0, pw, ph);
      g.strokeStyle = 'rgba(140,136,122,0.8)';
      g.strokeRect(px0 + 0.5, py0 + 0.5, pw - 1, ph - 1);
    } else if (b.type === 'factory') {
      g.fillStyle = 'rgba(120,114,102,0.5)';
      g.fillRect(px0, py0, pw, ph);
    }
  }

  /* pass 3 — roads over everything, with crosswalks, manholes & signals */
  const popcount = m => ((m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1));
  World.signals.clear();
  UI.signalHeads = [];
  const is4way = (xx, yy) => World.isRoad(xx, yy) && popcount(World.roadMask(xx, yy)) === 4;
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const i = World.idx(x, y);
    if (!World.roadMap[i]) continue;
    const gr = World.ground[i];
    const m = World.roadMask(x, y);
    // traffic lights ONLY at true avenue crossings (a full 2x2 block of
    // 4-way tiles — every side-street T-junction stays unsignalled), and
    // never two signalled junctions within a dozen tiles of each other.
    // Each junction gets TWO posts on opposite corner pavements: the
    // north-west post shows the north–south aspect, the south-east post
    // the east–west aspect, so what you read matches what traffic does.
    if (popcount(m) === 4 && !is4way(x - 1, y) && !is4way(x, y - 1) &&
        is4way(x + 1, y) && is4way(x, y + 1) && is4way(x + 1, y + 1)) {
      let spaced = true;
      for (const [hx, hy] of UI.signalHeads)
        if (Math.abs(hx - x) + Math.abs(hy - y) < 12) { spaced = false; break; }
      if (spaced) {
        const free = (cx2, cy2) => World.inB(cx2, cy2) && !World.isRoad(cx2, cy2) &&
          !World.bmap[World.idx(cx2, cy2)] && World.ground[World.idx(cx2, cy2)] !== G_WATER;
        let placedAny = false;
        if (free(x - 1, y - 1)) { UI.signalHeads.push([x - 1, y - 1, 0]); placedAny = true; } // NS aspect
        if (free(x + 2, y + 2)) { UI.signalHeads.push([x + 2, y + 2, 1]); placedAny = true; } // EW aspect
        if (placedAny) {
          World.signals.add(i);
          World.signals.add(World.idx(x + 1, y));
          World.signals.add(World.idx(x, y + 1));
          World.signals.add(World.idx(x + 1, y + 1));
        }
      }
    }
    if (gr === G_WATER) { g.drawImage((m & 10) ? SPR.bridgeH : SPR.bridgeV, x * T, y * T); }
    else {
      g.drawImage(SPR.roads[m], x * T, y * T);
      const hh = h2(x, y);
      // crosswalk stripes on straights that touch a junction
      const junc = (xx, yy) => World.isRoad(xx, yy) && popcount(World.roadMask(xx, yy)) >= 3;
      g.fillStyle = 'rgba(236,232,216,0.85)';
      if (m === 5) { // vertical road
        if (junc(x, y - 1)) for (let s = 4; s <= 11; s += 3) g.fillRect(x * T + s, y * T + 1, 2, 3);
        else if (junc(x, y + 1)) for (let s = 4; s <= 11; s += 3) g.fillRect(x * T + s, y * T + T - 4, 2, 3);
        else if (hh % 13 === 0) { g.fillStyle = '#565a62'; g.beginPath(); g.arc(x * T + 8, y * T + 8, 2, 0, 7); g.fill(); }
      } else if (m === 10) { // horizontal road
        if (junc(x - 1, y)) for (let s = 4; s <= 11; s += 3) g.fillRect(x * T + 1, y * T + s, 3, 2);
        else if (junc(x + 1, y)) for (let s = 4; s <= 11; s += 3) g.fillRect(x * T + T - 4, y * T + s, 3, 2);
        else if (hh % 13 === 0) { g.fillStyle = '#565a62'; g.beginPath(); g.arc(x * T + 8, y * T + 8, 2, 0, 7); g.fill(); }
      }
      if (winter) { g.fillStyle = 'rgba(238,243,248,0.16)'; g.fillRect(x * T, y * T, T, T); }
    }
    // street lamps: REGULAR spacing along the outer edges of every road,
    // alternating sides every half-interval — never in the traffic lanes
    // (avenue edge tiles carry 3 road neighbours, so only true 4-way
    // intersections and level crossings go without a post)
    if (gr !== G_WATER && popcount(m) !== 4 && !World.railMap[i]) {
      const horiz = (m & 10) !== 0, vert = (m & 5) !== 0;
      if (horiz && !World.isRoad(x, y - 1) && x % 6 === 0) UI.lampSpots.push([x, y, 0]);      // north kerb
      else if (horiz && !World.isRoad(x, y + 1) && x % 6 === 3) UI.lampSpots.push([x, y, 1]); // south kerb
      else if (vert && !World.isRoad(x - 1, y) && y % 6 === 0) UI.lampSpots.push([x, y, 2]);  // west kerb
      else if (vert && !World.isRoad(x + 1, y) && y % 6 === 3) UI.lampSpots.push([x, y, 3]);  // east kerb
    }
  }

  /* pass 3.5 — railway tracks: ballast on grass, bare rails over level
     crossings, wooden trestle bridges across open water */
  World.crossings.clear();
  UI.crossingSpots = [];
  UI.railSignalSpots = [];
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const i = World.idx(x, y);
    if (!World.railMap[i]) continue;
    const m = World.railMask(x, y);
    if (World.ground[i] === G_WATER && !World.roadMap[i]) {
      g.drawImage(SPR.railTrestle, x * T, y * T);
      g.drawImage(SPR.railsBare[m], x * T, y * T);
    } else {
      g.drawImage(World.roadMap[i] ? SPR.railsBare[m] : SPR.rails[m], x * T, y * T);
      if (World.roadMap[i]) { // level crossing: gates + blinkers animate at render time
        World.crossings.add(i);
        UI.crossingSpots.push([x, y, (m & 5) ? 1 : 0]); // 1 = rail runs north–south
      } else if ((m === 5 || m === 10) && (x * 13 + y * 7) % 9 === 0) {
        UI.railSignalSpots.push([x, y, m === 5 ? 1 : 0]); // line-side signals on straights
      }
    }
  }

  // share terrain info with the ambient-life module
  Life.waterTiles = UI.waterTiles;
  Life.sandTiles = sandSpots;
  Life.edgeRoads = [];
  for (let x = 0; x < GW; x++) for (const y of [0, 1, GH - 2, GH - 1])
    if (World.isRoad(x, y)) Life.edgeRoads.push([x, y]);
  for (let y = 0; y < GH; y++) for (const x of [0, 1, GW - 2, GW - 1])
    if (World.isRoad(x, y)) Life.edgeRoads.push([x, y]);

  // static entities, painter-sorted
  UI.staticEnts = [];
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const tv = World.tree[World.idx(x, y)];
    if (tv) UI.staticEnts.push({ kind: 'tree', x, y, v: tv - 1, base: y * T + T });
  }
  for (const m of World.mountains)
    UI.staticEnts.push({ kind: 'mtn', x: m.x, y: m.y, v: (m.v || 0) % SPR.mountains.length, base: (m.y + MSIZE) * T, m });
  for (const b of World.buildings)
    UI.staticEnts.push({ kind: 'bld', b, x: b.x, base: (b.y + b.h) * T });
  for (const [sx, sy] of snowmenSpots)
    UI.staticEnts.push({ kind: 'snowman', x: sx, y: sy, base: sy * T + T });
  UI.staticEnts.sort((a, b) => a.base - b.base);

  // firefly homes: a sample of tree spots
  Life.fireflySpots = [];
  for (let i = 0; i < treePx.length && Life.fireflySpots.length < 70; i += Math.max(1, (treePx.length / 70) | 0))
    Life.fireflySpots.push({ x: treePx[i][0], y: treePx[i][1], ph: (i * 0.7) % 6.28 });

  World.dirty = false;
}

/* =============== day / night =============== */
function darkness() {
  const h = Sim.clock / 60;
  let d;
  if (h >= 7 && h < 17) d = 0;
  else if (h >= 17 && h < 20.5) d = (h - 17) / 3.5 * 0.78;
  else if (h >= 20.5 || h < 4.5) d = 0.78;
  else d = (7 - h) / 2.5 * 0.78;
  return Math.min(0.85, d + Weather.gloom());
}
function duskTint() {
  const h = Sim.clock / 60;
  if (h >= 17 && h < 19.5) return 0.14 * (1 - Math.abs(h - 18.2) / 1.3);
  if (h >= 5 && h < 7) return 0.12 * (1 - Math.abs(h - 6) / 1);
  return 0;
}

/* how lit a building is right now (0..1): shops go dark after closing,
   homes wind down for the night with only the odd porch light, and
   24-hour services never sleep. Street lamps are handled separately.
   Festival nights override the rules: Christmas month keeps every
   building aglow, and on Diwali every window burns bright. */
function buildingLit(b) {
  let lf = buildingLitBase(b);
  if (typeof Festivals !== 'undefined' && !b.construction && !b.ruined) {
    if (Festivals.decorated() && (Sim.clock >= 990 || Sim.clock < 330)) lf = Math.max(lf, 0.55);
    if (Festivals.diyasTonight() && (Sim.clock >= 1050 || Sim.clock < 270)) lf = Math.max(lf, 0.95);
  }
  return lf;
}
function buildingLitBase(b) {
  const d = CAT[b.type];
  if (b.construction > 0 || b.ruined) return 0;
  const c = Sim.clock;
  if (d.res) {
    if (!b.residents.length) return 0;
    if (c >= 1410 || c < 300) return (b.id % 4 === 0) ? 0.3 : 0; // deep night: nearly all asleep
    if (c >= 1350) return (b.id % 2 === 0) ? 0.55 : 0.12;        // 22:30–23:30, winding down
    if (c >= 1020 || c < 420) return 1;                          // evenings & early risers
    return 0.3;
  }
  if (d.hours && d.hours.s === 0 && d.hours.e === 1440) return 1; // 24h services
  // office towers burn the evening oil: late shifts, cleaners, lobby lights
  if (b.type === 'skyscraper' || b.type === 'office' || b.type === 'exchange') {
    if (c >= 1410 || c < 300) return 0.4;  // a scatter of floors all night
    if (c >= 1020) return 0.85;            // the evening glow of a working tower
  }
  if (d.hours) {
    const open = c >= d.hours.s - 45 && c <= d.hours.e + 45;
    return open ? 1 : (b.id % 6 === 0 ? 0.18 : 0); // the odd security light
  }
  return 0.35;
}

/* =============== render =============== */
let lastFrameT = 0;
function render(now) {
  const dtReal = Math.min(0.08, (now - lastFrameT) / 1000 || 0.016);
  lastFrameT = now;
  const z = UI.zoom;
  // earthquake camera shake: jolt the camera, restore it at the end of the frame
  let shakeRX = 0, shakeRY = 0;
  if (typeof Calamity !== 'undefined' && Calamity.shakeT > 0) {
    const amp = Math.min(1, Calamity.shakeT) * 3.5;
    shakeRX = (Math.random() - 0.5) * amp * 2;
    shakeRY = (Math.random() - 0.5) * amp * 2;
    UI.camX += shakeRX; UI.camY += shakeRY;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = Weather.season === 3 ? '#1c2734' : '#22402c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(z, 0, 0, z, -UI.camX * z, -UI.camY * z);
  ctx.imageSmoothingEnabled = false;

  if (World.dirty || UI.lastSeason !== Weather.season) { UI.lastSeason = Weather.season; rebuildGround(); }
  ctx.drawImage(UI.groundCanvas, 0, 0);

  const vx0 = Math.floor(UI.camX / T) - 2, vy0 = Math.floor(UI.camY / T) - 2;
  const vx1 = vx0 + Math.ceil(canvas.width / z / T) + 8, vy1 = vy0 + Math.ceil(canvas.height / z / T) + 10;
  const dark = darkness();
  UI.lights = [];

  Weather.renderPuddles(ctx, vx0, vy0, vx1, vy1);

  // flood water over the streets
  if (typeof Calamity !== 'undefined' && Calamity.flooded.size) {
    ctx.fillStyle = 'rgba(72,130,190,0.55)';
    for (const fi of Calamity.flooded) {
      const fx = fi % GW, fy = (fi / GW) | 0;
      if (fx < vx0 || fx > vx1 || fy < vy0 || fy > vy1) continue;
      ctx.fillRect(fx * T, fy * T, T, T);
    }
    if (Math.floor(now / 600) % 2) { // glints on the moving water
      ctx.fillStyle = 'rgba(190,225,250,0.45)';
      for (const fi of Calamity.flooded) {
        const fx = fi % GW, fy = (fi / GW) | 0;
        if (fx < vx0 || fx > vx1 || fy < vy0 || fy > vy1) continue;
        if ((fx * 7 + fy * 13) % 5 === 0) ctx.fillRect(fx * T + 3, fy * T + 5, 4, 1);
      }
    }
  }

  // water shimmer (not on ice)
  if (Weather.season !== 3 && Math.floor(now / 550) % 2 === 1) {
    ctx.fillStyle = 'rgba(190,225,250,0.5)';
    for (const [x, y] of UI.waterTiles) {
      if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
      const s = (x * 7 + y * 13) % 4;
      ctx.fillRect(x * T + 2 + s * 3, y * T + 3 + ((x + y) % 3) * 4, 3, 1);
    }
  }

  // street lamp posts on the kerbs (dressed up on festival days)
  const xmasNow = typeof Festivals !== 'undefined' && Festivals.decorated();
  const diwaliNow = typeof Festivals !== 'undefined' && Festivals.diyasTonight();
  for (const [x, y, side] of UI.lampSpots) {
    if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
    // base sits on the sidewalk strip of its side of the road
    const px = side === 2 ? x * T - 1 : side === 3 ? x * T + 12 : x * T + 6;
    const py = side === 0 ? y * T - 11 : side === 1 ? y * T + 2 : y * T - 5;
    ctx.drawImage(SPR.lamp, px, py);
    if (xmasNow) { // garland wraps + red bow + a swag of coloured bulbs
      const gcols = ['#ff6060', '#ffd160', '#60c0ff', '#80ff90'];
      ctx.fillStyle = '#2e6b38';
      ctx.fillRect(px + 1, py + 2, 1, 1); ctx.fillRect(px + 3, py + 5, 1, 1); ctx.fillRect(px + 1, py + 8, 1, 1);
      ctx.fillStyle = '#c0392b'; ctx.fillRect(px + 1, py, 3, 2); // bow
      for (let k = 0; k < 4; k++) {
        ctx.fillStyle = gcols[(k + Math.floor(now / 500)) % 4];
        ctx.fillRect(px - 2 - k * 2, py + 2 + Math.round(Math.sin(k * 1.2) * 2), 1, 1);
      }
    }
    if (diwaliNow) { // marigold garland
      ctx.fillStyle = '#e8962c'; ctx.fillRect(px + 1, py + 2, 3, 1);
      ctx.fillStyle = '#f2c14f'; ctx.fillRect(px + 1, py + 4, 3, 1);
    }
    if (dark > 0.1) UI.lights.push({ x: px + 2, y: py + 2, r: 24, a: 0.85, tint: 'warm' });
  }

  // traffic lights at avenue intersections (cars genuinely obey them);
  // the phase runs on real time so it never strobes under fast-forward
  const nsGreen = World.nsGreen();
  for (const [x, y, dctl] of UI.signalHeads || []) {
    if (x < vx0 - 1 || x > vx1 || y < vy0 - 1 || y > vy1) continue;
    // each post shows ONE aspect — the direction it controls
    const green = dctl === 0 ? nsGreen : !nsGreen;
    const px0 = x * T + 5, py0 = y * T - 4; // standing on its corner pavement
    ctx.fillStyle = '#3c4048'; ctx.fillRect(px0 + 2, py0 + 9, 1, 11);          // pole
    ctx.fillStyle = '#26282e'; ctx.fillRect(px0, py0, 5, 9);                    // head
    ctx.fillStyle = green ? '#4a1616' : '#ff5040'; ctx.fillRect(px0 + 1, py0 + 1, 3, 3); // red lamp
    ctx.fillStyle = green ? '#40e050' : '#143f1c'; ctx.fillRect(px0 + 1, py0 + 5, 3, 3); // green lamp
    if (dark > 0.15) UI.lights.push({ x: px0 + 2, y: py0 + (green ? 6 : 2), r: 7, a: 0.7, tint: green ? 'green' : 'red' });
  }

  // level-crossing gates: barriers drop and blinkers flash while a train is near
  for (const [x, y, railNS] of UI.crossingSpots || []) {
    if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
    const closed = Life.trainNearTile(x, y, 5);
    if (closed) {
      const blink = Math.floor(now / 260) % 2;
      ctx.fillStyle = '#e8e4cf';
      if (railNS) { // rail runs N–S: bars block the road on both sides of the track
        for (const gx of [x * T + 1, x * T + T - 3]) {
          ctx.fillRect(gx, y * T + 1, 2, T - 2);
          ctx.fillStyle = '#c65f4e';
          for (let sy2 = y * T + 2; sy2 < y * T + T - 2; sy2 += 4) ctx.fillRect(gx, sy2, 2, 2);
          ctx.fillStyle = '#e8e4cf';
        }
      } else {
        for (const gy of [y * T + 1, y * T + T - 3]) {
          ctx.fillRect(x * T + 1, gy, T - 2, 2);
          ctx.fillStyle = '#c65f4e';
          for (let sx2 = x * T + 2; sx2 < x * T + T - 2; sx2 += 4) ctx.fillRect(sx2, gy, 2, 2);
          ctx.fillStyle = '#e8e4cf';
        }
      }
      ctx.fillStyle = blink ? '#ff4040' : '#701818';
      ctx.fillRect(x * T + 1, y * T - 3, 2, 2); ctx.fillRect(x * T + T - 3, y * T - 3, 2, 2);
      if (dark > 0.15 && blink) UI.lights.push({ x: x * T + 8, y: y * T, r: 10, a: 0.8, tint: 'red' });
    }
  }

  // line-side railway signals: red while a train is in the block, green after
  for (const [x, y, vert] of UI.railSignalSpots || []) {
    if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
    const occupied = Life.trainNearTile(x, y, 8);
    const sx2 = vert ? x * T + T - 2 : x * T + 2, sy2 = vert ? y * T + 4 : y * T - 6;
    ctx.fillStyle = '#3c4048'; ctx.fillRect(sx2, sy2 + 2, 1, 6);
    ctx.fillStyle = '#26282e'; ctx.fillRect(sx2 - 1, sy2 - 2, 3, 5);
    ctx.fillStyle = occupied ? '#ff5040' : '#40e050';
    ctx.fillRect(sx2, sy2 - 1, 1, 2);
    if (dark > 0.2) UI.lights.push({ x: sx2, y: sy2, r: 6, a: 0.6, tint: occupied ? 'red' : 'green' });
  }

  // Diwali: little oil lamps line the streets themselves
  if (diwaliNow && dark > 0.2) {
    for (let ty2 = Math.max(0, vy0); ty2 <= Math.min(GH - 1, vy1); ty2++)
      for (let tx2 = Math.max(0, vx0); tx2 <= Math.min(GW - 1, vx1); tx2++) {
        const ri = World.idx(tx2, ty2);
        if (!World.roadMap[ri] || (tx2 * 7 + ty2 * 13) % 6 !== 0) continue;
        const flick = (tx2 + ty2 + Math.floor(now / 240)) % 3;
        ctx.fillStyle = flick ? '#ffd870' : '#ff9040';
        ctx.fillRect(tx2 * T + 2, ty2 * T + 2, 1, 1);
        ctx.fillRect(tx2 * T + T - 3, ty2 * T + T - 3, 1, 1);
        if ((tx2 * 31 + ty2 * 17) % 18 === 0)
          UI.lights.push({ x: tx2 * T + 8, y: ty2 * T + 8, r: 12, a: 0.5, tint: 'orange' });
      }
  }

  /* ---- entities (painter-sorted, with soft shadows) ---- */
  const ents = [];
  for (const e of UI.staticEnts) {
    const ex = e.x !== undefined ? e.x : 0;
    if (ex < vx0 - 8 || ex > vx1 || (e.base / T) < vy0 - 8 || (e.base / T) > vy1 + 8) continue;
    ents.push(e);
  }
  for (const p of Sim.travelers()) ents.push({ kind: 'agent', p, base: p.y + 4 });
  for (const h of Life.hikers) ents.push({ kind: 'hiker', h, base: h.y + 4 });
  if (Life.crime && Life.crime.burglar.phase !== 'rob')
    ents.push({ kind: 'burglar', B: Life.crime.burglar, base: Life.crime.burglar.y + 4 });
  for (const u of Life.police) ents.push({ kind: 'police', u, base: u.y + 4 });
  for (const u of Life.fireTrucks) ents.push({ kind: 'firetruck', u, base: u.y + 4 });
  if (Life.riot) Life.riot.crowd.forEach((r, ri) => ents.push({ kind: 'protester', r, ri, base: r.y + 4 }));
  if (Life.rally) Life.rally.crowd.forEach((r, ri) => ents.push({ kind: 'listener', r, ri, base: r.y + 4 }));
  if (Life.rally) ents.push({ kind: 'speaker', r: Life.rally, base: Life.rally.y + 5 });
  if (Life.disaster) for (const h of Life.disaster.helpers) {
    const f = Math.min(1, h.f), hx = h.sx + (h.tx - h.sx) * f, hy = h.sy + (h.ty - h.sy) * f;
    ents.push({ kind: 'runner', h, x: hx, y: hy, base: hy + 4 });
  }
  for (const bk of Life.buckets) for (const h of bk.helpers) {
    const f = Math.min(1, h.f), hx = h.sx + (h.tx - h.sx) * f, hy = h.sy + (h.ty - h.sy) * f;
    ents.push({ kind: 'runner', h, x: hx, y: hy, base: hy + 4, bucket: bk.b });
  }
  for (const g of Life.gawkers) {
    const f = Math.min(1, Math.max(0, g.f)), gx = g.sx + (g.tx - g.sx) * f, gy = g.sy + (g.ty - g.sy) * f;
    ents.push({ kind: 'runner', h: g, x: gx, y: gy, base: gy + 4 });
  }
  for (const tr of Life.tourists) if (tr.phase !== 'visit') ents.push({ kind: 'tourist', tr, base: tr.y + 4 });
  for (const dk of Life.ducks) ents.push({ kind: 'duck', dk, base: dk.y + 3 });
  // public transport & harbour life
  for (const bus of Life.buses) ents.push({ kind: 'bus', u: bus, base: bus.y + 4 });
  for (const train of Life.trains) {
    if (train.hidden) continue; // stabled outside its timetable window
    const nCars = train.cars || 3;
    for (let ci = 0; ci < nCars; ci++)
      ents.push({ kind: 'traincar', u: train, off: ci * 1.4, engine: ci === 0, base: train.y + 4 + ci * 0.01 });
  }
  for (const bt of Life.boats) ents.push({ kind: 'boat', u: bt, base: bt.y + 3 });
  if (typeof Calamity !== 'undefined') for (const rf of Calamity.rafts) ents.push({ kind: 'raft', u: rf, base: rf.y + 3 });
  for (const rp of Life.reporters) {
    const rf2 = Math.min(1, Math.max(0, rp.f));
    const rx = rp.sx + (rp.tx - rp.sx) * rf2, ry2 = rp.sy + (rp.ty - rp.sy) * rf2;
    ents.push({ kind: 'reporter', rp, x: rx, y: ry2, base: ry2 + 4 });
  }
  for (const bf of Life.beachfolk) ents.push({ kind: 'beach', bf, base: bf.y + 4 });
  if (typeof Festivals !== 'undefined') {
    if (Festivals.tree) ents.push({ kind: 'xmastree', ft: Festivals.tree, base: (Festivals.tree.y + 2) * T });
    for (const mk of Festivals.markets) ents.push({ kind: 'xmarket', mk, base: (mk.y + 4) * T });
    for (const cg of Festivals.carolers) ents.push({ kind: 'carolers', cg, base: cg.y + 4 });
    if (Festivals.santa) ents.push({ kind: 'santa', sn: Festivals.santa, base: Festivals.santa.y + 4 });
  }
  if (Life.ferry) ents.push({ kind: 'ferry', u: Life.ferry, base: Life.ferry.y + 5 });
  for (const cc of Life.campaignCars) ents.push({ kind: 'campcar', u: cc, base: cc.y + 4 });
  // campaign camps: tents with volunteers, one per candidate
  if (typeof Gov !== 'undefined' && Gov.campaign && Gov.campaign.camps)
    for (const cp of Gov.campaign.camps) ents.push({ kind: 'camp', cp, base: (cp.y + 1) * T });
  if (Life.votingBooths) ents.push({ kind: 'voting', vb: Life.votingBooths, base: Life.votingBooths.y + 14 });
  // waiting passengers at bus shelters
  if (Life.buses.length)
    for (const b of World.buildings)
      if (b.type === 'busstop' && b.connected && !b.construction && !b.ruined)
        ents.push({ kind: 'busqueue', b, base: (b.y + b.h) * T + 1 });
  ents.sort((a, b) => a.base - b.base);

  const frame = Math.floor(now / 160) % 2;
  const raining = Weather.isRaining();
  const shadow = (cx, cy, rx, ry) => {
    ctx.fillStyle = 'rgba(20,30,20,0.18)';
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, 7); ctx.fill();
  };

  for (const e of ents) {
    if (e.kind === 'tree') {
      const t = SPR.treeSeasons[Weather.season][e.v];
      shadow(e.x * T + 8, e.y * T + 14, 6, 2);
      const sway = Weather.season === 3 ? 0 : Math.round(Math.sin(now / 850 + e.x * 1.7 + e.y * 0.9));
      ctx.drawImage(t.img, e.x * T + sway, e.y * T - t.oy);
    } else if (e.kind === 'mtn') {
      // no cast ellipse: the massif's own blended skirt does the grounding
      const ms = SPR.mountains[e.v];
      ctx.drawImage(ms.img, e.x * T, e.y * T - ms.oy);
    } else if (e.kind === 'bld') {
      const b = e.b;
      if (b.construction > 0) { // building site: scaffold, crane, workers
        const st = SPR.site(b.w, b.h);
        ctx.drawImage(st.img, b.x * T, b.y * T - st.oy);
        const wf = Math.floor(now / 260) % 2;
        for (let k = 0; k < 2; k++) {
          const ws = SPR.person('hiker', b.id * 3 + k);
          ctx.drawImage(ws.f[(wf + k) % 2], b.x * T + 3 + k * (b.w * T - 12), b.y * T + b.h * T - 10 - ((wf + k) % 2));
        }
        continue;
      }
      if (b.ruined) {
        const rb = SPR.rubble(b.w, b.h);
        ctx.drawImage(rb.img, b.x * T, b.y * T);
        if ((b.id * 13 + Math.floor(now / 700)) % 4 === 0) { // lingering dust
          ctx.globalAlpha = 0.25; ctx.fillStyle = '#a8a49c';
          ctx.beginPath(); ctx.arc(b.x * T + 8 + (b.id % b.w) * 9, b.y * T + 6, 2.5, 0, 7); ctx.fill();
          ctx.globalAlpha = 1;
        }
        continue;
      }
      const skey = (b.type === 'house' && b.level > 1) ? 'house' + b.level : b.type;
      const s = SPR.b[skey][b.variant % SPR.b[skey].length];
      // SimCity-style cast shadow (silhouette offset to the south-east)
      ctx.globalAlpha = 0.22;
      ctx.drawImage(s.sh, b.x * T + 4, b.y * T - s.oy + 3);
      ctx.globalAlpha = 1;
      ctx.drawImage(s.img, b.x * T, b.y * T - s.oy);
      if (Weather.season === 3) ctx.drawImage(s.snow, b.x * T, b.y * T - s.oy);
      // earthquake / storm damage: visible cracks until repairs finish
      if (b.quakeDamage) {
        ctx.strokeStyle = 'rgba(30,26,22,0.65)'; ctx.lineWidth = 1 / z;
        const bx0 = b.x * T, by0 = b.y * T - s.oy;
        ctx.beginPath();
        ctx.moveTo(bx0 + 3, by0 + 4); ctx.lineTo(bx0 + 6, by0 + 9); ctx.lineTo(bx0 + 4, by0 + 14);
        ctx.moveTo(bx0 + b.w * T - 4, by0 + 6); ctx.lineTo(bx0 + b.w * T - 8, by0 + 12); ctx.lineTo(bx0 + b.w * T - 5, by0 + 18);
        ctx.stroke();
      }
      // flood: the ground floor sits in the water
      if (b.flooded) {
        ctx.fillStyle = 'rgba(72,130,190,0.55)';
        ctx.fillRect(b.x * T - 2, (b.y + b.h) * T - 7, b.w * T + 4, 8);
        ctx.fillStyle = 'rgba(190,225,250,0.5)';
        ctx.fillRect(b.x * T - 2 + (Math.floor(now / 500) % 2) * 5, (b.y + b.h) * T - 7, 4, 1);
      }
      // festival dress: Christmas light-strings, icicles & wreaths all month
      if (typeof Festivals !== 'undefined' && Festivals.decorated()) {
        const fcols = ['#ff6060', '#ffd160', '#60c0ff', '#80ff90', '#ff90e0'];
        const ry2 = b.y * T - s.oy + 2;
        for (let lx = b.x * T + 1; lx < b.x * T + b.w * T - 1; lx += 2) { // roofline lights, 2px
          ctx.fillStyle = fcols[((lx >> 1) + Math.floor(now / 450)) % fcols.length];
          ctx.fillRect(lx, ry2 + ((lx >> 1) % 2), 2, 2);
        }
        ctx.fillStyle = 'rgba(220,240,255,0.8)'; // icicle lights under the eaves
        for (let lx = b.x * T + 3; lx < b.x * T + b.w * T - 2; lx += 5)
          ctx.fillRect(lx, ry2 + 3, 1, 2 + (lx >> 1) % 2);
        if (CAT[b.type].noroof) { // parks, plazas & grounds get a full light perimeter
          for (let lx = b.x * T; lx < (b.x + b.w) * T; lx += 3) {
            ctx.fillStyle = fcols[((lx >> 1) + Math.floor(now / 450)) % fcols.length];
            ctx.fillRect(lx, (b.y + b.h) * T - 2, 2, 2);
          }
          for (let ly = b.y * T; ly < (b.y + b.h) * T; ly += 3) {
            ctx.fillStyle = fcols[((ly >> 1) + Math.floor(now / 450)) % fcols.length];
            ctx.fillRect(b.x * T, ly, 2, 2); ctx.fillRect((b.x + b.w) * T - 2, ly, 2, 2);
          }
        }
        if (CAT[b.type].res) { // wreath on the door
          ctx.fillStyle = '#2e6b38'; ctx.fillRect(b.door.x * T + 5, (b.y + b.h) * T - 9, 4, 4);
          ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(b.door.x * T + 6, (b.y + b.h) * T - 8, 2, 2);
          ctx.fillStyle = '#c0392b'; ctx.fillRect(b.door.x * T + 6, (b.y + b.h) * T - 6, 2, 1);
        }
        if (dark > 0.15) UI.lights.push({ x: b.x * T + b.w * 8, y: b.y * T - s.oy + 3, r: b.w * 9, a: 0.45, tint: 'pink' });
      }
      // Diwali: dense rows of flickering diyas, warm strings and a rangoli
      if (typeof Festivals !== 'undefined' && Festivals.diyasTonight() && dark > 0.2) {
        for (let lx = b.x * T + 2; lx < b.x * T + b.w * T - 2; lx += 3) { // diyas along the base
          const flick = (lx + Math.floor(now / 240)) % 3;
          ctx.fillStyle = '#c8845a'; ctx.fillRect(lx, (b.y + b.h) * T - 2, 2, 1); // clay lamp
          ctx.fillStyle = flick ? '#ffd870' : '#ff9040';
          ctx.fillRect(lx, (b.y + b.h) * T - 4, 2, 2);                            // the flame
        }
        ctx.fillStyle = '#e8962c'; // warm string along the roofline
        for (let lx = b.x * T + 2; lx < b.x * T + b.w * T - 1; lx += 4) {
          ctx.fillStyle = (lx + Math.floor(now / 400)) % 2 ? '#e8962c' : '#ffd870';
          ctx.fillRect(lx, b.y * T - s.oy + 2, 2, 1);
        }
        if (CAT[b.type].res) { // rangoli at the doorstep
          const rcols = ['#e05a5a', '#f2c14f', '#5fae62', '#c05fa8'];
          const rx0 = b.door.x * T + 8, ry0 = (b.y + b.h) * T + 4;
          for (let k = 0; k < 4; k++) {
            ctx.fillStyle = rcols[k];
            ctx.fillRect(rx0 - 1 + Math.round(Math.cos(k * 1.57) * 3), ry0 + Math.round(Math.sin(k * 1.57) * 2), 2, 1);
          }
          ctx.fillStyle = '#f5f1e4'; ctx.fillRect(rx0 - 1, ry0, 2, 1);
        }
        UI.lights.push({ x: b.x * T + b.w * 8, y: (b.y + b.h) * T - 2, r: b.w * 12, a: 0.6, tint: 'orange' });
      }
      // Easter: painted eggs on the doorstep
      if (typeof Festivals !== 'undefined' && Festivals.isEaster() && CAT[b.type].res) {
        const ecols = ['#f2b8cc', '#8fd0f4', '#f2d94f'];
        for (let k = 0; k < 3; k++) {
          ctx.fillStyle = ecols[(b.id + k) % 3];
          ctx.fillRect(b.door.x * T + 2 + k * 3, (b.y + b.h) * T + 2, 2, 2);
        }
      }
      // aviation beacon blinking on the tallest towers
      if (b.type === 'skyscraper' && dark > 0.12 && Math.floor(now / 900) % 2) {
        const bx2 = b.x * T + (b.w * T >> 1), by2 = b.y * T - s.oy + 1;
        ctx.fillStyle = '#ff4040'; ctx.fillRect(bx2, by2, 2, 2);
        UI.lights.push({ x: bx2 + 1, y: by2 + 1, r: 9, a: 0.8, tint: 'red' });
      }
      // the mayor's flag flies over an occupied town hall
      if (b.type === 'townhall' && typeof Gov !== 'undefined' && Gov.leader) {
        const fx = b.x * T + 4, fy = b.y * T - s.oy - 8;
        ctx.fillStyle = '#8a8f96'; ctx.fillRect(fx, fy, 1, 9);
        const wave = Math.sin(now / 300 + b.id) > 0 ? 0 : 1;
        ctx.fillStyle = '#4f8ede'; ctx.fillRect(fx + 1, fy + wave, 6, 3);
        ctx.fillStyle = '#f2c14f'; ctx.fillRect(fx + 3, fy + wave + 1, 2, 1);
      }
      // upgrade / renovation scaffolding on the facade
      if (b.upgrading > 0 || b.renovating > 0) {
        ctx.fillStyle = '#8a6a3f';
        for (let sx = b.x * T + 2; sx < b.x * T + b.w * T - 1; sx += 8) ctx.fillRect(sx, b.y * T - s.oy, 1, b.h * T + s.oy);
        ctx.fillRect(b.x * T + 1, b.y * T - s.oy + 5, b.w * T - 2, 1);
        ctx.fillRect(b.x * T + 1, b.y * T + 2, b.w * T - 2, 1);
        const pw = SPR.person('hiker', b.id * 5);
        ctx.drawImage(pw.f[Math.floor(now / 300) % 2], b.x * T + b.w * T - 8, b.y * T - s.oy + 6);
      }
      // adding a floor: the new storey rises in plain sight — timber studs
      // first, walls filling in from the bottom, then the first window
      if (b.upgrading > 0 && b.type === 'house') {
        const done = 1 - Math.min(1, b.upgrading / (b.level === 1 ? 240 : 300));
        const fh = 11, topY = b.y * T - s.oy - fh;
        ctx.fillStyle = '#a5824f';
        for (let sx2 = b.x * T + 2; sx2 < b.x * T + b.w * T - 1; sx2 += 5) ctx.fillRect(sx2, topY, 1, fh);
        ctx.fillRect(b.x * T + 1, topY, b.w * T - 2, 1); // top plate
        ctx.fillStyle = 'rgba(230,214,180,0.85)';
        ctx.fillRect(b.x * T + 1, topY + fh * (1 - done), b.w * T - 2, fh * done);
        if (done > 0.55) { ctx.fillStyle = '#5f83a4'; ctx.fillRect(b.x * T + 4, topY + 3, 3, 4); }
        if (done > 0.8) { ctx.fillStyle = '#5f83a4'; ctx.fillRect(b.x * T + b.w * T - 8, topY + 3, 3, 4); }
      }
      // fire!
      if (b.fire) {
        const ff = Math.floor(now / 130) % 2;
        for (let k = 0; k < 3 + b.w; k++) {
          const fx = b.x * T + 3 + ((b.id * 17 + k * 29) % (b.w * T - 6));
          const fy = b.y * T - s.oy + 4 + ((b.id * 11 + k * 13) % (b.h * T + s.oy - 12));
          ctx.fillStyle = ff ? '#ff8438' : '#ffb050';
          ctx.fillRect(fx, fy - 2 - ff, 2, 3);
          ctx.fillStyle = '#ffd870';
          ctx.fillRect(fx, fy, 2, 1);
        }
        UI.lights.push({ x: b.x * T + b.w * 8, y: b.y * T, r: 30 + ff * 4, a: 0.9, tint: 'orange' });
        if (Math.random() < 0.25) UI.smoke.push({ x: b.x * T + 4 + Math.random() * (b.w * T - 8), y: b.y * T - s.oy + 4, r: 2 + Math.random() * 1.5, life: 1 });
      }
      if (b.alarm) {
        const pulse = 0.45 + 0.4 * Math.sin(now / 110);
        ctx.strokeStyle = `rgba(255,60,50,${pulse})`; ctx.lineWidth = 2 / z;
        ctx.strokeRect(b.x * T - 2, b.y * T - s.oy - 2, b.w * T + 4, b.h * T + s.oy + 4);
        UI.lights.push({ x: b.x * T + b.w * 8, y: b.y * T, r: 26, a: pulse, tint: 'red' });
      }
      if (!b.connected) {
        ctx.fillStyle = '#e05a5a';
        ctx.fillRect(b.x * T + b.w * 8 - 2, b.y * T - s.oy - 7, 4, 5);
        ctx.fillStyle = '#fff';
        ctx.fillRect(b.x * T + b.w * 8 - 1, b.y * T - s.oy - 6, 2, 2);
      }
      // family car parked in the driveway when it's home
      if (CAT[b.type].cat === 'res' && b.cars.length) {
        const pc = b.cars.find(c => c.free);
        if (pc) ctx.drawImage(SPR.car(pc.seed).h, b.x * T - 2, (b.y + b.h) * T - 10);
      }
      // patrol car / fire engine waiting outside their stations
      if (b.type === 'police' && !Life.police.length)
        ctx.drawImage(SPR.policeCar[0].h, b.x * T - 2, (b.y + b.h) * T - 10);
      if (b.type === 'fire' && !Life.fireTrucks.length)
        ctx.drawImage(SPR.fireTruck.h, b.x * T - 2, (b.y + b.h) * T - 10);
      const bd = CAT[b.type];
      // customer cars parallel-parked against the kerb (not out in the lane)
      if (b.parked > 0 && bd.visit) {
        for (let k = 0; k < Math.min(2, b.parked); k++) {
          const px = b.x * T - 9, py = b.y * T + 1 + k * 13;
          ctx.drawImage(SPR.car((b.id + k * 3) % 8).v, px, py);
        }
      }
      // tea-stall regulars: a glass of chai, a smoke, the day's gossip
      if (b.type === 'teastall' && Sim.clock > 300 && Sim.clock < 1410) {
        const n = 2 + (b.id + Math.floor(now / 45000)) % 2;
        for (let k = 0; k < n; k++) {
          const hh = (b.id * 41 + k * 23) >>> 0;
          const ps = SPR.person(['man', 'woman', 'man'][k % 3], hh);
          const px2 = b.x * T - 7 + k * 9, py2 = (b.y + b.h) * T + 3 - (k % 2);
          ctx.drawImage(ps.f[Math.floor(now / 800 + k) % 2], px2, py2 - ps.h);
          if ((Math.floor(now / 1400) + k) % 3 === 0) {
            ctx.font = '6px "Segoe UI Emoji", serif';
            ctx.fillText(k % 3 === 1 ? '🚬' : '☕', px2 + 4, py2 - ps.h - 1);
          }
          if (k % 3 === 1 && Math.random() < 0.02) UI.smoke.push({ x: px2 + 5, y: py2 - ps.h - 2, r: 0.8, life: 0.5 });
        }
      }
      // smoke break: workers step outside the big workplaces mid-morning & mid-afternoon
      const onBreak = (Sim.clock >= 630 && Sim.clock < 665) || (Sim.clock >= 950 && Sim.clock < 985);
      if (onBreak && (bd.jobs || 0) >= 6 && b.workers.length >= 2 && !bd.res) {
        for (let k = 0; k < 2; k++) {
          const hh = (b.id * 77 + k * 31) >>> 0;
          const ps = SPR.person(k ? 'woman' : 'man', hh);
          const px2 = b.door.x * T - 11 - k * 7, py2 = (b.y + b.h) * T - 1;
          ctx.drawImage(ps.f[0], px2, py2 - ps.h);
          if (k === 0 && Math.floor(now / 900) % 2) {
            ctx.font = '6px "Segoe UI Emoji", serif';
            ctx.fillText('🚬', px2 + 4, py2 - ps.h - 1);
          }
          if (k === 0 && Math.random() < 0.03) UI.smoke.push({ x: px2 + 5, y: py2 - ps.h - 3, r: 0.8, life: 0.5 });
        }
      }
      // queue outside busy indoor venues
      if (bd.visit && !bd.noroof && b.inside > 2) {
        const qn = Math.min(5, b.inside - 2);
        const kinds = ['man', 'woman', 'kid'];
        for (let k = 0; k < qn; k++) {
          const qs = SPR.person(kinds[(b.id + k) % 3], b.id * 7 + k);
          ctx.drawImage(qs.f[0], b.door.x * T + 10 + k * 7, (b.y + b.h) * T - qs.h - ((b.id + k) % 2));
        }
      }
      // people enjoying open-air venues (parks fill up on weekends)
      if (bd.noroof && b.inside > 0) {
        const vn = Math.min(6, b.inside);
        const kinds = ['kid', 'woman', 'man'];
        const vf = Math.floor(now / 420) % 2;
        for (let k = 0; k < vn; k++) {
          const hh = (b.id * 31 + k * 47) >>> 0;
          const vs = SPR.person(kinds[(b.id + k) % 3], hh);
          ctx.drawImage(vs.f[(vf + k) % 2], b.x * T + 4 + (hh % (b.w * T - 10)), b.y * T + 4 + ((hh >> 4) % (b.h * T - 12)));
        }
      }
      // building light sources — gated by what's actually awake in there
      if (dark > 0.1) {
        const lf = buildingLit(b);
        if (lf >= 0.25)
          UI.lights.push({ x: b.x * T + b.w * 8, y: b.y * T + b.h * 8, r: (b.w * 11 + 8) * Math.max(0.55, lf), a: 0.5 * lf, tint: 'warm' });
        // porch lights: many homes leave one small lamp burning by the door
        if (bd.res && b.residents.length && lf < 1 && b.id % 3 !== 2)
          UI.lights.push({ x: b.door.x * T + 8, y: b.door.y * T - 3, r: 9, a: 0.55, tint: 'warm' });
        if ((b.type === 'amusement' || b.type === 'casino') && lf > 0.5) {
          const tints = ['pink', 'blue', 'green', 'orange'];
          UI.lights.push({
            x: b.x * T + 22, y: b.y * T + 6, r: 34 + Math.sin(now / 300) * 6,
            a: 0.8, tint: tints[Math.floor(now / 450) % 4],
          });
        }
      }
    } else if (e.kind === 'agent') {
      const p = e.p;
      if (p.trip.car || p.trip.taxi) {
        const spr = p.trip.taxi ? SPR.taxi : SPR.car(p.trip.car.seed);
        shadow(p.x, p.y + 3, 6, 2);
        if (p.dirx !== 0) ctx.drawImage(spr.h, Math.round(p.x) - 6, Math.round(p.y) - 4);
        else ctx.drawImage(spr.v, Math.round(p.x) - 4, Math.round(p.y) - 6);
        if (dark > 0.1 && (p.dirx || p.diry)) { // soft headlight pool on the road ahead
          UI.lights.push({ x: p.x + (p.dirx || 0) * 4, y: p.y + (p.diry || 0) * 4, r: 15, a: 0.5, cone: true, dirx: p.dirx, diry: p.diry });
          UI.lights.push({ x: p.x, y: p.y, r: 5, a: 0.2, tint: 'cool' });
        }
      } else if (p.trip.moto) {
        shadow(p.x, p.y + 2.5, 5, 1.6);
        if (p.dirx !== 0) ctx.drawImage(SPR.moto.h, Math.round(p.x) - 5, Math.round(p.y) - 4);
        else ctx.drawImage(SPR.moto.v, Math.round(p.x) - 3, Math.round(p.y) - 5);
        if (dark > 0.1 && (p.dirx || p.diry)) UI.lights.push({ x: p.x + (p.dirx || 0) * 3, y: p.y + (p.diry || 0) * 3, r: 10, a: 0.45, cone: true, dirx: p.dirx, diry: p.diry });
      } else {
        const spr = SPR.person(p.kind, p.seed);
        shadow(p.x, p.y + 1.5, 3, 1.2);
        ctx.drawImage(spr.f[frame], Math.round(p.x) - 3, Math.round(p.y) - spr.h + 1);
        if (raining) ctx.drawImage(SPR.umbrellas[p.seed % 4], Math.round(p.x) - 4, Math.round(p.y) - spr.h - 4);
        if (p.trip.dog !== undefined) {
          const d = { x: 0, y: 0 };
          Life.followPath(d, p.trip.path, Math.max(0, p.trip.prog - 0.55), 5.5);
          ctx.drawImage(SPR.dog[frame], Math.round(d.x) - 3, Math.round(d.y) - 4);
        }
      }
    } else if (e.kind === 'hiker') {
      const h = e.h, spr = SPR.person('hiker', h.seed);
      shadow(h.x, h.y + 1, 3, 1.2);
      ctx.drawImage(spr.f[h.pause > 0 ? 0 : frame], Math.round(h.x) - 3, Math.round(h.y) - spr.h + 1);
      if (dark > 0.15) { // torch in hand
        ctx.fillStyle = '#ffb050';
        ctx.fillRect(Math.round(h.x) + 3, Math.round(h.y) - spr.h - 1 + (frame ? 1 : 0), 2, 2);
        UI.lights.push({ x: h.x + 4, y: h.y - 6, r: 13 + Math.sin(now / 90 + h.seed) * 2, a: 0.8, tint: 'orange' });
      }
    } else if (e.kind === 'burglar') {
      const B = e.B, spr = SPR.person('burglar', B.seed);
      shadow(B.x, B.y + 1.5, 3, 1.2);
      ctx.drawImage(spr.f[frame], Math.round(B.x) - 3, Math.round(B.y) - spr.h + 1);
      if (B.phase === 'flee') { ctx.fillStyle = '#d8c27a'; ctx.fillRect(Math.round(B.x) + 3, Math.round(B.y) - 5, 3, 3); } // loot bag
    } else if (e.kind === 'police') {
      const u = e.u, spr = SPR.policeCar[Math.floor(now / 180) % 2];
      shadow(u.x, u.y + 3, 6, 2);
      if (u.dirx !== 0) ctx.drawImage(spr.h, Math.round(u.x) - 6, Math.round(u.y) - 4);
      else ctx.drawImage(spr.v, Math.round(u.x) - 4, Math.round(u.y) - 6);
      const ft = Math.floor(now / 180) % 2 ? 'red' : 'blue';
      UI.lights.push({ x: u.x, y: u.y, r: 22, a: 0.9, tint: ft });
      if (dark > 0.1) UI.lights.push({ x: u.x + (u.dirx || 0) * 4, y: u.y + (u.diry || 0) * 4, r: 15, a: 0.8, cone: true, dirx: u.dirx, diry: u.diry });
    } else if (e.kind === 'firetruck') {
      const u = e.u, spr = SPR.fireTruck;
      shadow(u.x, u.y + 3, 6, 2);
      if (u.dirx !== 0) ctx.drawImage(spr.h, Math.round(u.x) - 6, Math.round(u.y) - 4);
      else ctx.drawImage(spr.v, Math.round(u.x) - 4, Math.round(u.y) - 6);
      UI.lights.push({ x: u.x, y: u.y - 3, r: 20, a: 0.9, tint: Math.floor(now / 170) % 2 ? 'red' : 'orange' });
      if (dark > 0.1) UI.lights.push({ x: u.x + (u.dirx || 0) * 4, y: u.y + (u.diry || 0) * 4, r: 15, a: 0.8, cone: true, dirx: u.dirx, diry: u.diry });
      if (u.phase === 'douse' && u.target) { // arcing water jet onto the flames
        const wtx = u.target.x * T + u.target.w * 8, wty = u.target.y * T + 4;
        ctx.fillStyle = 'rgba(140,200,245,0.9)';
        for (let k = 0; k < 6; k++) {
          const f = ((k / 6) + (now % 420) / 2520) % 1;
          const wx = u.x + (wtx - u.x) * f, wy = u.y - 3 + (wty - u.y + 3) * f - Math.sin(f * Math.PI) * 9;
          ctx.fillRect(wx, wy, 1.5, 1.5);
        }
      }
    } else if (e.kind === 'runner') {
      const spr = SPR.person(e.h.kind, e.h.seed);
      shadow(e.x, e.y + 1.5, 3, 1.2);
      ctx.drawImage(spr.f[e.h.f < 1 ? frame : Math.floor(now / 420) % 2], Math.round(e.x) - 3, Math.round(e.y) - spr.h + 1);
      if (e.h.gawk && e.h.f >= 1 && (Math.floor(now / 1200) + e.h.seed) % 3 === 0) { // murmuring onlookers
        ctx.font = '7px "Segoe UI Emoji", serif';
        ctx.fillText('😮', Math.round(e.x) - 3, Math.round(e.y) - spr.h - 4);
      }
      if (e.bucket) {
        ctx.fillStyle = '#8fa6b8'; ctx.fillRect(Math.round(e.x) + 3, Math.round(e.y) - 3, 2, 2); // bucket in hand
        if (e.h.f >= 1) { // tossed water flying toward the fire
          const wtx = e.bucket.x * T + e.bucket.w * 8, wty = e.bucket.y * T + e.bucket.h * 4;
          const f2 = (now / 500 + e.h.seed % 7) % 1;
          ctx.fillStyle = 'rgba(150,205,245,0.85)';
          ctx.fillRect(e.x + (wtx - e.x) * f2, e.y - 4 + (wty - e.y + 4) * f2 - Math.sin(f2 * Math.PI) * 6, 1.5, 1.5);
        }
      }
    } else if (e.kind === 'protester' || e.kind === 'listener') {
      const r = e.r, spr = SPR.person(r.kind, r.seed);
      shadow(r.x, r.y + 1.5, 3, 1.2);
      const hop = e.kind === 'protester' ? (Math.floor(now / 240) + e.ri) % 2 : 0;
      ctx.drawImage(spr.f[hop], Math.round(r.x) - 3, Math.round(r.y) - spr.h + 1 - hop);
      if (e.ri % 2 === 0) { // picket / campaign sign
        const sy = Math.round(r.y) - spr.h;
        ctx.fillStyle = '#8a6a45'; ctx.fillRect(Math.round(r.x) + 2, sy - 6, 1, 7);
        ctx.fillStyle = '#f2eede'; ctx.fillRect(Math.round(r.x) - 1, sy - 10, 7, 5);
        ctx.fillStyle = e.kind === 'protester' ? '#c04a40' : (Life.rally && Life.rally.color) || '#4f7ed0';
        ctx.fillRect(Math.round(r.x), sy - 9, 5, 1); ctx.fillRect(Math.round(r.x), sy - 7, 4, 1);
      } else if ((Math.floor(now / 900) + e.ri) % 3 === 0) {
        ctx.font = '7px "Segoe UI Emoji", serif';
        ctx.fillText(e.kind === 'protester' ? '💢' : '👏', Math.round(r.x) - 3, Math.round(r.y) - spr.h - 4);
      }
    } else if (e.kind === 'speaker') {
      const R2 = e.r; // rally state: candidate on a soapbox
      ctx.fillStyle = '#8a6a45'; ctx.fillRect(Math.round(R2.x) - 4, Math.round(R2.y) - 3, 9, 4); // crate
      ctx.fillStyle = '#6d5333'; ctx.fillRect(Math.round(R2.x) - 4, Math.round(R2.y), 9, 1);
      const spr = SPR.person(R2.speakerKind || 'man', R2.speakerSeed || 1);
      ctx.drawImage(spr.f[Math.floor(now / 500) % 2], Math.round(R2.x) - 3, Math.round(R2.y) - spr.h - 3);
      ctx.font = '8px "Segoe UI Emoji", serif';
      if (Math.floor(now / 1100) % 2) ctx.fillText('📢', Math.round(R2.x) + 3, Math.round(R2.y) - spr.h - 5);
    } else if (e.kind === 'tourist') {
      const tr = e.tr, spr = SPR.car(tr.seed);
      shadow(tr.x, tr.y + 3, 6, 2);
      if (tr.dirx !== 0) ctx.drawImage(spr.h, Math.round(tr.x) - 6, Math.round(tr.y) - 4);
      else ctx.drawImage(spr.v, Math.round(tr.x) - 4, Math.round(tr.y) - 6);
      if (dark > 0.1 && (tr.dirx || tr.diry)) UI.lights.push({ x: tr.x + (tr.dirx || 0) * 4, y: tr.y + (tr.diry || 0) * 4, r: 15, a: 0.5, cone: true, dirx: tr.dirx, diry: tr.diry });
    } else if (e.kind === 'bus') {
      const u = e.u;
      shadow(u.x, u.y + 3, 8, 2.4);
      if (u.dirx !== 0) ctx.drawImage(SPR.bus.h, Math.round(u.x) - 8, Math.round(u.y) - 4);
      else ctx.drawImage(SPR.bus.v, Math.round(u.x) - 4, Math.round(u.y) - 8);
      if (dark > 0.1) UI.lights.push({ x: u.x + (u.dirx || 0) * 5, y: u.y + (u.diry || 0) * 5, r: 17, a: 0.8, cone: true, dirx: u.dirx, diry: u.diry });
    } else if (e.kind === 'traincar') {
      const tr = e.u;
      const o = { x: tr.x, y: tr.y, dirx: tr.dirx, diry: tr.diry };
      if (e.off) Life.followPath(o, tr.route, Math.max(0, Math.min(tr.route.length - 1, tr.prog - e.off * tr.dir)), 0);
      // each service holds its own track of the three-track mainline
      if (tr.lane) { if (o.dirx !== 0) o.y += tr.lane; else o.x += tr.lane; }
      const fleet = {
        local: [SPR.trainEngine, SPR.trainCoach],
        commuter: [SPR.commuterEngine, SPR.commuterCoach],
        express: [SPR.trainExpress, SPR.expressCoach],
        nightliner: [SPR.nightEngine, SPR.nightCoach],
        freight: [SPR.freightEngine, SPR.freightCar],
      };
      const spr = (fleet[tr.type] || fleet.local)[e.engine ? 0 : 1];
      shadow(o.x, o.y + 3, 9, 2.4);
      if (o.dirx !== 0) ctx.drawImage(spr.h, Math.round(o.x) - 9, Math.round(o.y) - 4);
      else ctx.drawImage(spr.v, Math.round(o.x) - 4, Math.round(o.y) - 9);
      if (e.engine && dark > 0.1) // a locomotive throws a LONG hard beam down the line
        UI.lights.push({ x: o.x + (o.dirx || 0) * 8, y: o.y + (o.diry || 0) * 8, r: 30, a: 1, cone: true, dirx: o.dirx, diry: o.diry });
      if (e.engine && tr.type !== 'express' && Math.random() < 0.12 && UI.speeds[UI.speedIdx] > 0)
        UI.smoke.push({ x: o.x, y: o.y - 7, r: 1.4 + Math.random(), life: 0.7 });
    } else if (e.kind === 'raft') {
      const u = e.u;
      ctx.strokeStyle = 'rgba(220,240,252,0.35)';
      ctx.beginPath(); ctx.ellipse(u.x, u.y + 2, 7, 2.4, 0, 0, 7); ctx.stroke();
      ctx.save();
      if (u.flip < 0) { ctx.translate(u.x * 2, 0); ctx.scale(-1, 1); }
      ctx.drawImage(SPR.raft, Math.round(u.x) - 6, Math.round(u.y) - 4);
      ctx.restore();
    } else if (e.kind === 'reporter') {
      const spr = SPR.person('reporter', e.rp.seed);
      shadow(e.x, e.y + 1.5, 3, 1.2);
      ctx.drawImage(spr.f[e.rp.phase === 'report' ? Math.floor(now / 500) % 2 : frame], Math.round(e.x) - 3, Math.round(e.y) - spr.h + 1);
      if (e.rp.phase === 'report') {
        ctx.font = '7px "Segoe UI Emoji", serif';
        if (Math.floor(now / 900) % 2) ctx.fillText('🎤', Math.round(e.x) + 3, Math.round(e.y) - spr.h - 2);
        if (dark > 0.2) UI.lights.push({ x: e.x, y: e.y - 6, r: 12, a: 0.8, tint: 'cool' }); // camera light
      }
    } else if (e.kind === 'beach') {
      const bf = e.bf;
      if (bf.umbrella) ctx.drawImage(SPR.umbrellas[bf.seed % 4], Math.round(bf.x) - 9, Math.round(bf.y) - 10);
      if (bf.mode === 'towel') {
        ctx.fillStyle = bf.towelC;
        ctx.fillRect(Math.round(bf.x) - 4, Math.round(bf.y) - 2, 9, 5);
        const spr = SPR.person(bf.kind, bf.seed);
        ctx.save();
        ctx.translate(Math.round(bf.x) + 2, Math.round(bf.y) - 1);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(spr.f[0], -3, -4); // sunbathing
        ctx.restore();
      } else {
        const spr = SPR.person(bf.kind, bf.seed);
        const bob = bf.mode === 'wade' ? Math.round(Math.sin(bf.ph * 2)) : 0;
        shadow(bf.x, bf.y + 1.5, 3, 1.2);
        ctx.drawImage(spr.f[Math.floor(now / 600 + bf.seed) % 2], Math.round(bf.x) - 3, Math.round(bf.y) - spr.h + 1 + bob);
      }
    } else if (e.kind === 'snowman') {
      if (typeof Festivals === 'undefined' || !Festivals.decorated()) continue;
      const sx2 = e.x * T + 8, sy2 = e.y * T + 12;
      shadow(sx2, sy2 + 2, 5, 1.6);
      ctx.fillStyle = '#f4f7fb';
      ctx.beginPath(); ctx.arc(sx2, sy2, 4, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(sx2, sy2 - 6, 3, 0, 7); ctx.fill();
      ctx.fillStyle = '#26282e';
      ctx.fillRect(sx2 - 1.5, sy2 - 7.5, 1, 1); ctx.fillRect(sx2 + 0.5, sy2 - 7.5, 1, 1); // coal eyes
      ctx.fillRect(sx2 - 3, sy2 - 11, 6, 2); ctx.fillRect(sx2 - 2, sy2 - 13, 4, 2);      // top hat
      ctx.fillStyle = '#e0862c'; ctx.fillRect(sx2, sy2 - 6, 3, 1);                        // carrot
      ctx.fillStyle = '#c0392b'; ctx.fillRect(sx2 - 3, sy2 - 4, 6, 1);                    // scarf
    } else if (e.kind === 'xmarket') {
      const mk = e.mk;
      const mx0 = mk.x * T, my0 = mk.y * T;
      // fairy-light perimeter
      const mcols = ['#ff6060', '#ffd160', '#60c0ff', '#80ff90', '#ff90e0'];
      for (let k = 0; k < 26; k++) {
        const per = k / 26;
        const lx = per < 0.5 ? mx0 + per * 2 * 80 : mx0 + 80 - (per - 0.5) * 2 * 80;
        const ly = per < 0.5 ? my0 - 2 : my0 + 64;
        if ((k + Math.floor(now / 400)) % 4 === 0) continue;
        ctx.fillStyle = mcols[k % 5];
        ctx.fillRect(lx, ly, 1.5, 1.5);
      }
      // rows of striped stalls
      for (let k = 0; k < 5; k++) {
        const stx = mx0 + 2 + (k % 3) * 26, sty = my0 + 4 + ((k / 3) | 0) * 30;
        const c1 = k % 2 ? '#c0392b' : '#2e6b38';
        for (let i2 = 0; i2 < 20; i2++) ctx.fillStyle = (i2 >> 2) % 2 ? c1 : '#f5f1e4', ctx.fillRect(stx + i2, sty, 1, 5); // canopy
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(stx, sty + 5, 20, 1);
        ctx.fillStyle = '#8a6a45'; ctx.fillRect(stx + 1, sty + 9, 18, 6); // counter
        ctx.fillStyle = '#5d4630'; ctx.fillRect(stx + 1, sty + 14, 18, 1);
        for (let i2 = 0; i2 < 4; i2++) ctx.fillStyle = mcols[(k + i2) % 5], ctx.fillRect(stx + 3 + i2 * 4, sty + 10, 2, 2); // wares
        if ((k + Math.floor(now / 700)) % 3 === 0) UI.smoke.push && Math.random() < 0.02 &&
          UI.smoke.push({ x: stx + 16, y: sty + 6, r: 0.8, life: 0.5 }); // cocoa steam
      }
      // the star pole at the heart of the market
      ctx.fillStyle = '#8a6a45'; ctx.fillRect(mx0 + 38, my0 + 22, 2, 18);
      ctx.fillStyle = '#ffd870'; ctx.fillRect(mx0 + 36, my0 + 18, 6, 6); ctx.fillRect(mx0 + 38, my0 + 16, 2, 2);
      // shoppers milling between the stalls
      const nShop = 6 + (mk.seed % 4);
      for (let k = 0; k < nShop; k++) {
        const hh = (mk.seed + k * 131) >>> 0;
        const ps = SPR.person(['man', 'woman', 'kid'][k % 3], hh);
        const wob = Math.sin(now / 900 + k * 1.7) * 3;
        ctx.drawImage(ps.f[(Math.floor(now / 700) + k) % 2],
          mx0 + 6 + (hh % 66) + wob, my0 + 8 + ((hh >> 5) % 48) - ps.h);
        if ((Math.floor(now / 1400) + k) % 5 === 0) {
          ctx.font = '6px "Segoe UI Emoji", serif';
          ctx.fillText(['🎁', '☕', '🍪', '🎄', '✨'][k % 5], mx0 + 6 + (hh % 66) + wob, my0 + ((hh >> 5) % 48) - 4);
        }
      }
      if (dark > 0.1) {
        UI.lights.push({ x: mx0 + 40, y: my0 + 28, r: 52, a: 0.85, tint: 'warm' });
        UI.lights.push({ x: mx0 + 12, y: my0 + 10, r: 20, a: 0.6, tint: 'pink' });
        UI.lights.push({ x: mx0 + 66, y: my0 + 44, r: 20, a: 0.6, tint: 'green' });
      }
    } else if (e.kind === 'carolers') {
      const cg = e.cg;
      for (let k = 0; k < 3; k++) {
        const ps = SPR.person(['woman', 'man', 'kid'][k], cg.seed + k * 7);
        ctx.drawImage(ps.f[(Math.floor(now / 600) + k) % 2], Math.round(cg.x) - 8 + k * 7, Math.round(cg.y) - ps.h);
      }
      ctx.fillStyle = '#ffd870'; ctx.fillRect(Math.round(cg.x) + 12, Math.round(cg.y) - 6, 2, 3); // lantern
      if ((Math.floor(now / 800)) % 2) {
        ctx.font = '7px "Segoe UI Emoji", serif';
        ctx.fillText('🎵', Math.round(cg.x) - 2, Math.round(cg.y) - 12);
      }
      if (dark > 0.15) UI.lights.push({ x: cg.x, y: cg.y - 5, r: 14, a: 0.7, tint: 'warm' });
    } else if (e.kind === 'santa') {
      const sn = e.sn;
      shadow(sn.x, sn.y + 1.5, 4, 1.4);
      ctx.drawImage(SPR.santa[frame], Math.round(sn.x) - 4, Math.round(sn.y) - 10);
      // a trail of delighted kids
      for (let k = 0; k < 2; k++) {
        const ps = SPR.person('kid', 601 + k * 13);
        const o2 = { x: 0, y: 0 };
        Life.followPath(o2, sn.path, Math.max(0, sn.prog - 1.1 - k * 0.9), 5.5);
        ctx.drawImage(ps.f[(frame + k) % 2], Math.round(o2.x) - 3, Math.round(o2.y) - ps.h + 1);
      }
      if ((Math.floor(now / 1000)) % 3 === 0) {
        ctx.font = '7px "Segoe UI Emoji", serif';
        ctx.fillText('🎅', Math.round(sn.x) - 3, Math.round(sn.y) - 13);
      }
    } else if (e.kind === 'xmastree') {
      const ft = e.ft;
      const cx = ft.x * T + 16, baseY = (ft.y + 2) * T - 2;
      if (ft.phase === 'scouting') {
        // the committee out in the woods, sizing up the giant
        if (ft.src) {
          const sx = ft.src.x * T + 8, sy = ft.src.y * T + 12;
          for (let k = 0; k < 3; k++) {
            const ps = SPR.person(['man', 'woman', 'hiker'][k], 31 + k * 7);
            ctx.drawImage(ps.f[(Math.floor(now / 700) + k) % 2], sx - 10 + k * 8, sy - ps.h);
          }
          if (Math.floor(now / 1100) % 2) { ctx.font = '7px "Segoe UI Emoji", serif'; ctx.fillText('🔍', sx + 2, sy - 12); }
        }
      } else if (ft.phase === 'hauling' && ft.haulPath) {
        // the great haul: a truck drags the tree through the streets
        const o = { x: 0, y: 0, dirx: 1, diry: 0 };
        Life.followPath(o, ft.haulPath, Math.min(ft.haulPath.length - 1, ft.prog), 3.5);
        shadow(o.x, o.y + 3, 11, 2.6);
        ctx.drawImage(SPR.car(6).h, Math.round(o.x) - 12, Math.round(o.y) - 4);
        ctx.fillStyle = '#5d4630'; ctx.fillRect(Math.round(o.x) - 1, Math.round(o.y) - 1, 16, 3); // trailer
        ctx.fillStyle = '#2e6b38'; // the tree, lying down
        ctx.beginPath(); ctx.moveTo(o.x + 15, o.y); ctx.lineTo(o.x + 1, o.y - 4); ctx.lineTo(o.x + 1, o.y + 4); ctx.fill();
        if ((Math.floor(now / 1200)) % 3 === 0) { ctx.font = '7px "Segoe UI Emoji", serif'; ctx.fillText('🎄', Math.round(o.x) - 4, Math.round(o.y) - 8); }
      } else if (ft.phase === 'raising' || ft.phase === 'lit') {
        // a TRUE landmark: the great tree towers over everything but the peaks
        const TH = 120, TW = 72;
        const th = ft.phase === 'lit' ? TH : Math.max(14, TH * ft.prog);
        shadow(cx, baseY + 3, 30, 7);
        ctx.fillStyle = '#6b4a2f'; ctx.fillRect(cx - 4, baseY - 6, 8, 8); // trunk
        ctx.fillStyle = '#5d4630'; ctx.fillRect(cx - 6, baseY + 1, 12, 2); // stand
        const tiers = 8;
        for (let k2 = 0; k2 < tiers; k2++) { // stacked boughs, rising with progress
          if (th < (k2 + 1) * (TH / tiers) - 6) break;
          const wy = baseY - 6 - (k2 + 1) * (th / tiers);
          const ww = (TW / 2) * (1 - (k2 / tiers) * 0.78);
          ctx.fillStyle = k2 % 2 ? '#2e6b38' : '#276031';
          ctx.beginPath();
          ctx.moveTo(cx - ww, wy + th / tiers + 4); ctx.lineTo(cx, wy); ctx.lineTo(cx + ww, wy + th / tiers + 4);
          ctx.fill();
          ctx.fillStyle = 'rgba(244,247,251,0.5)'; // snow on the bough tips
          ctx.fillRect(cx - ww + 2, wy + th / tiers + 2, 4, 1);
          ctx.fillRect(cx + ww - 6, wy + th / tiers + 2, 4, 1);
        }
        if (ft.phase === 'raising') {
          ctx.fillStyle = '#8a6a3f'; // full scaffold cage + riggers
          for (const gx of [cx - TW / 2 - 6, cx + TW / 2 + 5]) ctx.fillRect(gx, baseY - th - 4, 1, th + 4);
          ctx.fillRect(cx - TW / 2 - 6, baseY - th - 4, TW + 12, 1);
          ctx.fillRect(cx - TW / 2 - 6, baseY - th / 2, TW + 12, 1);
          const wf = Math.floor(now / 300) % 2;
          const w1 = SPR.person('hiker', 91);
          ctx.drawImage(w1.f[wf], cx - TW / 2 - 12, baseY - w1.h);
          ctx.drawImage(w1.f[1 - wf], cx + TW / 2 + 6, baseY - w1.h);
          ctx.drawImage(w1.f[wf], cx + 4, baseY - th / 2 - w1.h);   // one up on the mid-deck
        } else {
          // LIT: a blazing star, dozens of twinkling lights, glowing ALL night
          ctx.fillStyle = '#ffd870';
          ctx.fillRect(cx - 2, baseY - th - 12, 5, 5); ctx.fillRect(cx, baseY - th - 15, 1, 3);
          ctx.fillRect(cx - 4, baseY - th - 10, 2, 1); ctx.fillRect(cx + 3, baseY - th - 10, 2, 1);
          const tcols = ['#ff6060', '#ffd160', '#60c0ff', '#80ff90', '#ff90e0', '#c0a0ff'];
          for (let k2 = 0; k2 < 64; k2++) {
            if ((k2 + Math.floor(now / 400)) % 4 === 0) continue; // twinkle
            const ph2 = (k2 * 37 % 100) / 100;
            const ly = baseY - 8 - ph2 * (th - 12);
            const lw = (TW / 2) * (1 - ph2 * 0.78) - 2;
            ctx.fillStyle = tcols[k2 % tcols.length];
            ctx.fillRect(cx + Math.sin(k2 * 2.7) * lw, ly, 2, 2);
          }
          // a light garland spiralling the whole height
          ctx.fillStyle = '#fff2b0';
          for (let k2 = 0; k2 < 30; k2++) {
            const ph2 = k2 / 30;
            const lw = (TW / 2) * (1 - ph2 * 0.78) - 1;
            ctx.fillRect(cx + Math.sin(ph2 * 15 + now / 900) * lw, baseY - 8 - ph2 * (th - 12), 1, 1);
          }
          // a small mountain of gifts round the base
          const gcols2 = ['#c0392b', '#4f9ed0', '#f2c14f', '#5fae62', '#c05fa8'];
          for (let k2 = 0; k2 < 8; k2++) {
            ctx.fillStyle = gcols2[k2 % 5];
            ctx.fillRect(cx - 20 + k2 * 5, baseY - 2 - (k2 % 3), 4, 3 + (k2 % 2));
          }
          UI.lights.push({ x: cx, y: baseY - th / 2, r: 90, a: 0.95, tint: 'warm' });
          UI.lights.push({ x: cx, y: baseY - th - 10, r: 22, a: 0.95, tint: 'orange' });
          UI.lights.push({ x: cx - TW / 3, y: baseY - th / 4, r: 26, a: 0.5, tint: 'pink' });
          UI.lights.push({ x: cx + TW / 3, y: baseY - th / 3, r: 26, a: 0.5, tint: 'green' });
          // the village celebrates under and around its tree
          const holiday = Festivals.yearDay() === 24 || Festivals.yearDay() === 25;
          if (holiday || Sim.clock >= 960 || Sim.clock < 60) {
            const nC = holiday ? 18 : 11;
            for (let k2 = 0; k2 < nC; k2++) {
              const a2 = (k2 / nC) * 6.283 + 0.4;
              const px2 = cx + Math.cos(a2) * (42 + (k2 % 3) * 7);
              const py2 = baseY + 6 + Math.sin(a2) * 13;
              const ps = SPR.person(['man', 'woman', 'kid'][k2 % 3], 401 + k2 * 13);
              ctx.drawImage(ps.f[(Math.floor(now / 800) + k2) % 2], Math.round(px2) - 3, Math.round(py2) - ps.h);
              if ((Math.floor(now / 1300) + k2) % 4 === 0) {
                ctx.font = '6px "Segoe UI Emoji", serif';
                ctx.fillText(['🎵', '☕', '🎵', '✨'][k2 % 4], Math.round(px2), Math.round(py2) - ps.h - 2);
              }
            }
          }
        }
      }
    } else if (e.kind === 'boat') {
      const u = e.u;
      ctx.strokeStyle = 'rgba(220,240,252,0.3)';
      ctx.beginPath(); ctx.ellipse(u.x, u.y + 2, 6 + Math.sin(u.ph) * 1.5, 2.4, 0, 0, 7); ctx.stroke();
      ctx.save();
      if (u.flip < 0) { ctx.translate(u.x * 2, 0); ctx.scale(-1, 1); }
      ctx.drawImage(SPR.boat, Math.round(u.x) - 5, Math.round(u.y) - 3 + (Math.sin(u.ph * 2) > 0 ? 0 : 1));
      ctx.restore();
    } else if (e.kind === 'ferry') {
      const u = e.u;
      ctx.strokeStyle = 'rgba(220,240,252,0.4)';
      ctx.beginPath(); ctx.ellipse(u.x, u.y + 3, 11, 3, 0, 0, 7); ctx.stroke();
      ctx.drawImage(SPR.ferry, Math.round(u.x) - 10, Math.round(u.y) - 6);
      if (dark > 0.1) UI.lights.push({ x: u.x, y: u.y - 3, r: 14, a: 0.7, tint: 'warm' });
    } else if (e.kind === 'campcar') {
      const u = e.u;
      const cand = Gov.campaign && Gov.campaign.candidates[u.ci % Gov.campaign.candidates.length];
      const spr = SPR.car(u.seed % 8);
      shadow(u.x, u.y + 3, 6, 2);
      if (u.dirx !== 0) ctx.drawImage(spr.h, Math.round(u.x) - 6, Math.round(u.y) - 4);
      else ctx.drawImage(spr.v, Math.round(u.x) - 4, Math.round(u.y) - 6);
      // rooftop banner in the candidate's colour
      ctx.fillStyle = cand ? cand.color : '#4f8ede';
      ctx.fillRect(Math.round(u.x) - 4, Math.round(u.y) - 9, 9, 3);
      ctx.fillStyle = 'rgba(255,252,240,0.9)';
      ctx.fillRect(Math.round(u.x) - 3, Math.round(u.y) - 8, 2, 1); ctx.fillRect(Math.round(u.x) + 1, Math.round(u.y) - 8, 2, 1);
      if (Math.floor(now / 900) % 3 === 0) {
        ctx.font = '7px "Segoe UI Emoji", serif';
        ctx.fillText('📢', Math.round(u.x) + 5, Math.round(u.y) - 9);
      }
    } else if (e.kind === 'camp') {
      const cp = e.cp;
      const cand = Gov.campaign.candidates[cp.ci % Gov.campaign.candidates.length];
      const cx = cp.x * T + 1, cy = cp.y * T;
      shadow(cx + 7, cy + 13, 7, 2);
      ctx.drawImage(SPR.tent(cand.color || '#4f8ede'), cx, cy + 2);
      // a volunteer handing out flyers
      const vs = SPR.person((cp.ci % 2) ? 'woman' : 'man', cp.x * 31 + cp.y);
      ctx.drawImage(vs.f[Math.floor(now / 500) % 2], cx + 13, cy + 6);
      if ((Math.floor(now / 1300) + cp.ci) % 3 === 0) {
        ctx.font = '7px "Segoe UI Emoji", serif';
        ctx.fillText('📋', cx + 16, cy + 4);
      }
      if (dark > 0.15) UI.lights.push({ x: cx + 7, y: cy + 8, r: 16, a: 0.7, tint: 'warm' });
    } else if (e.kind === 'voting') {
      const vb = e.vb;
      // a row of booths + ballot box
      for (let k = 0; k < 3; k++) ctx.drawImage(SPR.booth, vb.x - 22 + k * 12, vb.y - 8);
      ctx.drawImage(SPR.ballotBox, vb.x + 16, vb.y - 2);
      // the queue of voters, shuffling forward
      const shift = Math.floor(now / 1400) % 2;
      for (let k = 0; k < vb.queue.length; k++) {
        const q = vb.queue[k];
        const spr = SPR.person(q.kind, q.seed);
        ctx.drawImage(spr.f[(k + shift) % 2], vb.x - 30 - k * 7 + (k % 2), vb.y + 8 - (k % 3));
      }
      ctx.font = '8px "Segoe UI Emoji", serif';
      ctx.fillText('🗳️', vb.x - 4, vb.y - 10);
    } else if (e.kind === 'busqueue') {
      const b = e.b;
      const n = 1 + (b.id + Math.floor(now / 60000)) % 2;
      for (let k = 0; k < n; k++) {
        const spr = SPR.person(['man', 'woman', 'kid'][(b.id + k) % 3], b.id * 13 + k * 7);
        ctx.drawImage(spr.f[0], b.x * T - 4 - k * 6, (b.y + b.h) * T - spr.h - 1);
      }
    } else if (e.kind === 'duck') {
      const dk = e.dk;
      const bob = Math.sin(dk.ph) > 0 ? 0 : 1;
      // ripple
      ctx.strokeStyle = 'rgba(220,240,252,0.35)';
      ctx.beginPath(); ctx.ellipse(dk.x, dk.y + 3, 5 + Math.sin(dk.ph) * 1.5, 2, 0, 0, 7); ctx.stroke();
      ctx.save();
      if (dk.flip < 0) { ctx.translate(dk.x * 2, 0); ctx.scale(-1, 1); }
      ctx.drawImage(SPR.duck[bob], Math.round(dk.x) - 3, Math.round(dk.y) - 4);
      ctx.restore();
    }
  }

  // speech / thought bubbles above walkers
  for (const p of Sim.travelers()) {
    if (!p.bubbleUntil || now > p.bubbleUntil || p.trip.car) continue;
    const bx = Math.round(p.x) - 5, by = Math.round(p.y) - 21;
    ctx.fillStyle = 'rgba(252,252,250,0.95)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, 12, 11, 3); else ctx.rect(bx, by, 12, 11);
    ctx.fill();
    ctx.fillStyle = 'rgba(252,252,250,0.95)';
    ctx.beginPath(); ctx.moveTo(bx + 4, by + 11); ctx.lineTo(bx + 7, by + 11); ctx.lineTo(bx + 5, by + 14); ctx.fill();
    ctx.font = '8px "Segoe UI Emoji", serif';
    ctx.fillText(p.bubble, bx + 2, by + 9);
  }

  // butterflies flutter above the meadows
  for (const bf of Life.butterflies) {
    const bx = bf.ax + Math.sin(bf.ph) * 14 + Math.sin(bf.ph * 2.7) * 5;
    const by = bf.ay - 6 + Math.cos(bf.ph * 1.4) * 8;
    const txx = bx / T, tyy = by / T;
    if (txx < vx0 || txx > vx1 || tyy < vy0 || tyy > vy1) continue;
    ctx.drawImage(SPR.butterfly[bf.v][Math.floor(now / 120) % 2], Math.round(bx), Math.round(by));
  }

  // fireworks
  for (const r of Life.rockets) {
    ctx.fillStyle = '#f2e8c0';
    ctx.fillRect(r.x, r.y, 1.5, 4);
  }
  for (const s of Life.sparks) {
    ctx.globalAlpha = Math.min(1, s.life);
    ctx.fillStyle = s.hue;
    ctx.fillRect(s.x, s.y, 2, 2);
    if ((s.x + s.y | 0) % 5 === 0) UI.lights.push({ x: s.x, y: s.y, r: 9, a: 0.35 * s.life, tint: 'pink' });
  }
  ctx.globalAlpha = 1;

  // road works: cones, barrier, dig crew
  for (const rw of Life.roadworks) {
    const rx = rw.x * T, ry = rw.y * T;
    ctx.fillStyle = '#8a6a45'; ctx.fillRect(rx + 5, ry + 6, 7, 5); // dug patch
    ctx.fillStyle = '#6b4a2f'; ctx.fillRect(rx + 6, ry + 7, 5, 3);
    for (const [cx, cy] of [[2, 2], [12, 2], [2, 12], [12, 12]]) {
      ctx.fillStyle = '#e08a3c'; ctx.fillRect(rx + cx, ry + cy, 2, 3);
      ctx.fillStyle = '#f5f1e4'; ctx.fillRect(rx + cx, ry + cy + 1, 2, 1);
    }
    ctx.fillStyle = '#e8b93c'; ctx.fillRect(rx + 3, ry - 3, 10, 3);
    ctx.fillStyle = '#3c3c3c'; for (let sx = 4; sx < 12; sx += 3) ctx.fillRect(rx + sx, ry - 3, 1, 3);
    const wf = Math.floor(now / 300) % 2;
    const w1 = SPR.person('hiker', rw.x * 7 + rw.y);
    ctx.drawImage(w1.f[wf], rx - 3, ry + 2 - wf);
    ctx.drawImage(w1.f[1 - wf], rx + 15, ry + 8 - (1 - wf));
  }
  // election banners strung over the streets during campaign week
  if (typeof Gov !== 'undefined' && Gov.campaign) {
    for (const bn of Gov.campaign.banners) {
      if (bn.x < vx0 || bn.x > vx1 || bn.y < vy0 || bn.y > vy1) continue;
      const cand = Gov.campaign.candidates[bn.ci % Gov.campaign.candidates.length];
      const bx = bn.x * T + 2, by = bn.y * T - 7;
      ctx.fillStyle = '#6d5333';
      ctx.fillRect(bx, by, 1, 9); ctx.fillRect(bx + 11, by, 1, 9);
      const fl = Math.sin(now / 260 + bn.x * 1.7) > 0 ? 0 : 1;
      ctx.fillStyle = cand.color || '#4f8ede';
      ctx.fillRect(bx + 1, by + fl, 10, 4);
      ctx.fillStyle = 'rgba(255,252,240,0.9)'; // "lettering"
      ctx.fillRect(bx + 2, by + fl + 1, 2, 2); ctx.fillRect(bx + 5, by + fl + 1, 1, 2); ctx.fillRect(bx + 7, by + fl + 1, 2, 2);
    }
  }
  // crash site
  if (Life.crash) {
    const c = Life.crash;
    for (const [seed, ang, ox, oy2] of [[c.s1, c.a1, -5, -3], [c.s2, c.a2, 5, 3]]) {
      ctx.save();
      ctx.translate(c.x + ox, c.y + oy2);
      ctx.rotate(ang);
      ctx.drawImage(SPR.car(seed).h, -6, -4);
      ctx.restore();
    }
    if (Math.random() < 0.3) UI.smoke.push({ x: c.x + (Math.random() * 10 - 5), y: c.y - 2, r: 1.5 + Math.random(), life: 0.8 });
    const ft = (c.t0 || 28) - c.t; // impact flash in the first 4 game-min
    if (ft < 4) { ctx.globalAlpha = 1 - ft / 4; ctx.fillStyle = '#fff3c0'; ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(0, ft * 5), 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
  }

  updateSmoke(now);
  for (const s of UI.smoke) {
    ctx.globalAlpha = s.life * 0.35;
    ctx.fillStyle = Weather.season === 3 ? '#dde4ea' : '#c8c8cc';
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;

  Weather.renderClouds(ctx);

  // aircraft above the clouds
  for (const pl of Life.planes) {
    ctx.globalAlpha = 0.18 * Math.max(0.3, 1 - pl.alt / 160);
    ctx.fillStyle = '#0a1410';
    ctx.beginPath(); ctx.ellipse(pl.x + 8, pl.y + pl.alt + 6, 9, 3, 0, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.drawImage(SPR.plane, Math.round(pl.x), Math.round(pl.y - pl.alt));
    if (dark > 0.15) UI.lights.push({ x: pl.x + 10, y: pl.y - pl.alt + 7, r: 12, a: 0.7, tint: 'red' });
  }
  // hot-air balloons
  for (const bl of Life.balloons) {
    const by = bl.y + Math.sin(bl.ph) * 4;
    ctx.drawImage(SPR.balloon, Math.round(bl.x), Math.round(by));
  }
  // helicopters — rotor thump, ground shadow shrinking with altitude
  for (const h of Life.helis) {
    ctx.globalAlpha = 0.16 * Math.max(0.25, 1 - h.alt / 60);
    ctx.fillStyle = '#0a1410';
    ctx.beginPath(); ctx.ellipse(h.x, h.y + 5, 8 * Math.max(0.5, 1 - h.alt / 90), 2.6, 0, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
    const hy = h.y - h.alt;
    ctx.drawImage(SPR.heli, Math.round(h.x) - 8, Math.round(hy) - 5);
    ctx.drawImage(SPR.heliRotor[Math.floor(now / 70) % 2], Math.round(h.x) - 10, Math.round(hy) - 8);
    if (dark > 0.12) UI.lights.push({ x: h.x, y: hy, r: 14, a: 0.8, tint: 'red' });
  }
  // the tornado funnel, when the worst is on the ground
  if (typeof Calamity !== 'undefined' && Calamity.tornado) {
    const tn = Calamity.tornado;
    ctx.globalAlpha = 0.25; ctx.fillStyle = '#1a2018'; // ground shadow
    ctx.beginPath(); ctx.ellipse(tn.x, tn.y + 3, 8, 3, 0, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
    for (let k = 0; k < 7; k++) { // the whirling column
      const rr = 3 + k * 2.2;
      const off = Math.sin(tn.ph + k * 1.2) * (2 + k * 0.8);
      ctx.fillStyle = `rgba(92,97,108,${0.6 - k * 0.055})`;
      ctx.beginPath(); ctx.ellipse(tn.x + off, tn.y - k * 7, rr, rr * 0.45, 0, 0, 7); ctx.fill();
    }
    ctx.fillStyle = '#6e5a44'; // flying debris
    for (let k = 0; k < 5; k++) {
      const a = tn.ph * 2 + k * 1.3;
      ctx.fillRect(tn.x + Math.cos(a) * (6 + k * 3), tn.y - 8 - k * 5 + Math.sin(a) * 4, 2, 2);
    }
  }
  // Santa's sleigh crossing the midnight sky, reindeer first
  if (typeof Festivals !== 'undefined' && Festivals.sleigh) {
    const sl = Festivals.sleigh;
    const sy2 = sl.y + Math.sin(sl.ph) * 5 - 46; // flying high
    ctx.globalAlpha = 0.15; ctx.fillStyle = '#0a1410';
    ctx.beginPath(); ctx.ellipse(sl.x + 18, sl.y + 8, 14, 3, 0, 0, 7); ctx.fill(); // moon-shadow below
    ctx.globalAlpha = 1;
    ctx.drawImage(SPR.sleigh, Math.round(sl.x), Math.round(sy2));
    UI.lights.push({ x: sl.x + 19, y: sy2 + 5, r: 10, a: 0.9, tint: 'red' });   // that nose
    UI.lights.push({ x: sl.x + 29, y: sy2 + 7, r: 14, a: 0.6, tint: 'warm' });
    if (Math.random() < 0.2) { // stardust in the wake
      ctx.fillStyle = '#fff2b0';
      ctx.fillRect(sl.x - 4 + Math.random() * 6, sy2 + 4 + Math.random() * 6, 1, 1);
    }
  }

  /* ---- screen-space: dusk tint, darkness, emissive, precip ---- */
  const dt2 = duskTint();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (dt2 > 0) { ctx.fillStyle = `rgba(255,140,60,${dt2})`; ctx.fillRect(0, 0, canvas.width, canvas.height); }

  drawNight(dark, z);

  // emissive layer: window glow, flames, fireflies
  ctx.setTransform(z, 0, 0, z, -UI.camX * z, -UI.camY * z);
  if (dark > 0.12) {
    const litA = Math.min(1, dark * 1.8);
    for (const e of ents) {
      if (e.kind !== 'bld') continue;
      const b = e.b;
      const lf = buildingLit(b); // closed shops & sleeping homes stay dark
      if (lf <= 0.05) continue;
      const skey = (b.type === 'house' && b.level > 1) ? 'house' + b.level : b.type;
      const s = SPR.b[skey][b.variant % SPR.b[skey].length];
      ctx.globalAlpha = litA * lf;
      ctx.drawImage(s.lit, b.x * T, b.y * T - s.oy);
    }
    ctx.globalAlpha = 1;
    for (const L of UI.lights) if (L.flame) {
      ctx.fillStyle = '#ffcf70'; ctx.fillRect(L.x - 1, L.y - 2, 2, 2);
      ctx.fillStyle = '#ff8438'; ctx.fillRect(L.x - 1, L.y, 2, 1);
    }
    // summer fireflies in the trees
    if (Weather.season === 1 && !raining && dark > 0.3) {
      for (const f of Life.fireflySpots) {
        const tx = f.x / T, ty = f.y / T;
        if (tx < vx0 || tx > vx1 || ty < vy0 || ty > vy1) continue;
        const blink = Math.sin(now / 480 + f.ph * 4);
        if (blink > 0.45) {
          const fx = f.x + Math.sin(now / 900 + f.ph) * 5, fy = f.y - 6 + Math.cos(now / 1100 + f.ph * 2) * 4;
          ctx.fillStyle = `rgba(190,255,150,${(blink - 0.45) * 1.6})`;
          ctx.fillRect(fx, fy, 1.5, 1.5);
        }
      }
    }
    // the visitor from elsewhere
    if (Life.ufo) {
      const u = Life.ufo;
      if (u.t > 0) { // hovering: beam
        const grad = ctx.createLinearGradient(u.x + 8, u.y + 6, u.x + 8, u.y + 60);
        grad.addColorStop(0, 'rgba(150,255,190,0.30)');
        grad.addColorStop(1, 'rgba(150,255,190,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(u.x + 5, u.y + 6); ctx.lineTo(u.x + 11, u.y + 6);
        ctx.lineTo(u.x + 26, u.y + 60); ctx.lineTo(u.x - 10, u.y + 60);
        ctx.fill();
      }
      ctx.drawImage(SPR.ufo, Math.round(u.x), Math.round(u.y + Math.sin(now / 200) * 2));
      UI.lights.push({ x: u.x + 8, y: u.y + 4, r: 26, a: 0.8, tint: 'green' });
    }
  }
  // birds (day sky)
  if (dark < 0.5) {
    for (const b of Life.birds) {
      const bx = b.x / T, by = b.y / T;
      if (bx < vx0 || bx > vx1 || by < vy0 || by > vy1) continue;
      ctx.drawImage(SPR.bird[Math.sin(b.ph) > 0 ? 0 : 1], Math.round(b.x), Math.round(b.y));
    }
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // rainbow after the rain
  if (Weather.rainbowT > 0) {
    const fade = Math.min(1, Weather.rainbowT / 8) * 0.16;
    const cx2 = canvas.width * 0.5, cy2 = canvas.height * 1.15, r0 = canvas.width * 0.52;
    const cols = ['#ff5a5a', '#ffa04f', '#ffe25f', '#6fdc6f', '#5fa8ff', '#a06fff'];
    ctx.lineWidth = 4;
    for (let i = 0; i < cols.length; i++) {
      ctx.strokeStyle = cols[i];
      ctx.globalAlpha = fade;
      ctx.beginPath(); ctx.arc(cx2, cy2, r0 - i * 4, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  // shooting stars on clear nights
  if (Weather.kind === 'clear' && dark > 0.5) {
    if (!UI.stars) UI.stars = [];
    if (UI.stars.length < 2 && Math.random() < 0.006)
      UI.stars.push({ x: Math.random() * canvas.width, y: Math.random() * canvas.height * 0.4, vx: 220 + Math.random() * 120, life: 0.9 });
    for (const st of UI.stars) {
      st.x += st.vx * dtReal; st.y += st.vx * 0.35 * dtReal; st.life -= dtReal * 1.1;
      ctx.strokeStyle = `rgba(240,246,255,${Math.max(0, st.life) * 0.8})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(st.x, st.y); ctx.lineTo(st.x - 16, st.y - 6); ctx.stroke();
    }
    UI.stars = UI.stars.filter(s => s.life > 0 && s.x < canvas.width + 30);
  }
  Weather.renderPrecip(ctx, canvas.width, canvas.height, dtReal);

  ctx.setTransform(z, 0, 0, z, -UI.camX * z, -UI.camY * z);
  drawGhost();
  if (UI.selected && World.buildings.includes(UI.selected)) {
    const b = UI.selected;
    ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 1.5 / z;
    ctx.strokeRect(b.x * T - 1, b.y * T - 1, b.w * T + 2, b.h * T + 2);
  } else if (UI.selected) { UI.selected = null; hideInfo(); }
  // a golden ring follows the villager under inspection
  if (UI.selectedPerson) {
    const sp = UI.selectedPerson;
    if (!Sim.people.includes(sp)) UI.selectedPerson = null;
    else if (sp.state === 'walk') {
      ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 1.5 / z;
      ctx.beginPath(); ctx.arc(sp.x, sp.y - 4, 7, 0, 7); ctx.stroke();
    }
  }
  // undo the earthquake jolt so the camera doesn't wander
  UI.camX -= shakeRX; UI.camY -= shakeRY;
}

/* darkness overlay with light pools punched out */
function drawNight(dark, z) {
  if (dark <= 0.02) return;
  if (!UI.nightCanvas) { UI.nightCanvas = document.createElement('canvas'); UI.nightCtx = UI.nightCanvas.getContext('2d'); }
  if (UI.nightCanvas.width !== canvas.width || UI.nightCanvas.height !== canvas.height) {
    UI.nightCanvas.width = canvas.width; UI.nightCanvas.height = canvas.height;
  }
  const ng = UI.nightCtx;
  ng.globalCompositeOperation = 'source-over';
  ng.globalAlpha = 1;
  ng.clearRect(0, 0, canvas.width, canvas.height);
  ng.fillStyle = `rgba(7,11,30,${dark})`;
  ng.fillRect(0, 0, canvas.width, canvas.height);
  ng.globalCompositeOperation = 'destination-out';
  const k = Math.min(1, dark / 0.45);
  for (const L of UI.lights) {
    const sx = (L.x - UI.camX) * z, sy = (L.y - UI.camY) * z, sr = L.r * z;
    if (sx < -sr * 3 || sy < -sr * 3 || sx > canvas.width + sr * 3 || sy > canvas.height + sr * 3) continue;
    if (L.cone) { // headlights are BEAMS sweeping ahead, not lamp pools
      ng.save();
      ng.translate(sx, sy);
      // NB: dirx must NOT fall back to 1 — a straight-north/south car has
      // dirx 0, and `|| 1` used to skew its beam 45° off to the east
      ng.rotate(Math.atan2(L.diry || 0, L.dirx || 0));
      ng.globalAlpha = Math.min(1, L.a * k);
      ng.drawImage(SPR.beam, 0, -sr * 0.55, sr * 2.6, sr * 1.1);
      ng.restore();
      continue;
    }
    ng.globalAlpha = Math.min(1, L.a * k);
    ng.drawImage(SPR.glow, sx - sr, sy - sr, sr * 2, sr * 2);
  }
  ng.globalAlpha = 1;
  ctx.drawImage(UI.nightCanvas, 0, 0);
  // colored halos & cool beam tint
  ctx.globalCompositeOperation = 'screen';
  for (const L of UI.lights) {
    const sx = (L.x - UI.camX) * z, sy = (L.y - UI.camY) * z, sr = L.r * z * 1.15;
    if (sx < -sr * 3 || sy < -sr * 3 || sx > canvas.width + sr * 3 || sy > canvas.height + sr * 3) continue;
    if (L.cone) {
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(Math.atan2(L.diry || 0, L.dirx || 0)); // no `|| 1` — keeps N/S beams straight
      ctx.globalAlpha = Math.min(0.4, L.a * k * 0.35);
      ctx.drawImage(SPR.beamTint, 0, -sr * 0.5, sr * 2.3, sr);
      ctx.restore();
      continue;
    }
    if (!L.tint) continue;
    ctx.globalAlpha = Math.min(0.5, L.a * k * 0.45);
    ctx.drawImage(SPR.glowTints[L.tint], sx - sr, sy - sr, sr * 2, sr * 2);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function updateSmoke(now) {
  if (!updateSmoke.last) updateSmoke.last = 0;
  if (now - updateSmoke.last > 380 && UI.speedIdx > 0) {
    updateSmoke.last = now;
    for (const b of World.buildings) {
      if (UI.smoke.length > 200) break;
      const d = CAT[b.type];
      if (d.smoke) {
        UI.smoke.push({ x: b.x * T + b.w * T - 9, y: b.y * T - d.ex + 1, r: 1.5 + Math.random(), life: 1 });
        UI.smoke.push({ x: b.x * T + b.w * T - 18, y: b.y * T - d.ex + 3, r: 1.2 + Math.random(), life: 0.9 });
      } else if (Weather.season === 3 && (b.type === 'house' || b.type === 'cottage') &&
                 b.residents.length && (b.id + Math.floor(now / 380)) % 3 === 0) {
        // cozy winter chimneys
        UI.smoke.push({ x: b.x * T + b.w * T - 7, y: b.y * T - d.ex + 2, r: 1 + Math.random() * 0.8, life: 0.8 });
      }
    }
  }
  const spd = UI.speeds[UI.speedIdx];
  for (const s of UI.smoke) { s.y -= 0.12 * spd; s.x += 0.03 * spd; s.r += 0.012 * spd; s.life -= 0.004 * (spd || 1); }
  UI.smoke = UI.smoke.filter(s => s.life > 0);
}

/* =============== ghost preview =============== */
function drawGhost() {
  if (!UI.tool || !UI.hover) return;
  const d = CAT[UI.tool.key], { x, y } = UI.hover;
  const z = UI.zoom;
  if (d.draw) {
    const ok = World.canPlace(UI.tool.key, x, y);
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = ok ? '#4fe07a' : '#e05a5a';
    ctx.fillRect(x * T, y * T, d.w * T, d.h * T);
    ctx.globalAlpha = 0.65;
    const s = SPR.b[UI.tool.key][0];
    ctx.drawImage(s.img, x * T, y * T - s.oy);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ok ? '#4fe07a' : '#e05a5a'; ctx.lineWidth = 1.5 / z;
    ctx.strokeRect(x * T, y * T, d.w * T, d.h * T);
    ctx.fillStyle = '#ffe066';
    ctx.fillRect((x + (d.w >> 1)) * T + 5, (y + d.h) * T + 2, 6, 3);
  } else {
    ctx.globalAlpha = 0.4;
    if (d.tool === 'bulldoze') { ctx.fillStyle = '#e05a5a'; ctx.fillRect(x * T, y * T, T, T); }
    if (d.tool === 'tree') { ctx.fillStyle = '#4fe07a'; ctx.fillRect(x * T, y * T, T, T); }
    if (d.tool === 'forest') { ctx.fillStyle = '#4fe07a'; ctx.beginPath(); ctx.arc(x * T + 8, y * T + 8, 3.2 * T, 0, 7); ctx.fill(); }
    if (d.tool === 'pond') { ctx.fillStyle = '#57a5e8'; ctx.beginPath(); ctx.arc(x * T + 8, y * T + 8, 1.8 * T, 0, 7); ctx.fill(); }
    if (d.tool === 'lake') { ctx.fillStyle = '#57a5e8'; ctx.beginPath(); ctx.ellipse(x * T + 8, y * T + 8, 4.5 * T, 3.2 * T, 0, 0, 7); ctx.fill(); }
    if (d.tool === 'mountain') { ctx.fillStyle = '#98938a'; ctx.fillRect((x - (MSIZE >> 1)) * T, (y - (MSIZE >> 1)) * T, MSIZE * T, MSIZE * T); }
    ctx.globalAlpha = 1;
    if (UI.dragStart && (d.tool === 'road' || d.tool === 'river' || d.tool === 'rail')) {
      ctx.globalAlpha = 0.55;
      const s = UI.dragStart;
      if (d.tool === 'road' || d.tool === 'rail') {
        ctx.fillStyle = d.tool === 'rail' ? '#a5824f' : '#cfcaba';
        const sx = Math.sign(x - s.x) || 1, sy = Math.sign(y - s.y) || 1;
        for (let xx = s.x; xx !== x + sx; xx += sx) ctx.fillRect(xx * T, s.y * T, T, T);
        for (let yy = s.y; yy !== y + sy; yy += sy) ctx.fillRect(x * T, yy * T, T, T);
      } else {
        ctx.strokeStyle = '#57a5e8'; ctx.lineWidth = 10; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(s.x * T + 8, s.y * T + 8); ctx.lineTo(x * T + 8, y * T + 8); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }
}

/* =============== placement =============== */
function afterMapEdit() {
  World.refreshConnections();
  Sim.assignJobs();
  Sim.assignSchools();
  World.dirty = true;
  if (typeof Life !== 'undefined') Life.trainT = 0; // re-check the railway right away
}

function placeAt(x, y) {
  const d = CAT[UI.tool.key];
  if (d.draw) {
    const b = World.placeBuilding(UI.tool.key, x, y);
    if (!b) return;
    afterMapEdit();
    Snd.place();
    toast(`🏗️ ${d.name} under construction${b.connected ? '' : ' — ⚠️ no road access!'}`);
  } else switch (d.tool) {
    case 'tree': World.placeTree(x, y); break;
    case 'forest': World.placeForest(x, y); break;
    case 'pond': World.stampWaterDisc(x, y, 1.8); afterMapEdit(); break;
    case 'lake': World.stampLake(x, y, 4 + Math.random() * 1.5, 2.8 + Math.random(), null); afterMapEdit(); break;
    case 'mountain':
      if (World.placeMountain(x - (MSIZE >> 1), y - (MSIZE >> 1))) toast('Mountain range raised ⛰️ — roads will carve around it');
      afterMapEdit(); break;
    case 'bulldoze': {
      const r = World.bulldoze(x, y);
      if (r && r.kind === 'building') { Sim.onBuildingRemoved(r.b); toast(`${CAT[r.b.type].name} demolished 🚜 — Ctrl+Z to undo`); }
      if (r) { recordBulldoze(r, x, y); afterMapEdit(); Snd.crunch(); }
      break;
    }
  }
}

function finishDragTool(x, y) {
  const d = CAT[UI.tool.key], s = UI.dragStart;
  if (!s) return;
  if (d.tool === 'road') { World.layRoadLine(s.x, s.y, x, y); afterMapEdit(); }
  if (d.tool === 'rail') {
    World.layRailLine(s.x, s.y, x, y); afterMapEdit();
    const nst = World.buildings.filter(b => b.type === 'trainstation' && !b.ruined).length;
    toast(nst >= 2 ? 'Railway track laid 🛤️' : 'Railway track laid 🛤️ — build two train stations to start a service');
  }
  if (d.tool === 'river') { World.carveRiver(s.x, s.y, x, y, null); afterMapEdit(); toast('River carved 🏞️'); }
  UI.dragStart = null;
}

/* =============== input =============== */
function tileFromEvent(e) {
  const r = canvas.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  return { x: Math.floor((mx / UI.zoom + UI.camX) / T), y: Math.floor((my / UI.zoom + UI.camY) / T), mx, my };
}

canvas.addEventListener('pointerdown', e => {
  const t = tileFromEvent(e);
  if (e.button === 2 || e.button === 1) {
    UI.panning = true; UI.panStart = { mx: t.mx, my: t.my, cx: UI.camX, cy: UI.camY, moved: false };
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  if (e.button !== 0) return;
  if (UI.tool) {
    const d = CAT[UI.tool.key];
    if (d.drag) { UI.dragStart = { x: t.x, y: t.y }; if (d.tool === 'bulldoze') placeAt(t.x, t.y); }
    else placeAt(t.x, t.y);
  } else {
    UI.panStart = { mx: t.mx, my: t.my, cx: UI.camX, cy: UI.camY, moved: false, maybeSelect: t };
    UI.panning = true;
    canvas.setPointerCapture(e.pointerId);
  }
});

canvas.addEventListener('pointermove', e => {
  const t = tileFromEvent(e);
  UI.hover = { x: t.x, y: t.y };
  if (UI.panning && UI.panStart) {
    const dx = t.mx - UI.panStart.mx, dy = t.my - UI.panStart.my;
    if (Math.abs(dx) + Math.abs(dy) > 4) UI.panStart.moved = true;
    UI.camX = UI.panStart.cx - dx / UI.zoom;
    UI.camY = UI.panStart.cy - dy / UI.zoom;
    clampCam();
  } else if (UI.tool && UI.dragStart && CAT[UI.tool.key].tool === 'bulldoze' && (e.buttons & 1)) {
    placeAt(t.x, t.y);
  }
});

canvas.addEventListener('pointerup', e => {
  const t = tileFromEvent(e);
  if (UI.panning) {
    UI.panning = false;
    const ps = UI.panStart; UI.panStart = null;
    if (ps && !ps.moved) {
      if (e.button === 2) { setTool(null); return; }
      if (ps.maybeSelect) selectAt(t.x, t.y, t.mx / UI.zoom + UI.camX, t.my / UI.zoom + UI.camY);
    }
    return;
  }
  if (UI.tool && UI.dragStart) {
    const d = CAT[UI.tool.key];
    if (d.tool === 'road' || d.tool === 'river' || d.tool === 'rail') finishDragTool(t.x, t.y);
    UI.dragStart = null;
  }
});

canvas.addEventListener('contextmenu', e => e.preventDefault());

function zoomAt(e, dir) {
  const levels = [1, 1.5, 2, 2.5, 3, 4];
  const r = canvas.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  const wx = mx / UI.zoom + UI.camX, wy = my / UI.zoom + UI.camY;
  let i = levels.indexOf(UI.zoom);
  if (i < 0) i = 2;
  i = Math.max(0, Math.min(levels.length - 1, i + dir));
  UI.zoom = levels[i];
  UI.camX = wx - mx / UI.zoom; UI.camY = wy - my / UI.zoom;
  clampCam();
}

/* mouse wheel zooms; trackpad two-finger scroll pans, pinch (ctrl+wheel) zooms */
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  if (e.ctrlKey) { zoomAt(e, e.deltaY < 0 ? 1 : -1); return; }              // pinch gesture
  const mouseNotch = e.deltaX === 0 && Math.abs(e.deltaY) >= 90 && e.deltaY % 1 === 0;
  if (mouseNotch) zoomAt(e, e.deltaY < 0 ? 1 : -1);                          // classic wheel
  else { UI.camX += e.deltaX / UI.zoom; UI.camY += e.deltaY / UI.zoom; clampCam(); } // trackpad pan
}, { passive: false });

window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const pan = 26 / UI.zoom * 8;
  if (e.key === 'ArrowLeft' || e.key === 'a') UI.camX -= pan;
  if (e.key === 'ArrowRight' || e.key === 'd') UI.camX += pan;
  if (e.key === 'ArrowUp' || e.key === 'w') UI.camY -= pan;
  if (e.key === 'ArrowDown' || e.key === 's') UI.camY += pan;
  if (e.key === 'Escape') {
    setTool(null); hideInfo();
    for (const id of ['settings', 'saveui', 'statsui', 'newmap'])
      document.getElementById(id).style.display = 'none';
  }
  if (e.key === ' ') { e.preventDefault(); setSpeed(UI.speedIdx === 0 ? 1 : 0); }
  if (e.key >= '1' && e.key <= '4') setSpeed(+e.key - 1);
  if (e.key === 'h' || e.key === 'H') toggleSidebar();
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undoBulldoze(); }
  clampCam();
});

function clampCam() {
  const vw = canvas.width / UI.zoom, vh = canvas.height / UI.zoom;
  UI.camX = Math.max(-vw * 0.3, Math.min(GW * T - vw * 0.7, UI.camX));
  UI.camY = Math.max(-vh * 0.3, Math.min(GH * T - vh * 0.7, UI.camY));
}

function selectAt(x, y, wx, wy) {
  // a walking villager under the cursor wins over the building behind them
  if (wx !== undefined) {
    let best = null, bd = 10;
    for (const p of Sim.travelers()) {
      const d = Math.abs(p.x - wx) + Math.abs(p.y - wy);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) { UI.selected = null; UI.selectedPerson = best; showPersonInfo(best); return; }
  }
  UI.selectedPerson = null;
  const b = World.buildingAt(x, y);
  UI.selected = b || null;
  if (b) showInfo(b); else hideInfo();
}

/* =============== sidebar palette =============== */
const CAT_GROUPS = [
  ['tool', '🛠️ Tools'],
  ['res', '🏠 Residential'],
  ['work', '🏭 Work & Industry'],
  ['shop', '🛍️ Shops & Services'],
  ['civic', '🏛️ Civic'],
  ['transport', '🚌 Transport'],
  ['leisure', '🎡 Leisure & Fun'],
  ['nature', '🌲 Nature'],
];

/* what a palette item will actually DO for the town — shown on hover */
function paletteTip(key, d) {
  const bits = [d.name];
  if (d.res === 'family') bits.push('one family moves in');
  if (d.res === 'block') bits.push(`${d.fams || 4} families move in`);
  if (d.jobs) bits.push(`${d.jobs} jobs`);
  if (d.hours && d.hours.e - d.hours.s < 1440)
    bits.push(`open ${Math.floor(d.hours.s / 60)}:00–${Math.floor(d.hours.e / 60)}:00`);
  if (d.visit === 'shop') bits.push('villagers run errands here');
  if (d.visit === 'leisure') bits.push('evenings out & weekends');
  const notes = {
    police: 'answers crimes, crashes & disputes', fire: 'douses fires before ruin',
    school: 'kids enroll on weekdays', college: 'jobless adults study here',
    hospital: 'catches the unwell', courthouse: 'trials & stronger convictions',
    bank: 'founders can take business loans', townhall: "the mayor's office",
    busstop: 'two stops start a bus line', trainstation: 'two railed stations start trains',
    taxistand: 'cabs for the car-less', dock: 'boats, ferries & waterfront work',
    watertower: 'clean water (drought insurance)', powerplant: 'electric light for the town',
    park: 'free fun, happier neighbours', casino: 'the house usually wins',
    exchange: 'the five tickers get a floor', tvstation: 'news travels town-wide instantly',
    farm: 'the village grows what it eats', airport: 'planes bring extra visitors',
  };
  if (notes[key]) bits.push(notes[key]);
  return bits.join('\n');
}

function buildPalette() {
  const el = document.getElementById('palette');
  for (const [cat, label] of CAT_GROUPS) {
    const h = document.createElement('div');
    h.className = 'pal-head'; h.textContent = label;
    el.appendChild(h);
    const grid = document.createElement('div');
    grid.className = 'pal-grid';
    el.appendChild(grid);
    for (const key in CAT) {
      const d = CAT[key];
      if (d.cat !== cat) continue;
      const item = document.createElement('div');
      item.className = 'pal-item'; item.dataset.key = key; item.title = paletteTip(key, d);
      if (d.draw) {
        const th = document.createElement('canvas');
        th.width = 44; th.height = 44;
        const tg = th.getContext('2d');
        tg.imageSmoothingEnabled = false;
        const s = SPR.b[key][0];
        const sc = Math.min(42 / s.img.width, 42 / s.img.height, 2);
        tg.drawImage(s.img, (44 - s.img.width * sc) / 2, (44 - s.img.height * sc) / 2, s.img.width * sc, s.img.height * sc);
        item.appendChild(th);
      } else {
        const em = document.createElement('div');
        em.className = 'pal-emoji'; em.textContent = d.emoji;
        item.appendChild(em);
      }
      const nm = document.createElement('div');
      nm.className = 'pal-name'; nm.textContent = d.name;
      item.appendChild(nm);
      item.addEventListener('pointerdown', ev => { ev.preventDefault(); setTool(key); });
      grid.appendChild(item);
    }
  }
}

function setTool(key) {
  UI.tool = key ? { key } : null;
  UI.dragStart = null;
  document.querySelectorAll('.pal-item').forEach(i => i.classList.toggle('active', !!key && i.dataset.key === key));
  const hint = document.getElementById('hint');
  if (!key) hint.textContent = 'Click a building to inspect · drag to pan · wheel to zoom · pick something from the palette to build';
  else {
    const d = CAT[key];
    if (d.drag) hint.textContent = `${d.name}: click & drag on the map, release to apply · right-click to cancel`;
    else hint.textContent = `${d.name}: click the map to place · roads connect automatically · right-click to cancel`;
  }
}

/* =============== HUD / info / toasts =============== */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function updateHUD() {
  const s = Sim.stats();
  // full village date: weekday, season-day, year (28-day years, 7-day seasons)
  const vYear = Math.floor((Sim.day - 1) / 28) + 1;
  const seasonDay = ((Sim.day - 1) % 7) + 1;
  document.getElementById('clock').textContent =
    `Day ${Sim.day} · ${WEEKDAYS[Sim.day % 7]} ${seasonDay} ${SEASONS[Weather.season]}, Yr ${vYear} · ${Sim.timeStr()}`;
  // Christmas runs in real time: fast-forward locks per the player's setting
  const xmasLock = typeof Festivals !== 'undefined' && Festivals.speedLocked();
  document.querySelectorAll('#speed button').forEach((b, n) => b.classList.toggle('locked', xmasLock && n >= 2));
  document.getElementById('chip-season').textContent = Weather.label();
  const fc = Weather.forecastEmoji();
  document.getElementById('chip-weather').textContent = Weather.weatherLabel() + (fc ? ` → ${fc}` : '');
  // the village tier: how far up the charter ladder we've climbed
  const tierEl = document.getElementById('chip-tier');
  if (tierEl && typeof TIERS !== 'undefined') {
    const ti = Sim.tierIndex();
    tierEl.textContent = `${TIERS[ti].emoji} ${TIERS[ti].name}`;
    const next = TIERS[ti + 1];
    tierEl.title = next ? `${s.pop}/${next.pop} residents to become a ${next.name}` : 'The summit: a Metropolis!';
  }
  document.getElementById('stat-pop').textContent = s.pop;
  document.getElementById('stat-jobs').textContent = `${s.employed}/${s.adults}`;
  document.getElementById('stat-wealth').textContent = '$' + s.wealth.toLocaleString();
  document.getElementById('stat-safe').textContent = s.safety + '%';
  document.getElementById('stat-hap').textContent = s.happiness + '%';
  const em = document.getElementById('stat-hap-emoji');
  em.textContent = s.happiness >= 75 ? '😊' : s.happiness >= 45 ? '🙂' : '😟';
  const leaderEl = document.getElementById('stat-leader');
  const leaderWrap = document.getElementById('stat-leader-wrap');
  if (leaderEl) {
    if (typeof Gov !== 'undefined' && Gov.campaign) {
      const d = Math.max(0, Gov.campaign.electionDay - Sim.day);
      leaderEl.textContent = d === 0 ? '🗳️ VOTING DAY' : (Gov.leader ? Gov.leader.name : 'Campaign season') + ` · 🗳️ ${d}d`;
      if (leaderWrap) leaderWrap.title = 'Election campaign: ' + Gov.campaign.candidates.map(c => `${c.name} ${c.type.emoji}`).join(' vs ');
    } else if (typeof Gov !== 'undefined' && Gov.leader) {
      leaderEl.textContent = `${Gov.leader.name} · ${Math.round(Gov.approval)}%`;
      if (leaderWrap) leaderWrap.title = `${Gov.leader.type.label}; elected with ${Gov.leader.voteShare || 0}% of the vote` +
        (Gov.leader.promise ? `; promised ${Gov.leader.promise}` : '');
    } else {
      leaderEl.textContent = 'Self-governing';
      if (leaderWrap) leaderWrap.title = 'The village will elect a mayor once enough adults live here';
    }
  }
  // RCI demand meters
  document.getElementById('rci-r').style.height = Math.round(s.demand.r * 100) + '%';
  document.getElementById('rci-c').style.height = Math.round(s.demand.c * 100) + '%';
  document.getElementById('rci-i').style.height = Math.round(s.demand.i * 100) + '%';
  updateMinimap();
}

/* ---------------- SimCity-style minimap ---------------- */
const MM_COLORS = {
  res: '#3fae5c', shop: '#4f7ed0', work: '#d0a83f', civic: '#9aa4b4', leisure: '#c05fa8', hidden: '#3fae5c',
  transport: '#4fc0b0',
};
function updateMinimap() {
  const mc = document.getElementById('minimap');
  if (!mc) return;
  const mg = mc.getContext('2d');
  const img = mg.createImageData(GW, GH);
  const put = (i, r, g2, b2) => { img.data[i * 4] = r; img.data[i * 4 + 1] = g2; img.data[i * 4 + 2] = b2; img.data[i * 4 + 3] = 255; };
  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const winter = Weather.season === 3;
  const dry = typeof Calamity !== 'undefined' && Calamity.droughtLevel >= 0.5;
  for (let i = 0; i < GW * GH; i++) {
    const g0 = World.ground[i];
    if (g0 === G_WATER) { if (dry && !winter) put(i, 201, 180, 138); else put(i, 63, 127, 208); }
    else if (g0 === G_ROCK) put(i, 126, 122, 114);
    else if (g0 === G_SAND) put(i, winter ? 224 : 226, winter ? 226 : 211, winter ? 230 : 168);
    else if (World.tree[i]) put(i, winter ? 150 : 30, winter ? 160 : 58, winter ? 175 : 32);
    else if (World.railMap[i]) put(i, 122, 92, 56);
    else if (World.roadMap[i]) put(i, 44, 46, 52);
    else put(i, winter ? 208 : 40, winter ? 216 : 74, winter ? 228 : 44);
  }
  for (const b of World.buildings) {
    let col = MM_COLORS[CAT[b.type].cat] || '#b0b0b0';
    if (b.construction) col = '#e08a3c';
    if (b.fire) col = '#ff5040';
    if (b.ruined) col = '#5a564e';
    const [r, g2, b2] = hex(col);
    for (let j = 0; j < b.h; j++) for (let k = 0; k < b.w; k++) put(World.idx(b.x + k, b.y + j), r, g2, b2);
  }
  mg.putImageData(img, 0, 0);
  // incident pins: flashing markers where something just happened
  if (UI.pins && UI.pins.length) {
    const nowT = performance.now();
    UI.pins = UI.pins.filter(p => p.until > nowT);
    if (Math.floor(nowT / 300) % 2 === 0) {
      mg.fillStyle = '#ff4040';
      for (const p of UI.pins) mg.fillRect((p.x / T) - 1, (p.y / T) - 1, 3, 3);
    }
  }
  // viewport rectangle
  const sc = GW / (GW * T); // 1/T
  mg.strokeStyle = '#ffe066';
  mg.lineWidth = 1;
  mg.strokeRect(UI.camX * sc, UI.camY * sc, (canvas.width / UI.zoom) * sc, (canvas.height / UI.zoom) * sc);
}

function setSpeed(i) {
  // Christmas is savoured, not skipped: fast-forward closes per the setting
  if (i > 1 && typeof Festivals !== 'undefined' && Festivals.speedLocked()) {
    if (UI.speedIdx !== 1) i = 1;
    else { toast('🎄 Christmas runs at its own unhurried pace — fast-forward reopens after the celebrations'); i = 1; }
  }
  UI.speedIdx = i;
  document.querySelectorAll('#speed button').forEach((b, n) => b.classList.toggle('active', n === i));
}

function panTo(wx, wy) {
  UI.camX = wx - canvas.width / (2 * UI.zoom);
  UI.camY = wy - canvas.height / (2 * UI.zoom);
  clampCam();
}

/* `at` (world px {x,y}) makes a toast clickable — one click pans the camera
   to the scene — and drops a flashing pin on the minimap */
function toast(msg, at) {
  if (typeof Tasks !== 'undefined') Tasks.log(msg); // nothing is lost — it all lands in the task book
  if (at) {
    UI.pins = UI.pins || [];
    UI.pins.push({ x: at.x, y: at.y, until: performance.now() + 12000 });
  }
  const wrap = document.getElementById('toasts');
  const t = document.createElement('div');
  t.className = 'toast' + (at ? ' jump' : '');
  t.textContent = (at ? '📍 ' : '') + msg;
  if (at) t.addEventListener('click', () => panTo(at.x, at.y));
  wrap.appendChild(t);
  // fast-forward fires events in bursts — keep the stack short and let each
  // one clear quickly so toasts never blanket the screen (the task book keeps
  // the full record either way). Clickable "jump" toasts always linger.
  const spd = UI.speeds[UI.speedIdx] || 1;
  const maxStack = spd >= 8 ? 2 : spd >= 3 ? 3 : 4;
  while (wrap.children.length > maxStack) wrap.removeChild(wrap.firstChild);
  const life = at ? 9000 : Math.round(6000 / Math.sqrt(Math.max(1, spd)));
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, life);
}

function showInfo(b) {
  const d = CAT[b.type];
  const el = document.getElementById('info');
  el.style.display = 'block';
  let rows = `<div class="info-title">${d.emoji || '🏠'} ${d.name}${b.level > 1 ? ' ★'.repeat(b.level - 1) : ''}</div>`;
  if (b.construction > 0) rows += `<div class="info-row">🏗️ Under construction — ${Math.max(1, Math.round(b.construction))} min left</div>`;
  if (b.ruined) rows += `<div class="info-row">💔 Burned down — bulldoze to clear the site</div>`;
  if (b.fire) rows += `<div class="info-row">🔥 ON FIRE!</div>`;
  if (b.upgrading > 0) rows += `<div class="info-row">🔨 Adding a floor…</div>`;
  if (b.renovating > 0) rows += `<div class="info-row">🎨 Being renovated</div>`;
  rows += `<div class="info-row">${b.connected ? '🛣️ Connected to roads' : '⚠️ No road access!'}</div>`;
  if (b.type === 'trainstation')
    rows += `<div class="info-row">${Life.stationRailDoor(b) ? '🛤️ Rail track connected' : '⚠️ No rails yet — drag the Railway tool up to this station'}</div>`;
  if (b.type === 'busstop' && World.buildings.filter(q => q.type === 'busstop' && !q.construction && !q.ruined).length < 2)
    rows += `<div class="info-row">💡 Place a second bus stop to start the bus line</div>`;
  if (typeof Gov !== 'undefined' && !b.ruined)
    rows += `<div class="info-row">📍 ${Gov.districtName(b.x, b.y)} · land value $${Gov.landPrice(b.x, b.y)}/tile</div>`;
  if (CAT[b.type].res && !b.ruined) {
    rows += `<div class="info-row">💰 Savings: $${Math.round(b.funds)}</div>`;
    if (b.ownerId) rows += `<div class="info-row">🔑 Renting from another family</div>`;
  }
  if (d.visit && b.funds > 0) rows += `<div class="info-row">💵 Lifetime earnings: $${Math.round(b.funds)}</div>`;
  if (b.founderId) {
    const f = Sim.people.find(p => p.id === b.founderId);
    if (f) {
      rows += `<div class="info-row">🧑‍💼 Owner: ${Sim.fullName(f)}${f.loan ? ` (loan: $${Math.round(f.loan.balance)} left)` : ''}</div>`;
      if (b.landPrice) rows += `<div class="info-row">🪧 Plot bought from the village for $${b.landPrice}</div>`;
      if (b.badDays >= 4) rows += `<div class="info-row">📉 Struggling — ${b.badDays} slow days</div>`;
    }
  }
  if (b.residents.length) {
    const fams = [...new Set(b.residents.map(r => r.surname))];
    rows += `<div class="info-row">👥 ${b.residents.length} residents (${fams.join(', ')})</div>`;
    const names = b.residents.slice(0, 5).map(r =>
      `<span class="p-link" data-pid="${r.id}">${r.name || '·'}</span> (${r.age !== undefined ? r.age : '?'})`).join(', ');
    rows += `<div class="info-row">🪪 ${names}${b.residents.length > 5 ? '…' : ''}</div>`;
    const away = b.residents.filter(r => r.at !== b || r.state === 'walk').length;
    rows += `<div class="info-row">🚶 ${away} out right now</div>`;
    const am = b.residents.reduce((s2, r) => s2 + (r.mood === undefined ? 60 : r.mood), 0) / b.residents.length;
    rows += `<div class="info-row">${am >= 70 ? '😄' : am >= 50 ? '🙂' : am >= 35 ? '😕' : '😠'} Household mood: ${Math.round(am)}%</div>`;
    if (typeof Mind !== 'undefined') {
      // the inner life of the household: what they know, feel and remember
      const story = Mind.householdStory(b);
      if (story) rows += `<div class="info-row">🧠 ${story.who.name} remembers: ${story.memory.text} (day ${story.memory.day})</div>`;
      const knows = b.residents.reduce((s2, r) => s2 + (r.mind ? r.mind.knows.size : 0), 0);
      const pals = b.residents.reduce((s2, r) => s2 + Mind.friendCount(r), 0);
      rows += `<div class="info-row">💡 Knows ${knows} places around town · ${pals} friendship${pals === 1 ? '' : 's'}</div>`;
      const lead = b.residents.find(r => r.kind !== 'kid');
      if (lead && lead.mind) {
        const t = lead.mind.traits;
        const domName = [['sociable', t.social], ['cautious', t.caution], ['ambitious', t.ambition], ['frugal', t.thrift], ['curious', t.curiosity]]
          .sort((x, y) => y[1] - x[1])[0][0];
        rows += `<div class="info-row">🎭 ${lead.name} is the ${domName} type</div>`;
      }
    }
  }
  if (b.type === 'townhall' && typeof Gov !== 'undefined' && Gov.leader) {
    const mp = Gov.leader.personId ? Sim.people.find(q => q.id === Gov.leader.personId) : null;
    rows += `<div class="info-row">🎩 Mayor ${Gov.leader.name}'s office${mp && mp.at === b && mp.state === 'in' ? ' — the mayor is in' : ''}</div>`;
    if (Gov.leader.promise) rows += `<div class="info-row">🤞 Promised: ${Gov.leader.promise}</div>`;
    rows += `<div class="info-row">🏦 Treasury: $${Math.round(Gov.treasury)}</div>`;
  }
  if (d.jobs) rows += `<div class="info-row">💼 ${b.workers.length}/${d.jobs} jobs filled</div>`;
  if (d.visit) rows += `<div class="info-row">🧾 ${b.visitors} visitors today</div>`;
  if (b.type === 'police') rows += `<div class="info-row">🚔 ${Life.arrests} arrests town-wide</div>`;
  if (b.cars.length) rows += `<div class="info-row">🚗 ${b.cars.filter(c => c.free).length}/${b.cars.length} cars parked</div>`;
  // the exchange floor: live hometown tickers
  if (b.type === 'exchange' && Sim.stocks) {
    rows += `<div class="info-row">📊 PVX index: ${Sim.stockIndex()}</div>`;
    for (const q of Sim.stocks) {
      const up = q.price >= (q.prev || q.price);
      rows += `<div class="info-row">${up ? '▲' : '▼'} ${q.sym} <b>$${q.price.toFixed(1)}</b> — ${q.name}</div>`;
    }
  }
  // the family can be nudged up the property ladder by hand
  const canUpgrade = b.type === 'house' && !b.upgrading && !b.construction && !b.ruined &&
    b.residents.length && b.level < 3 && b.funds >= (b.level === 1 ? 250 : 600);
  if (canUpgrade) rows += `<button id="upgrade-home">🔨 Add a floor ($${b.level === 1 ? 180 : 420})</button>`;
  rows += `<button id="demolish">🚜 Demolish</button> <button id="info-close">Close</button>`;
  el.innerHTML = rows;
  if (canUpgrade) document.getElementById('upgrade-home').onclick = () => {
    if (b.level === 1) { b.funds -= 180; b.upgrading = 240; }
    else { b.funds -= 420; b.upgrading = 300; }
    toast(`🔨 The ${b.residents[0].surname}s are adding a floor — you talked them into it!`);
    showInfo(b);
  };
  document.getElementById('demolish').onclick = () => {
    recordBulldoze({ kind: 'building', b }, b.x, b.y);
    World.removeBuilding(b); Sim.onBuildingRemoved(b);
    afterMapEdit(); hideInfo(); UI.selected = null;
    toast(`${d.name} demolished 🚜 — Ctrl+Z to undo`);
  };
  document.getElementById('info-close').onclick = hideInfo;
  wirePersonLinks(el);
}
function hideInfo() { document.getElementById('info').style.display = 'none'; UI.selected = null; UI.selectedPerson = null; }

/* =============== the villager inspector ===============
   The mind system is the game's hidden gem — this window opens it up:
   click any walker (or a resident's name in a building card) to meet them. */
function showPersonInfo(p) {
  if (!Sim.people.includes(p)) { hideInfo(); return; }
  const el = document.getElementById('info');
  el.style.display = 'block';
  const kindEmoji = p.kind === 'kid' ? '🧒' : p.kind === 'woman' ? '👩' : '👨';
  const m = p.mood === undefined ? 60 : p.mood;
  const moodFace = m >= 75 ? '😄' : m >= 52 ? '🙂' : m >= 36 ? '😕' : '😠';
  let rows = `<div class="info-title">${kindEmoji} ${Sim.fullName(p)}</div>`;
  rows += `<div class="info-row">🎂 ${p.age} years old · ${moodFace} mood ${Math.round(m)}%</div>`;
  if (p.heldUntil > Sim.day) rows += `<div class="info-row">⛓️ In custody until day ${p.heldUntil}</div>`;
  rows += `<div class="info-row">🏠 The ${p.surname} household${p.home && p.home.ownerId ? ' (renting)' : ''}</div>`;
  if (p.work) rows += `<div class="info-row">💼 ${CAT[p.work.type].name} — $${Math.round((WAGES[p.work.type] || 15) * (p.wageMult || 1))}/day${(p.wageMult || 1) > 1.5 ? ' (senior)' : ''}</div>`;
  else if (p.kind === 'kid') rows += `<div class="info-row">${p.school ? '🎒 Goes to school' : '🧸 Too young for school'}</div>`;
  else if (p.age >= AGE_RETIRE) rows += `<div class="info-row">🪑 Retired after a working life</div>`;
  else rows += `<div class="info-row">🔍 Between jobs${p.lastGig ? ` — lately ${p.lastGig}` : ''}</div>`;
  rows += `<div class="info-row">🎭 ${p.lifestyle}${p.ownsBusiness ? ' · owns a business' : ''}${p.loan ? ` · loan $${Math.round(p.loan.balance)}` : ''}</div>`;
  rows += `<div class="info-row">💵 Personal savings: $${Math.round(p.savings || 0)}</div>`;
  const partner = p.partnerId ? Sim.people.find(q => q.id === p.partnerId) : null;
  if (partner) rows += `<div class="info-row">${p.married ? '💍 Married to' : '💕 Sweethearts with'} <span class="p-link" data-pid="${partner.id}">${Sim.fullName(partner)}</span></div>`;
  if (typeof Mind !== 'undefined' && p.mind) {
    const t = p.mind.traits;
    const domName = [['sociable', t.social], ['cautious', t.caution], ['ambitious', t.ambition], ['frugal', t.thrift], ['curious', t.curiosity]]
      .sort((a, b) => b[1] - a[1])[0][0];
    rows += `<div class="info-row">🧠 The ${domName} type · knows ${p.mind.knows.size} places</div>`;
    const pals = Mind.friendsOf(p);
    if (pals.length) {
      const bestPal = pals.reduce((a, b2) => (p.mind.friends.get(a.id) || 0) >= (p.mind.friends.get(b2.id) || 0) ? a : b2);
      rows += `<div class="info-row">🤝 ${pals.length} friend${pals.length > 1 ? 's' : ''} — closest: <span class="p-link" data-pid="${bestPal.id}">${Sim.fullName(bestPal)}</span></div>`;
    }
    let favB = null, favV = 0;
    for (const [bid, v] of p.mind.favorites) if (v > favV) { favV = v; favB = World.buildings.find(q => q.id === bid); }
    if (favB && favV >= 2) rows += `<div class="info-row">💚 Regular at the ${CAT[favB.type].name}</div>`;
    const mems = p.mind.memories.slice(-3).reverse();
    for (const mm of mems)
      rows += `<div class="info-row">${mm.feel > 0 ? '✨' : mm.feel < 0 ? '💭' : '·'} Day ${mm.day}: ${mm.text}</div>`;
  }
  rows += `<button id="person-home">🏠 Find home</button> <button id="info-close">Close</button>`;
  el.innerHTML = rows;
  document.getElementById('person-home').onclick = () => {
    if (p.home) panTo(p.home.x * T + p.home.w * 8, p.home.y * T + p.home.h * 8);
  };
  document.getElementById('info-close').onclick = hideInfo;
  wirePersonLinks(el);
}

function wirePersonLinks(el) {
  el.querySelectorAll('.p-link').forEach(sp => sp.addEventListener('click', () => {
    const q = Sim.people.find(o => o.id === +sp.dataset.pid);
    if (q) { UI.selected = null; UI.selectedPerson = q; showPersonInfo(q); }
  }));
}

/* =============== the mayor's report ===============
   Governance stops being a black box: click the 🗳️ chip to see who runs
   the place, what they promised, what they built, what the town still
   needs — and to set the tax pressure yourself. */
function showMayorPanel() {
  const el = document.getElementById('info');
  el.style.display = 'block';
  UI.selected = null; UI.selectedPerson = null;
  let rows = '';
  if (typeof Gov === 'undefined' || (!Gov.leader && !Gov.campaign)) {
    rows += `<div class="info-title">🗳️ Self-governing</div>`;
    rows += `<div class="info-row">No mayor yet — the village will hold its first election once six adults live here. Until then, neighbours pool savings for what's needed.</div>`;
  } else if (Gov.campaign) {
    rows += `<div class="info-title">🗳️ Election season</div>`;
    const daysLeft = Math.max(0, Gov.campaign.electionDay - Sim.day);
    rows += `<div class="info-row">${daysLeft === 0 ? 'POLLS ARE OPEN — results tonight!' : `Voting in ${daysLeft} day${daysLeft > 1 ? 's' : ''}`}</div>`;
    for (const c of Gov.campaign.candidates)
      rows += `<div class="info-row">${c.type.emoji} <b>${c.name}</b>${c.incumbent ? ' (incumbent)' : ''} — ${c.promise || c.type.label}</div>`;
  }
  if (typeof Gov !== 'undefined' && Gov.leader && !Gov.campaign) {
    const L = Gov.leader;
    const mp = L.personId ? Sim.people.find(q => q.id === L.personId) : null;
    rows += `<div class="info-title">🎩 Mayor ${L.name} ${L.type.emoji}</div>`;
    rows += `<div class="info-row">${L.type.label} · term ${L.term || 1} · elected with ${L.voteShare || 0}%</div>`;
    rows += `<div class="info-row">📊 Approval: ${Math.round(Gov.approval)}% · 🏦 Treasury: $${Math.round(Gov.treasury)}</div>`;
    if (L.promise) rows += `<div class="info-row">🤞 Promised: ${L.promise}</div>`;
    if ((L.built || []).length) rows += `<div class="info-row">🏗️ Delivered: ${L.built.slice(-4).join(', ')}</div>`;
    if (mp) rows += `<div class="info-row">🪪 <span class="p-link" data-pid="${mp.id}">Meet the mayor in person</span></div>`;
    const needs = Gov.assessNeedsList().slice(0, 3);
    if (needs.length) rows += `<div class="info-row">📋 On the desk: ${needs.map(n => CAT[n].name).join(', ')}</div>`;
    if (Gov.election && Gov.election.candidates)
      rows += `<div class="info-row">🗳️ Last election: ${Gov.election.candidates.map(c => `${c.name} ${c.votes}`).join(' · ')}</div>`;
  }
  if (typeof Gov !== 'undefined') {
    rows += `<div class="info-row" style="margin-top:8px">💰 <b>Tax policy</b> (yours to set):</div>`;
    rows += `<div class="info-row"><select id="tax-select" style="width:100%">
      <option value="low"${Gov.taxRate === 'low' ? ' selected' : ''}>Low — happy homes, lean treasury</option>
      <option value="normal"${Gov.taxRate === 'normal' ? ' selected' : ''}>Normal — the steady middle</option>
      <option value="high"${Gov.taxRate === 'high' ? ' selected' : ''}>High — big projects, grumbling streets</option>
    </select></div>`;
  }
  rows += `<button id="info-close">Close</button>`;
  el.innerHTML = rows;
  const sel = document.getElementById('tax-select');
  if (sel) sel.addEventListener('change', () => {
    Gov.taxRate = sel.value;
    toast(`💰 Tax policy set to ${sel.value} — the town hall ledger adjusts`);
  });
  document.getElementById('info-close').onclick = hideInfo;
  wirePersonLinks(el);
}

/* =============== save / load ===============
   v4: three named slots + a rolling autosave + export/import to file.
   People, minds, ownership and the journal all travel with the save;
   a failed load rolls back to the running village untouched. */
const SAVE_SLOTS = ['pixelville-slot1', 'pixelville-slot2', 'pixelville-slot3'];
const AUTOSAVE_KEY = 'pixelville-auto';

function buildSaveString() {
  return World.serialize({
    clock: Sim.clock, day: Sim.day, safety: Sim.safety,
    arrests: Life.arrests, crimes: Life.crimes,
    firesRecent: Life.firesRecent || 0, graveCases: Life.graveCases || 0,
    gov: typeof Gov !== 'undefined' ? Gov.serialize() : null,
    people: Sim.serializePeople(),
    nextPid: Sim.nextPid,
    stocks: Sim.stocks || null,
    drought: typeof Calamity !== 'undefined' ? Math.round(Calamity.droughtLevel * 100) / 100 : 0,
    tasks: typeof Tasks !== 'undefined' ? { items: Tasks.items.slice(-120), news: Tasks.news.slice(-250) } : null,
    history: Sim.history || [],
    tier: Sim.tierReached || 0,
    scenario: Sim.scenario || null,
    meta: { name: World.name, day: Sim.day, pop: Sim.people.length, at: Date.now() },
  });
}

function writeSave(key, silent) {
  try {
    localStorage.setItem(key, buildSaveString());
    if (!silent) toast('Village saved 💾');
    return true;
  } catch (e) { if (!silent) toast('Save failed: ' + e.message); return false; }
}

function applyLoadedState(extra) {
  Sim.reset(); Life.reset();
  if (typeof Gov !== 'undefined') Gov.reset();
  if (typeof Calamity !== 'undefined') Calamity.reset();
  if (typeof Festivals !== 'undefined') Festivals.reset();
  Sim.clock = extra.clock || 420; Sim.day = extra.day || 1;
  Sim.safety = extra.safety || 92;
  Life.arrests = extra.arrests || 0; Life.crimes = extra.crimes || 0;
  Life.firesRecent = extra.firesRecent || 0; Life.graveCases = extra.graveCases || 0;
  if (typeof Calamity !== 'undefined' && extra.drought) Calamity.droughtLevel = extra.drought;
  Weather.init();
  if (extra._v >= 4 && extra.people) {
    Sim.restorePeople(extra.people, extra.nextPid);
    Sim.stocks = extra.stocks || null;
    Sim.history = extra.history || [];
    Sim.tierReached = extra.tier || 0;
    Sim.scenario = extra.scenario || null;
    if (typeof Tasks !== 'undefined' && extra.tasks) {
      Tasks.items = extra.tasks.items || [];
      Tasks.news = extra.tasks.news || [];
      Tasks._dirty = true;
    }
  } else {
    // legacy v3 save: the town survives, and new families move into the homes
    for (const b of World.buildings) {
      if (b.construction > 0 || b.ruined) continue;
      const funds = b.funds;
      Sim.onBuildingAdded(b);
      b.funds = funds;
    }
  }
  Sim.grandOpening = null;
  if (typeof Gov !== 'undefined') Gov.restore(extra.gov);
  afterMapEdit();
  hideInfo(); UI.selected = null;
  setVillageName(World.name);
}

function performLoad(data, label) {
  if (!data) { toast('That slot is empty'); return false; }
  const backup = buildSaveString(); // rollback point: a bad file must never cost the running village
  try {
    const extra = World.deserialize(data);
    if (extra._incompat) { toast('⚠️ That save is from the older, smaller map and can\'t be loaded here'); return false; }
    applyLoadedState(extra);
    toast(`Village loaded 📂${label ? ' — ' + label : ''}`);
    return true;
  } catch (e) {
    applyLoadedState(World.deserialize(backup));
    toast('⚠️ Load failed (' + e.message + ') — your current village is untouched');
    return false;
  }
}

function slotMeta(key) {
  const data = localStorage.getItem(key);
  if (!data) return null;
  try {
    const o = JSON.parse(data);
    return (o.extra && o.extra.meta) ||
      { name: o.name || 'PixelVille', day: (o.extra || {}).day || 1, pop: '?', at: 0 };
  } catch (e) { return null; }
}

function openSaveUI(mode) {
  UI.saveMode = mode;
  document.getElementById('saveui-title').textContent = mode === 'save' ? '💾 Save village' : '📂 Load village';
  const wrap = document.getElementById('saveui-slots');
  const keys = mode === 'load' ? SAVE_SLOTS.concat(AUTOSAVE_KEY) : SAVE_SLOTS;
  let html = '';
  keys.forEach((key, i) => {
    const meta = slotMeta(key);
    const label = key === AUTOSAVE_KEY ? '🕐 Autosave' : `Slot ${i + 1}`;
    const desc = meta
      ? `${meta.name} · day ${meta.day} · 👥 ${meta.pop}${meta.at ? ' · ' + new Date(meta.at).toLocaleString() : ''}`
      : 'Empty';
    html += `<div class="save-slot ${meta ? '' : 'empty'}" data-key="${key}">` +
      `<span>${label}</span><span class="slot-meta">${desc}</span></div>`;
  });
  wrap.innerHTML = html;
  wrap.querySelectorAll('.save-slot').forEach(el => el.addEventListener('click', () => {
    const key = el.dataset.key;
    if (UI.saveMode === 'save') {
      if (slotMeta(key) && !confirm('Overwrite this slot?')) return;
      writeSave(key);
    } else if (!performLoad(localStorage.getItem(key), key === AUTOSAVE_KEY ? 'autosave' : null)) {
      return;
    }
    document.getElementById('saveui').style.display = 'none';
  }));
  document.getElementById('saveui').style.display = 'flex';
}

function exportSave() {
  const blob = new Blob([buildSaveString()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(World.name || 'pixelville').replace(/[^\w-]+/g, '_')}-day${Sim.day}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Village exported ⬇️ — keep the file safe!');
}

/* the rolling autosave: quiet, frequent, and also on tab-hide */
let lastAutosaveAt = performance.now();
setInterval(() => {
  const mins = typeof Settings !== 'undefined' ? Settings.get('autosaveMin') : 2;
  if (!mins || performance.now() - lastAutosaveAt < mins * 60000) return;
  if (!World.buildings.length) return; // an empty map isn't worth a slot
  lastAutosaveAt = performance.now();
  writeSave(AUTOSAVE_KEY, true);
}, 5000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && World.buildings.length &&
      typeof Settings !== 'undefined' && Settings.get('autosaveMin')) writeSave(AUTOSAVE_KEY, true);
});
function newMap() {
  document.getElementById('nm-name').value = 'PixelVille';
  document.getElementById('newmap').style.display = 'flex';
}
function startNewMap() {
  const nm = (document.getElementById('nm-name').value || 'PixelVille').trim() || 'PixelVille';
  const scId = document.getElementById('nm-mode').value;
  document.getElementById('newmap').style.display = 'none';
  World.genStarterMap();
  Sim.reset(); Life.reset(); if (typeof Gov !== 'undefined') Gov.reset();
  if (typeof Calamity !== 'undefined') Calamity.reset();
  if (typeof Festivals !== 'undefined') Festivals.reset();
  Weather.init();
  setVillageName(nm);
  UI.undoStack = [];
  hideInfo(); UI.selected = null;
  if (scId !== 'sandbox' && typeof SCENARIOS !== 'undefined' && SCENARIOS[scId]) {
    Sim.scenario = { id: scId, startDay: Sim.day, done: false, failed: false, zeroDays: 0 };
    const def = SCENARIOS[scId];
    if (typeof Tasks !== 'undefined') Tasks.add('scenario', def.emoji, `Scenario: ${def.desc}`);
    toast(`🎯 Scenario: ${def.name} — ${def.desc}. Good luck!`);
  }
  toast(`New land discovered 🗺️ — drop a house and found ${World.name}!`);
}

/* =============== the village history charts =============== */
function drawStatsChart() {
  const cv = document.getElementById('stats-canvas');
  const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  const H = Sim.history || [];
  g.font = '11px system-ui, sans-serif';
  if (H.length < 2) {
    g.fillStyle = '#8a93a8';
    g.fillText('The chronicle needs a few days of history first — come back tomorrow.', 60, cv.height / 2);
    return;
  }
  const series = [
    { key: 'pop', label: '👥 Population', color: '#5fae62', max: Math.max(10, ...H.map(h => h.pop)) },
    { key: 'hap', label: '😊 Happiness %', color: '#f2c14f', max: 100 },
    { key: 'safe', label: '🛡️ Safety %', color: '#4f9ed0', max: 100 },
    { key: 'wealth', label: '💰 Wealth', color: '#c05fa8', max: Math.max(100, ...H.map(h => h.wealth)) },
    { key: 'tre', label: '🏦 Treasury', color: '#e08a3c', max: Math.max(100, ...H.map(h => h.tre)) },
  ];
  const x0 = 8, y0 = 8, w = cv.width - 16, h = cv.height - 52;
  g.fillStyle = 'rgba(255,255,255,0.04)'; g.fillRect(x0, y0, w, h);
  g.strokeStyle = 'rgba(255,255,255,0.12)';
  for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(x0, y0 + h * i / 4); g.lineTo(x0 + w, y0 + h * i / 4); g.stroke(); }
  for (const s of series) {
    g.strokeStyle = s.color; g.lineWidth = 1.6; g.beginPath();
    H.forEach((pt, i) => {
      const px = x0 + (i / (H.length - 1)) * w;
      const py = y0 + h - (Math.min(pt[s.key], s.max) / s.max) * h;
      i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
    });
    g.stroke();
  }
  // legend + the span of days covered
  let lx = x0 + 2;
  for (const s of series) {
    g.fillStyle = s.color; g.fillRect(lx, y0 + h + 12, 9, 9);
    g.fillStyle = '#c8cede'; g.fillText(s.label, lx + 13, y0 + h + 20);
    lx += g.measureText(s.label).width + 34;
  }
  g.fillStyle = '#8a93a8';
  g.fillText(`Day ${H[0].d} → ${H[H.length - 1].d}`, x0 + 2, y0 + h + 38);
}

/* =============== main loop =============== */
let lastT = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000 || 0.016);
  lastT = now;
  // recover if the pane was hidden/resized without a resize event
  const wrap = document.getElementById('canvas-wrap');
  if (wrap.clientWidth > 50 && canvas.width !== wrap.clientWidth) resize();
  const spd = UI.speeds[UI.speedIdx];
  if (spd > 0) {
    Sim.tick(dt * spd);
    Life.tick(dt * spd, dt);
    if (typeof Calamity !== 'undefined') Calamity.tick(dt * spd);
    if (typeof Festivals !== 'undefined') Festivals.tick(dt * spd);
  }
  // the lock can begin while fast-forwarding — rein the clock back in
  if (typeof Festivals !== 'undefined' && Festivals.speedLocked() && UI.speedIdx > 1) setSpeed(1);
  // ribbon-cuttings: construction sites that just finished
  while (Sim.completed.length) {
    const b = Sim.completed.shift();
    afterMapEdit();
    Snd.place();
    toast(`✅ ${CAT[b.type].name} completed!`);
    for (const m of Sim.onBuildingAdded(b)) toast(m);
  }
  Weather.tick(dt * spd, dt, s => toast(`${SEASON_EMOJI[s]} ${SEASONS[s]} has arrived`));
  render(now);

  /* ambience & event sounds */
  const rainI = Weather.isRaining() ? Weather.intensity : 0;
  Snd.tick(dt, {
    dark: darkness(), rainI,
    snowI: Weather.isSnowing() ? Weather.intensity : 0,
    day: Sim.clock > 350 && Sim.clock < 1150,
  });
  if (UI.prevClock !== undefined && spd > 0) { // church bells at 9:00 and 18:00
    for (const bellT of [540, 1080])
      if (UI.prevClock < bellT && Sim.clock >= bellT) Snd.bell();
  }
  UI.prevClock = Sim.clock;
  if (Weather.flash > 0.4 && !UI.thundered) { UI.thundered = true; Snd.thunder(); }
  if (Weather.flash <= 0) UI.thundered = false;

  /* neighbors greet each other when paths cross */
  if (now - (UI.lastChat || 0) > 650 && spd > 0) {
    UI.lastChat = now;
    const walkers = Sim.travelers().filter(p => !p.trip.car);
    for (let i = 0; i < walkers.length; i++) for (let j = i + 1; j < walkers.length; j++) {
      const a = walkers[i], b = walkers[j];
      if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 13 &&
          now > (a.chatCd || 0) && now > (b.chatCd || 0)) {
        a.bubble = b.bubble = '💬';
        a.bubbleUntil = b.bubbleUntil = now + 1900;
        a.chatCd = b.chatCd = now + 26000;
        // a chat is never just a chat: tips, gossip and friendship pass along
        if (typeof Mind !== 'undefined') Mind.gossip(a, b);
      }
    }
  }

  if (now - UI.lastStats > 400) {
    UI.lastStats = now;
    updateHUD();
    if (typeof Tasks !== 'undefined') { Tasks.render(); Tasks.badge(); }
    if (typeof News !== 'undefined') News.tick(now);
    if (UI.selected && document.getElementById('info').style.display === 'block') showInfo(UI.selected);
    else if (UI.selectedPerson && document.getElementById('info').style.display === 'block') showPersonInfo(UI.selectedPerson);
  }
  // the founding of the village pans the camera to the very first doorstep
  if (Sim.welcomeAt) { panTo(Sim.welcomeAt.x, Sim.welcomeAt.y); Sim.welcomeAt = null; }
  requestAnimationFrame(frame);
}

function resize() {
  const wrap = document.getElementById('canvas-wrap');
  canvas.width = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
  ctx.imageSmoothingEnabled = false;
  clampCam();
}

/* =============== bulldoze undo (Ctrl+Z) ===============
   Every bulldozed tile is remembered; Ctrl+Z restores the most recent.
   A rebuilt home comes back empty and a fresh family soon moves in. */
function recordBulldoze(r, x, y) {
  UI.undoStack = UI.undoStack || [];
  const entry = { kind: r.kind, x, y };
  if (r.kind === 'building') {
    const b = r.b;
    entry.type = b.type; entry.bx = b.x; entry.by = b.y;
    entry.level = b.level; entry.funds = Math.round(b.funds);
  }
  UI.undoStack.push(entry);
  if (UI.undoStack.length > 40) UI.undoStack.shift();
}
function undoBulldoze() {
  const e = (UI.undoStack || []).pop();
  if (!e) { toast('Nothing to undo'); return; }
  switch (e.kind) {
    case 'road': World.setRoad(e.x, e.y); break;
    case 'rail': World.setRail(e.x, e.y); break;
    case 'tree': World.placeTree(e.x, e.y); break;
    case 'water': {
      const i = World.idx(e.x, e.y);
      if (!World.bmap[i] && !World.roadMap[i]) { World.ground[i] = G_WATER; World.waterStamp++; World.dirty = true; }
      break;
    }
    case 'rock': toast('A levelled mountain stays levelled — some things can\'t be undone'); return;
    case 'building': {
      const b = World.placeBuilding(e.type, e.bx, e.by, true);
      if (!b) { toast('The plot is blocked now — couldn\'t rebuild'); return; }
      b.level = e.level || 1;
      for (const m of Sim.onBuildingAdded(b)) toast(m);
      b.funds = e.funds || b.funds;
      break;
    }
  }
  afterMapEdit();
  toast('↩️ Bulldoze undone');
}

/* =============== village name & settings panel =============== */
function setVillageName(name) {
  World.name = name.slice(0, 24);
  const logo = document.querySelector('#logo span:last-child');
  if (logo) logo.textContent = World.name;
  document.title = `${World.name} — drag & drop village builder`;
}

function openSettings() {
  document.getElementById('set-name').value = World.name || 'PixelVille';
  document.getElementById('set-pace').value = Settings.get('growthPace');
  document.getElementById('set-xmas').value = Settings.get('xmasLock');
  document.getElementById('set-vol').value = Settings.get('volume');
  document.getElementById('set-autosave').value = String(Settings.get('autosaveMin'));
  document.getElementById('settings').style.display = 'flex';
}
function closeSettings() {
  const nm = document.getElementById('set-name').value.trim();
  if (nm && nm !== World.name) { setVillageName(nm); toast(`🏷️ The village is now called ${World.name}`); }
  Settings.set('growthPace', document.getElementById('set-pace').value);
  Settings.set('xmasLock', document.getElementById('set-xmas').value);
  Settings.set('autosaveMin', +document.getElementById('set-autosave').value);
  document.getElementById('settings').style.display = 'none';
}

/* =============== sidebar collapse =============== */
function setSidebarHidden(hidden) {
  document.getElementById('app').classList.toggle('nosidebar', hidden);
  const st = document.getElementById('sidebar-toggle');
  st.textContent = hidden ? '▶' : '◀';
  st.title = hidden ? 'Show sidebar (H)' : 'Hide sidebar (H)';
  localStorage.setItem('pixelville-sidebar', hidden ? '1' : '0');
  resize();
}
function toggleSidebar() {
  setSidebarHidden(!document.getElementById('app').classList.contains('nosidebar'));
}

/* =============== background progress ===============
   requestAnimationFrame stops when the tab is hidden, so a timer keeps the
   village alive at a steady 1x while the game is open but not being watched.
   Browsers throttle hidden timers, so each firing catches up on the elapsed
   time in small, stable steps — slow but steady growth, never a lurch. */
let lastHiddenTick = performance.now();
setInterval(() => {
  const now = performance.now();
  const elapsed = (now - lastHiddenTick) / 1000;
  lastHiddenTick = now;
  if (!document.hidden || UI.speeds[UI.speedIdx] <= 0) return;
  let remaining = Math.min(elapsed, 90);
  while (remaining > 0) {
    const step = Math.min(0.5, remaining);
    remaining -= step;
    Sim.tick(step);
    Life.tick(step, step);
    if (typeof Calamity !== 'undefined') Calamity.tick(step);
    if (typeof Festivals !== 'undefined') Festivals.tick(step);
    Weather.tick(step, step, () => {});
  }
  while (Sim.completed.length) {
    const b = Sim.completed.shift();
    afterMapEdit();
    toast(`✅ ${CAT[b.type].name} completed!`);
    for (const m of Sim.onBuildingAdded(b)) toast(m);
  }
}, 1000);

/* =============== boot =============== */
function boot() {
  SPR.init();
  World.genStarterMap();
  Weather.init();
  Life.reset();
  if (typeof Gov !== 'undefined') Gov.reset();
  if (typeof Calamity !== 'undefined') Calamity.reset();
  if (typeof Festivals !== 'undefined') Festivals.reset();
  Life.onEvent = toast;
  buildPalette();
  if (typeof News !== 'undefined') News.init();
  resize();
  window.addEventListener('resize', resize);
  UI.camX = (GW * T) / 2 - canvas.width / (2 * UI.zoom);
  UI.camY = (GH * T) / 2 - canvas.height / (2 * UI.zoom);
  document.querySelectorAll('#speed button').forEach((b, i) => b.addEventListener('click', () => setSpeed(i)));
  // one-time migration: the old single-slot save becomes Slot 1
  if (localStorage.getItem('pixelville') && !localStorage.getItem(SAVE_SLOTS[0])) {
    localStorage.setItem(SAVE_SLOTS[0], localStorage.getItem('pixelville'));
    localStorage.removeItem('pixelville');
  }
  document.getElementById('btn-save').addEventListener('click', () => openSaveUI('save'));
  document.getElementById('btn-load').addEventListener('click', () => openSaveUI('load'));
  document.getElementById('saveui-close').addEventListener('click', () =>
    document.getElementById('saveui').style.display = 'none');
  document.getElementById('saveui-export').addEventListener('click', exportSave);
  document.getElementById('saveui-import').addEventListener('click', () =>
    document.getElementById('saveui-file').click());
  document.getElementById('saveui-file').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      if (performLoad(r.result, f.name)) document.getElementById('saveui').style.display = 'none';
    };
    r.readAsText(f);
    e.target.value = '';
  });
  document.getElementById('btn-new').addEventListener('click', newMap);
  document.getElementById('nm-start').addEventListener('click', startNewMap);
  document.getElementById('nm-cancel').addEventListener('click', () =>
    document.getElementById('newmap').style.display = 'none');
  const sb = document.getElementById('btn-sound');
  sb.textContent = Snd.enabled ? '🔊' : '🔇';
  sb.addEventListener('click', () => { Snd.start(); sb.textContent = Snd.toggle() ? '🔊' : '🔇'; });
  // settings panel
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('settings-close').addEventListener('click', closeSettings);
  document.getElementById('set-vol').addEventListener('input', e => Snd.setVolume(+e.target.value));
  setVillageName(World.name || 'PixelVille');
  // history charts
  document.getElementById('btn-stats').addEventListener('click', () => {
    drawStatsChart();
    document.getElementById('statsui').style.display = 'flex';
  });
  document.getElementById('statsui-close').addEventListener('click', () =>
    document.getElementById('statsui').style.display = 'none');
  // the mayor's report opens from the leadership chip
  const lw = document.getElementById('stat-leader-wrap');
  if (lw) { lw.style.cursor = 'pointer'; lw.addEventListener('click', showMayorPanel); }
  // the village task book
  document.getElementById('btn-journal').addEventListener('click', () => Tasks.toggle());
  document.getElementById('journal-close').addEventListener('click', () => Tasks.toggle());
  document.querySelectorAll('#journal-tabs button').forEach(b =>
    b.addEventListener('click', () => Tasks.setTab(b.dataset.tab)));
  // minimap: click to jump
  const mm = document.getElementById('minimap');
  mm.addEventListener('pointerdown', e => {
    const r = mm.getBoundingClientRect();
    const wx = (e.clientX - r.left) / r.width * GW * T;
    const wy = (e.clientY - r.top) / r.height * GH * T;
    UI.camX = wx - canvas.width / (2 * UI.zoom);
    UI.camY = wy - canvas.height / (2 * UI.zoom);
    clampCam();
  });
  setSpeed(1);
  setTool(null);
  if (!localStorage.getItem('pixelville-seen2')) {
    document.getElementById('help').style.display = 'flex';
  }
  document.getElementById('help-close').addEventListener('click', () => {
    document.getElementById('help').style.display = 'none';
    localStorage.setItem('pixelville-seen2', '1');
  });
  document.getElementById('btn-help').addEventListener('click', () =>
    document.getElementById('help').style.display = 'flex');
  document.getElementById('sidebar-toggle').addEventListener('click', toggleSidebar);
  if (localStorage.getItem('pixelville-sidebar') === '1') setSidebarHidden(true);
  requestAnimationFrame(frame);
}
boot();
