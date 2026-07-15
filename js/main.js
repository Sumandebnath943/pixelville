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

  /* pass 1 — base terrain + procedural ground props */
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const i = World.idx(x, y), gr = World.ground[i];
    if (gr === G_WATER) {
      if (winter) {
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
    } else if (gr === G_ROCK) {
      g.drawImage(SPR.rockTile, x * T, y * T);
      if (winter) { g.fillStyle = 'rgba(238,243,248,0.35)'; g.fillRect(x * T, y * T, T, T); }
    } else {
      const hh = h2(x, y);
      g.drawImage(grassSet[hh % 4], x * T, y * T);
      // scattered props on open grass
      if (!World.tree[i] && !World.roadMap[i] && !World.bmap[i]) {
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

  /* pass 3 — roads over everything, with crosswalks & manholes */
  const popcount = m => ((m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1));
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const i = World.idx(x, y);
    if (!World.roadMap[i]) continue;
    const gr = World.ground[i];
    const m = World.roadMask(x, y);
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
    if ((x * 7 + y * 13) % 7 === 0 && gr !== G_WATER) UI.lampSpots.push([x, y]);
  }

  /* pass 3.5 — railway tracks (ballast on grass, bare rails over level crossings) */
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const i = World.idx(x, y);
    if (!World.railMap[i]) continue;
    const m = World.railMask(x, y);
    g.drawImage(World.roadMap[i] ? SPR.railsBare[m] : SPR.rails[m], x * T, y * T);
    if (World.roadMap[i]) { // level-crossing warning posts
      g.fillStyle = '#e8e4cf'; g.fillRect(x * T + 1, y * T + 1, 1, 3); g.fillRect(x * T + T - 2, y * T + T - 4, 1, 3);
      g.fillStyle = '#c65f4e'; g.fillRect(x * T + 1, y * T + 1, 1, 1); g.fillRect(x * T + T - 2, y * T + T - 4, 1, 1);
    }
  }

  // share terrain info with the ambient-life module
  Life.waterTiles = UI.waterTiles;
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

/* =============== render =============== */
let lastFrameT = 0;
function render(now) {
  const dtReal = Math.min(0.08, (now - lastFrameT) / 1000 || 0.016);
  lastFrameT = now;
  const z = UI.zoom;
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

  // water shimmer (not on ice)
  if (Weather.season !== 3 && Math.floor(now / 550) % 2 === 1) {
    ctx.fillStyle = 'rgba(190,225,250,0.5)';
    for (const [x, y] of UI.waterTiles) {
      if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
      const s = (x * 7 + y * 13) % 4;
      ctx.fillRect(x * T + 2 + s * 3, y * T + 3 + ((x + y) % 3) * 4, 3, 1);
    }
  }

  // street lamp posts + their light sources
  for (const [x, y] of UI.lampSpots) {
    if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
    ctx.drawImage(SPR.lamp, x * T + 11, y * T - 8);
    if (dark > 0.1) UI.lights.push({ x: x * T + 13, y: y * T + 2, r: 24, a: 0.85, tint: 'warm' });
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
  for (const tr of Life.tourists) if (tr.phase !== 'visit') ents.push({ kind: 'tourist', tr, base: tr.y + 4 });
  for (const dk of Life.ducks) ents.push({ kind: 'duck', dk, base: dk.y + 3 });
  // public transport & harbour life
  for (const bus of Life.buses) ents.push({ kind: 'bus', u: bus, base: bus.y + 4 });
  for (const train of Life.trains) {
    ents.push({ kind: 'traincar', u: train, off: 0, engine: true, base: train.y + 4 });
    ents.push({ kind: 'traincar', u: train, off: 1.4, base: train.y + 4.01 });
    ents.push({ kind: 'traincar', u: train, off: 2.8, base: train.y + 4.02 });
  }
  for (const bt of Life.boats) ents.push({ kind: 'boat', u: bt, base: bt.y + 3 });
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
      const ms = SPR.mountains[e.v];
      shadow(e.x * T + MSIZE * 8, e.base - 3, MSIZE * 8, 4);
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
      // customer cars parked outside venues
      if (b.parked > 0 && bd.visit) {
        for (let k = 0; k < Math.min(3, b.parked); k++) {
          const px = b.x * T - 14 + k * 2, py = b.y * T + 2 + k * 12;
          ctx.drawImage(SPR.car((b.id + k * 3) % 8).v, px, py);
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
      // building light sources
      if (dark > 0.1) {
        UI.lights.push({ x: b.x * T + b.w * 8, y: b.y * T + b.h * 8, r: b.w * 11 + 8, a: 0.5, tint: 'warm' });
        if (b.type === 'amusement') {
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
        if (dark > 0.1) { // headlights
          const hx = p.x + (p.dirx || 0) * 12, hy = p.y + (p.diry || 0) * 12;
          UI.lights.push({ x: hx, y: hy, r: 15, a: 0.85, tint: 'cool' });
          UI.lights.push({ x: p.x, y: p.y, r: 8, a: 0.5, tint: 'cool' });
        }
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
      if (dark > 0.1) UI.lights.push({ x: u.x + (u.dirx || 0) * 12, y: u.y + (u.diry || 0) * 12, r: 15, a: 0.8, tint: 'cool' });
    } else if (e.kind === 'firetruck') {
      const u = e.u, spr = SPR.fireTruck;
      shadow(u.x, u.y + 3, 6, 2);
      if (u.dirx !== 0) ctx.drawImage(spr.h, Math.round(u.x) - 6, Math.round(u.y) - 4);
      else ctx.drawImage(spr.v, Math.round(u.x) - 4, Math.round(u.y) - 6);
      UI.lights.push({ x: u.x, y: u.y - 3, r: 20, a: 0.9, tint: Math.floor(now / 170) % 2 ? 'red' : 'orange' });
      if (dark > 0.1) UI.lights.push({ x: u.x + (u.dirx || 0) * 12, y: u.y + (u.diry || 0) * 12, r: 15, a: 0.8, tint: 'cool' });
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
      if (dark > 0.1) UI.lights.push({ x: tr.x + (tr.dirx || 0) * 12, y: tr.y + (tr.diry || 0) * 12, r: 15, a: 0.85, tint: 'cool' });
    } else if (e.kind === 'bus') {
      const u = e.u;
      shadow(u.x, u.y + 3, 8, 2.4);
      if (u.dirx !== 0) ctx.drawImage(SPR.bus.h, Math.round(u.x) - 8, Math.round(u.y) - 4);
      else ctx.drawImage(SPR.bus.v, Math.round(u.x) - 4, Math.round(u.y) - 8);
      if (dark > 0.1) UI.lights.push({ x: u.x + (u.dirx || 0) * 12, y: u.y + (u.diry || 0) * 12, r: 15, a: 0.8, tint: 'cool' });
    } else if (e.kind === 'traincar') {
      const tr = e.u;
      const o = { x: tr.x, y: tr.y, dirx: tr.dirx, diry: tr.diry };
      if (e.off) Life.followPath(o, tr.route, Math.max(0, Math.min(tr.route.length - 1, tr.prog - e.off * tr.dir)), 0);
      const spr = e.engine ? SPR.trainEngine : SPR.trainCoach;
      shadow(o.x, o.y + 3, 9, 2.4);
      if (o.dirx !== 0) ctx.drawImage(spr.h, Math.round(o.x) - 9, Math.round(o.y) - 4);
      else ctx.drawImage(spr.v, Math.round(o.x) - 4, Math.round(o.y) - 9);
      if (e.engine && dark > 0.1) UI.lights.push({ x: o.x + (o.dirx || 0) * 14, y: o.y + (o.diry || 0) * 14, r: 20, a: 0.9, tint: 'warm' });
      if (e.engine && Math.random() < 0.12 && UI.speeds[UI.speedIdx] > 0)
        UI.smoke.push({ x: o.x, y: o.y - 7, r: 1.4 + Math.random(), life: 0.7 });
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

  // mysterious lights on the peaks at night
  if (dark > 0.25) {
    for (const m of World.mountains) {
      const ms = SPR.mountains[(m.v || 0) % SPR.mountains.length];
      for (let pi = 0; pi < ms.peaks.length; pi++) {
        if ((m.x * 31 + m.y * 17 + pi) % 3 === 0) continue; // not every peak
        const wob = Math.sin(now / 700 + pi * 2 + m.x) * 2.5;
        const px = m.x * T + ms.peaks[pi][0] + wob;
        const py = m.y * T - ms.oy + ms.peaks[pi][1] + 3;
        const flick = 0.55 + 0.3 * Math.sin(now / 120 + pi * 3 + m.y);
        UI.lights.push({ x: px, y: py, r: 11 + flick * 3, a: flick, tint: 'orange', flame: true });
      }
    }
  }

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
    if (c.t > 24) { ctx.globalAlpha = (c.t - 24) / 4; ctx.fillStyle = '#fff3c0'; ctx.beginPath(); ctx.arc(c.x, c.y, (28 - c.t) * 5, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
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
      const b = e.b, s = SPR.b[b.type][b.variant % SPR.b[b.type].length];
      ctx.globalAlpha = litA;
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
    if (sx < -sr || sy < -sr || sx > canvas.width + sr || sy > canvas.height + sr) continue;
    ng.globalAlpha = Math.min(1, L.a * k);
    ng.drawImage(SPR.glow, sx - sr, sy - sr, sr * 2, sr * 2);
  }
  ng.globalAlpha = 1;
  ctx.drawImage(UI.nightCanvas, 0, 0);
  // colored halos
  ctx.globalCompositeOperation = 'screen';
  for (const L of UI.lights) {
    if (!L.tint) continue;
    const sx = (L.x - UI.camX) * z, sy = (L.y - UI.camY) * z, sr = L.r * z * 1.15;
    if (sx < -sr || sy < -sr || sx > canvas.width + sr || sy > canvas.height + sr) continue;
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
    if (d.tool === 'mountain') { ctx.fillStyle = '#98938a'; ctx.fillRect((x - 2) * T, (y - 2) * T, MSIZE * T, MSIZE * T); }
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
      if (World.placeMountain(x - 2, y - 2)) toast('Mountain range raised ⛰️ — roads will carve around it');
      afterMapEdit(); break;
    case 'bulldoze': {
      const r = World.bulldoze(x, y);
      if (r && r.kind === 'building') { Sim.onBuildingRemoved(r.b); toast(`${CAT[r.b.type].name} demolished 🚜`); }
      if (r) { afterMapEdit(); Snd.crunch(); }
      break;
    }
  }
}

function finishDragTool(x, y) {
  const d = CAT[UI.tool.key], s = UI.dragStart;
  if (!s) return;
  if (d.tool === 'road') { World.layRoadLine(s.x, s.y, x, y); afterMapEdit(); }
  if (d.tool === 'rail') { World.layRailLine(s.x, s.y, x, y); afterMapEdit(); toast('Railway track laid 🛤️ — connect two train stations to start a service'); }
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
      if (ps.maybeSelect) selectAt(t.x, t.y);
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
  if (e.target.tagName === 'INPUT') return;
  const pan = 26 / UI.zoom * 8;
  if (e.key === 'ArrowLeft' || e.key === 'a') UI.camX -= pan;
  if (e.key === 'ArrowRight' || e.key === 'd') UI.camX += pan;
  if (e.key === 'ArrowUp' || e.key === 'w') UI.camY -= pan;
  if (e.key === 'ArrowDown' || e.key === 's') UI.camY += pan;
  if (e.key === 'Escape') { setTool(null); hideInfo(); }
  if (e.key === ' ') { e.preventDefault(); setSpeed(UI.speedIdx === 0 ? 1 : 0); }
  if (e.key >= '1' && e.key <= '4') setSpeed(+e.key - 1);
  if (e.key === 'h' || e.key === 'H') toggleSidebar();
  clampCam();
});

function clampCam() {
  const vw = canvas.width / UI.zoom, vh = canvas.height / UI.zoom;
  UI.camX = Math.max(-vw * 0.3, Math.min(GW * T - vw * 0.7, UI.camX));
  UI.camY = Math.max(-vh * 0.3, Math.min(GH * T - vh * 0.7, UI.camY));
}

function selectAt(x, y) {
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
      item.className = 'pal-item'; item.dataset.key = key; item.title = d.name;
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
  document.getElementById('clock').textContent =
    `Day ${Sim.day} · ${WEEKDAYS[Sim.day % 7]} · ${Sim.timeStr()}`;
  document.getElementById('chip-season').textContent = Weather.label();
  document.getElementById('chip-weather').textContent = Weather.weatherLabel();
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
  for (let i = 0; i < GW * GH; i++) {
    const g0 = World.ground[i];
    if (g0 === G_WATER) put(i, 63, 127, 208);
    else if (g0 === G_ROCK) put(i, 126, 122, 114);
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
  // viewport rectangle
  const sc = GW / (GW * T); // 1/T
  mg.strokeStyle = '#ffe066';
  mg.lineWidth = 1;
  mg.strokeRect(UI.camX * sc, UI.camY * sc, (canvas.width / UI.zoom) * sc, (canvas.height / UI.zoom) * sc);
}

function setSpeed(i) {
  UI.speedIdx = i;
  document.querySelectorAll('#speed button').forEach((b, n) => b.classList.toggle('active', n === i));
}

function toast(msg) {
  if (typeof Tasks !== 'undefined') Tasks.log(msg); // nothing is lost — it all lands in the task book
  const wrap = document.getElementById('toasts');
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  wrap.appendChild(t);
  while (wrap.children.length > 4) wrap.removeChild(wrap.firstChild);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, 6000);
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
      `${r.name || '·'} (${r.age !== undefined ? r.age : '?'})`).join(', ');
    rows += `<div class="info-row">🪪 ${names}${b.residents.length > 5 ? '…' : ''}</div>`;
    const away = b.residents.filter(r => r.at !== b || r.state === 'walk').length;
    rows += `<div class="info-row">🚶 ${away} out right now</div>`;
    const am = b.residents.reduce((s2, r) => s2 + (r.mood === undefined ? 60 : r.mood), 0) / b.residents.length;
    rows += `<div class="info-row">${am >= 70 ? '😄' : am >= 50 ? '🙂' : am >= 35 ? '😕' : '😠'} Household mood: ${Math.round(am)}%</div>`;
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
  rows += `<button id="demolish">🚜 Demolish</button> <button id="info-close">Close</button>`;
  el.innerHTML = rows;
  document.getElementById('demolish').onclick = () => {
    World.removeBuilding(b); Sim.onBuildingRemoved(b);
    afterMapEdit(); hideInfo(); UI.selected = null;
    toast(`${d.name} demolished 🚜`);
  };
  document.getElementById('info-close').onclick = hideInfo;
}
function hideInfo() { document.getElementById('info').style.display = 'none'; UI.selected = null; }

/* =============== save / load =============== */
function saveGame() {
  try {
    localStorage.setItem('pixelville', World.serialize({
      clock: Sim.clock, day: Sim.day, safety: Sim.safety, arrests: Life.arrests, crimes: Life.crimes,
      gov: typeof Gov !== 'undefined' ? Gov.serialize() : null,
    }));
    toast('Village saved 💾');
  } catch (e) { toast('Save failed: ' + e.message); }
}
function loadGame() {
  const data = localStorage.getItem('pixelville');
  if (!data) { toast('No saved village yet'); return; }
  const extra = World.deserialize(data);
  if (extra._incompat) { toast('⚠️ That save is from the older, smaller map and can\'t be loaded here'); return; }
  Sim.reset(); Life.reset();
  if (typeof Gov !== 'undefined') Gov.reset();
  Sim.clock = extra.clock || 420; Sim.day = extra.day || 1;
  Sim.safety = extra.safety || 92;
  Life.arrests = extra.arrests || 0; Life.crimes = extra.crimes || 0;
  for (const b of World.buildings) {
    if (b.construction > 0 || b.ruined) continue; // finish building / stay rubble
    const funds = b.funds;
    Sim.onBuildingAdded(b);
    b.funds = funds; // keep saved savings
  }
  Sim.grandOpening = null;
  if (typeof Gov !== 'undefined') Gov.restore(extra.gov);
  Weather.init();
  afterMapEdit();
  hideInfo(); UI.selected = null;
  toast('Village loaded 📂');
}
function newMap() {
  if (!confirm('Start a fresh map? Unsaved progress is lost.')) return;
  World.genStarterMap();
  Sim.reset(); Life.reset(); if (typeof Gov !== 'undefined') Gov.reset(); Weather.init();
  hideInfo(); UI.selected = null;
  toast('New land discovered 🗺️ — drop a house to begin!');
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
  }
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
      }
    }
  }

  if (now - UI.lastStats > 400) {
    UI.lastStats = now;
    updateHUD();
    if (typeof Tasks !== 'undefined') { Tasks.render(); Tasks.badge(); }
    if (UI.selected && document.getElementById('info').style.display === 'block') showInfo(UI.selected);
  }
  requestAnimationFrame(frame);
}

function resize() {
  const wrap = document.getElementById('canvas-wrap');
  canvas.width = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
  ctx.imageSmoothingEnabled = false;
  clampCam();
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
  Life.onEvent = toast;
  buildPalette();
  resize();
  window.addEventListener('resize', resize);
  UI.camX = (GW * T) / 2 - canvas.width / (2 * UI.zoom);
  UI.camY = (GH * T) / 2 - canvas.height / (2 * UI.zoom);
  document.querySelectorAll('#speed button').forEach((b, i) => b.addEventListener('click', () => setSpeed(i)));
  document.getElementById('btn-save').addEventListener('click', saveGame);
  document.getElementById('btn-load').addEventListener('click', loadGame);
  document.getElementById('btn-new').addEventListener('click', newMap);
  const sb = document.getElementById('btn-sound');
  sb.textContent = Snd.enabled ? '🔊' : '🔇';
  sb.addEventListener('click', () => { Snd.start(); sb.textContent = Snd.toggle() ? '🔊' : '🔇'; });
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
