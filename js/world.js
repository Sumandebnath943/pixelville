/* ============================================================
   PixelVille — world grid, terrain, placement, auto-roads.
   Ground types: 0 grass, 1 water, 2 rock.
   ============================================================ */
'use strict';

const GW = 128, GH = 128;
const G_GRASS = 0, G_WATER = 1, G_ROCK = 2;
const MSIZE = 5; // mountain footprint (tiles)
const MIN_PER_SEC = 4; // game-minutes per real second at 1x — one day ≈ 6 real minutes

const World = {
  ground: new Uint8Array(GW * GH),
  tree: new Uint8Array(GW * GH),      // 0 none, 1..3 tree variant
  roadMap: new Uint8Array(GW * GH),   // 0/1
  bmap: new Int16Array(GW * GH),      // building index + 1
  buildings: [],
  mountains: [],                       // {x,y} 3x3 rock + peak sprite
  nextId: 1,
  dirty: true,                         // ground layer needs re-render
  onChange: null,                      // callback

  idx(x, y) { return y * GW + x; },
  inB(x, y) { return x >= 0 && y >= 0 && x < GW && y < GH; },
  isRoad(x, y) { return this.inB(x, y) && this.roadMap[this.idx(x, y)] === 1; },

  reset() {
    this.ground.fill(0); this.tree.fill(0); this.roadMap.fill(0); this.bmap.fill(0);
    this.buildings = []; this.mountains = []; this.nextId = 1; this.dirty = true;
  },

  /* ---------- initial scenery ---------- */
  genStarterMap(seed) {
    this.reset();
    const R = mulberry32(seed || (Math.random() * 1e9) | 0);
    // forest clusters (kept away from the center build zone)
    for (let c = 0; c < 26; c++) {
      const cx = 4 + Math.floor(R() * (GW - 8)), cy = 4 + Math.floor(R() * (GH - 8));
      if (Math.abs(cx - GW / 2) < 16 && Math.abs(cy - GH / 2) < 16) continue;
      const r = 2 + R() * 3.5;
      for (let y = -5; y <= 5; y++) for (let x = -5; x <= 5; x++) {
        if (x * x + y * y > r * r || R() < 0.35) continue;
        const tx = cx + x, ty = cy + y;
        if (this.inB(tx, ty) && this.ground[this.idx(tx, ty)] === G_GRASS)
          this.tree[this.idx(tx, ty)] = 1 + Math.floor(R() * 3);
      }
    }
    // lakes
    this.stampLake(16 + Math.floor(R() * 12), 88 + Math.floor(R() * 14), 5 + R() * 2.5, 3.5 + R() * 2, R);
    this.stampLake(96 + Math.floor(R() * 14), 20 + Math.floor(R() * 10), 4 + R() * 2, 3 + R() * 1.5, R);
    // a river across the east side
    this.carveRiver(GW - 10, 2 + Math.floor(R() * 8), 62 + Math.floor(R() * 14), GH - 2, R);
    // imposing mountain range, bottom-left
    const mx = 10 + Math.floor(R() * 10), my = 78 + Math.floor(R() * 10);
    this.placeMountain(mx, my); this.placeMountain(mx + 5, my + 3);
    this.placeMountain(mx + 2, my + 7); this.placeMountain(mx + 8, my - 2);
    // country roads entering from the west and the north — visitors arrive along them
    const ry = 58 + Math.floor(R() * 12);
    for (let x = 0; x < 18; x++) if (this.enterCost(x, ry) !== Infinity) this.setRoad(x, ry);
    const rx = 52 + Math.floor(R() * 16);
    for (let y = 0; y < 14; y++) if (this.enterCost(rx, y) !== Infinity) this.setRoad(rx, y);
    this.dirty = true;
  },

  /* ---------- terrain stamps ---------- */
  clearForTerrain(x, y) { // only grass (w/ trees) may become water/rock
    if (!this.inB(x, y)) return false;
    const i = this.idx(x, y);
    return this.bmap[i] === 0 && this.roadMap[i] === 0;
  },
  stampWaterDisc(cx, cy, r) {
    for (let y = Math.floor(-r); y <= r; y++) for (let x = Math.floor(-r); x <= r; x++)
      if (x * x + y * y <= r * r && this.clearForTerrain(cx + x, cy + y)) {
        const i = this.idx(cx + x, cy + y);
        this.ground[i] = G_WATER; this.tree[i] = 0;
      }
    this.dirty = true;
  },
  stampLake(cx, cy, rx, ry, R) {
    R = R || Math.random;
    for (let y = -Math.ceil(ry) - 1; y <= ry + 1; y++) for (let x = -Math.ceil(rx) - 1; x <= rx + 1; x++) {
      const d = (x * x) / (rx * rx) + (y * y) / (ry * ry);
      if (d <= 1 + (R() - 0.5) * 0.35 && this.clearForTerrain(cx + x, cy + y)) {
        const i = this.idx(cx + x, cy + y);
        this.ground[i] = G_WATER; this.tree[i] = 0;
      }
    }
    this.dirty = true;
  },
  carveRiver(x0, y0, x1, y1, R) {
    R = R || Math.random;
    let x = x0, y = y0, guard = 0;
    while ((Math.abs(x - x1) > 1 || Math.abs(y - y1) > 1) && guard++ < 900) {
      const wide = R() < 0.3 ? 1.6 : 1.1;
      this.stampWaterDisc(Math.round(x), Math.round(y), wide);
      const ang = Math.atan2(y1 - y, x1 - x) + (R() - 0.5) * 1.5;
      x += Math.cos(ang); y += Math.sin(ang);
      x = Math.max(1, Math.min(GW - 2, x)); y = Math.max(1, Math.min(GH - 2, y));
    }
    this.dirty = true;
  },
  placeMountain(x, y) { // 5x5 rock footprint + big range sprite
    for (let j = 0; j < MSIZE; j++) for (let i = 0; i < MSIZE; i++) {
      if (!this.inB(x + i, y + j)) return false;
      if (!this.clearForTerrain(x + i, y + j)) return false;
    }
    for (let j = 0; j < MSIZE; j++) for (let i = 0; i < MSIZE; i++) {
      const k = this.idx(x + i, y + j);
      this.ground[k] = G_ROCK; this.tree[k] = 0;
    }
    this.mountains.push({ x, y, v: this.mountains.length % 2 });
    this.dirty = true;
    return true;
  },
  placeTree(x, y) {
    if (!this.inB(x, y)) return false;
    const i = this.idx(x, y);
    if (this.ground[i] !== G_GRASS || this.bmap[i] || this.roadMap[i]) return false;
    this.tree[i] = 1 + Math.floor(Math.random() * 3);
    this.dirty = true;
    return true;
  },
  placeForest(cx, cy) {
    let n = 0;
    for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++)
      if (x * x + y * y <= 9 && Math.random() < 0.55 && this.placeTree(cx + x, cy + y)) n++;
    return n;
  },

  /* ---------- buildings ---------- */
  canPlace(key, x, y) {
    const d = CAT[key];
    if (!d || !d.draw) return false;
    if (x < 0 || y < 0 || x + d.w > GW || y + d.h + 1 > GH) return false; // +1: door row
    for (let j = 0; j < d.h; j++) for (let i = 0; i < d.w; i++) {
      const k = this.idx(x + i, y + j);
      if (this.ground[k] !== G_GRASS || this.bmap[k] || this.roadMap[k]) return false;
    }
    return true;
  },

  placeBuilding(key, x, y, instant) {
    if (!this.canPlace(key, x, y)) return null;
    const d = CAT[key];
    const b = {
      id: this.nextId++, type: key, x, y, w: d.w, h: d.h,
      variant: Math.floor(Math.random() * (d.vars || 1)),
      door: { x: x + (d.w >> 1), y: y + d.h },
      connected: false, visitors: 0, inside: 0, parked: 0,
      residents: [], workers: [], jobs: d.jobs || 0, cars: [],
      level: 1, funds: 0, ruined: false, fire: 0,
      construction: instant ? 0 : 30 + d.w * d.h * 10, // game-minutes of building work
      upgrading: 0, renovating: 0,
    };
    this.buildings.push(b);
    for (let j = 0; j < d.h; j++) for (let i = 0; i < d.w; i++) {
      const k = this.idx(x + i, y + j);
      this.bmap[k] = this.buildings.length; // index+1
      this.tree[k] = 0;
    }
    b.connected = this.connectRoad(b);
    this.dirty = true;
    return b;
  },

  /* spot for city-driven growth: footprint whose door lands on an existing road */
  findBuildSpot(key) {
    const d = CAT[key];
    const roads = [];
    for (let i = 0; i < this.roadMap.length; i++) if (this.roadMap[i]) roads.push(i);
    for (let tries = 0; tries < 140 && roads.length; tries++) {
      const r = roads[(Math.random() * roads.length) | 0];
      const rx = r % GW, ry = (r / GW) | 0;
      const x = rx - (d.w >> 1), y = ry - d.h;
      if (this.canPlace(key, x, y)) return { x, y };
    }
    return null;
  },

  removeBuilding(b) {
    const bi = this.buildings.indexOf(b);
    if (bi < 0) return;
    this.buildings.splice(bi, 1);
    // rebuild bmap indices
    this.bmap.fill(0);
    for (let n = 0; n < this.buildings.length; n++) {
      const q = this.buildings[n];
      for (let j = 0; j < q.h; j++) for (let i = 0; i < q.w; i++)
        this.bmap[this.idx(q.x + i, q.y + j)] = n + 1;
    }
    this.dirty = true;
  },

  buildingAt(x, y) {
    if (!this.inB(x, y)) return null;
    const v = this.bmap[this.idx(x, y)];
    return v ? this.buildings[v - 1] : null;
  },

  /* ---------- AUTO-ROAD: A* with terrain costs & turn penalty ----------
     Roads prefer reusing existing roads, avoid water (bridges cost more),
     and cannot cross rock/buildings — so they carve AROUND mountains. */
  enterCost(x, y) {
    if (!this.inB(x, y)) return Infinity;
    const i = this.idx(x, y);
    if (this.bmap[i]) return Infinity;
    if (this.roadMap[i]) return 0.15;
    const g = this.ground[i];
    if (g === G_ROCK) return Infinity;
    if (g === G_WATER) return 7;
    return this.tree[i] ? 1.8 : 1;
  },

  anyRoadExists() {
    for (let i = 0; i < this.roadMap.length; i++) if (this.roadMap[i]) return true;
    return false;
  },

  connectRoad(b) {
    const dx = b.door.x, dy = b.door.y;
    if (this.isRoad(dx, dy)) return true;
    if (this.enterCost(dx, dy) === Infinity) return false;

    if (!this.anyRoadExists()) { // seed the first road segment
      this.setRoad(dx, dy);
      for (const dir of [-1, 1]) {
        for (let s = 1; s <= 3; s++) {
          const x = dx + dir * s;
          if (this.inB(x, dy) && this.enterCost(x, dy) <= 1.8 && this.ground[this.idx(x, dy)] === G_GRASS)
            this.setRoad(x, dy);
          else break;
        }
      }
      return true;
    }

    // Dijkstra over (tile, direction) states with a small turn penalty
    const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const NS = GW * GH * 4;
    const dist = new Float64Array(NS).fill(Infinity);
    const prev = new Int32Array(NS).fill(-1);
    // tiny binary heap
    const heap = []; // [cost, state]
    const push = (c, s) => {
      heap.push([c, s]);
      let i = heap.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          let m = i; const l = 2 * i + 1, r = l + 1;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
        }
      }
      return top;
    };
    for (let d = 0; d < 4; d++) {
      const s = (this.idx(dx, dy)) * 4 + d;
      dist[s] = 0; push(0, s);
    }
    let goal = -1;
    while (heap.length) {
      const [c, s] = pop();
      if (c > dist[s]) continue;
      const tile = s >> 2, sd = s & 3;
      const tx = tile % GW, ty = (tile / GW) | 0;
      if (this.roadMap[tile] && !(tx === dx && ty === dy)) { goal = s; break; }
      for (let nd = 0; nd < 4; nd++) {
        const nx = tx + DIRS[nd][0], ny = ty + DIRS[nd][1];
        const ec = this.enterCost(nx, ny);
        if (ec === Infinity) continue;
        const turn = nd === sd ? 0 : 0.45;
        const ns = this.idx(nx, ny) * 4 + nd;
        const ncost = c + ec + turn;
        if (ncost < dist[ns]) { dist[ns] = ncost; prev[ns] = s; push(ncost, ns); }
      }
    }
    if (goal < 0) return false;
    // trace back, lay road
    let s = goal;
    while (s >= 0) {
      const tile = s >> 2;
      this.setRoad(tile % GW, (tile / GW) | 0);
      s = prev[s];
    }
    return true;
  },

  setRoad(x, y) {
    if (!this.inB(x, y)) return;
    const i = this.idx(x, y);
    if (this.bmap[i] || this.ground[i] === G_ROCK) return;
    this.roadMap[i] = 1; this.tree[i] = 0;
    this.dirty = true;
  },

  /* manual road drag: L-shaped (horizontal then vertical) */
  layRoadLine(x0, y0, x1, y1) {
    const sx = Math.sign(x1 - x0) || 1, sy = Math.sign(y1 - y0) || 1;
    for (let x = x0; x !== x1 + sx; x += sx) if (this.enterCost(x, y0) !== Infinity) this.setRoad(x, y0);
    for (let y = y0; y !== y1 + sy; y += sy) if (this.enterCost(x1, y) !== Infinity) this.setRoad(x1, y);
  },

  /* after road edits, re-check which buildings' doors touch roads */
  refreshConnections() {
    for (const b of this.buildings) b.connected = this.isRoad(b.door.x, b.door.y);
  },

  bulldoze(x, y) {
    if (!this.inB(x, y)) return null;
    const b = this.buildingAt(x, y);
    if (b) { this.removeBuilding(b); return { kind: 'building', b }; }
    const i = this.idx(x, y);
    if (this.roadMap[i]) { this.roadMap[i] = 0; this.dirty = true; this.refreshConnections(); return { kind: 'road' }; }
    if (this.tree[i]) { this.tree[i] = 0; this.dirty = true; return { kind: 'tree' }; }
    if (this.ground[i] === G_WATER) { this.ground[i] = G_GRASS; this.dirty = true; return { kind: 'water' }; }
    if (this.ground[i] === G_ROCK) {
      // remove the whole mountain containing this tile
      const m = this.mountains.find(m => x >= m.x && x < m.x + MSIZE && y >= m.y && y < m.y + MSIZE);
      if (m) {
        this.mountains.splice(this.mountains.indexOf(m), 1);
        for (let j = 0; j < MSIZE; j++) for (let ii = 0; ii < MSIZE; ii++) {
          const k = this.idx(m.x + ii, m.y + j);
          // only clear if not overlapped by another mountain
          if (!this.mountains.some(o => m.x + ii >= o.x && m.x + ii < o.x + MSIZE && m.y + j >= o.y && m.y + j < o.y + MSIZE))
            this.ground[k] = G_GRASS;
        }
      } else this.ground[i] = G_GRASS;
      this.dirty = true;
      return { kind: 'rock' };
    }
    return null;
  },

  /* ---------- trip pathfinding: BFS over the road network ---------- */
  roadPath(ax, ay, bx, by) {
    if (!this.isRoad(ax, ay) || !this.isRoad(bx, by)) return null;
    if (ax === bx && ay === by) return [[ax, ay]];
    const prev = new Int32Array(GW * GH).fill(-1);
    const start = this.idx(ax, ay), goal = this.idx(bx, by);
    prev[start] = start;
    const q = [start];
    let qi = 0;
    while (qi < q.length) {
      const cur = q[qi++];
      if (cur === goal) break;
      const cx = cur % GW, cy = (cur / GW) | 0;
      for (const [ddx, ddy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const nx = cx + ddx, ny = cy + ddy;
        if (!this.isRoad(nx, ny)) continue;
        const ni = this.idx(nx, ny);
        if (prev[ni] !== -1) continue;
        prev[ni] = cur;
        q.push(ni);
      }
    }
    if (prev[goal] === -1) return null;
    const path = [];
    let cur = goal;
    while (cur !== start) { path.push([cur % GW, (cur / GW) | 0]); cur = prev[cur]; }
    path.push([ax, ay]);
    path.reverse();
    return path;
  },

  roadMask(x, y) {
    let m = 0;
    if (this.isRoad(x, y - 1)) m |= 1;
    if (this.isRoad(x + 1, y)) m |= 2;
    if (this.isRoad(x, y + 1)) m |= 4;
    if (this.isRoad(x - 1, y)) m |= 8;
    return m;
  },

  /* ---------- save / load ---------- */
  serialize(extra) {
    const b64 = arr => btoa(String.fromCharCode.apply(null, arr));
    return JSON.stringify({
      v: 2, gw: GW,
      ground: b64(this.ground), tree: b64(this.tree), road: b64(this.roadMap),
      mountains: this.mountains,
      buildings: this.buildings.map(b => ({
        t: b.type, x: b.x, y: b.y, variant: b.variant,
        level: b.level, funds: Math.round(b.funds), ruined: b.ruined ? 1 : 0, con: Math.round(b.construction),
      })),
      extra: extra || {},
    });
  },
  deserialize(json) {
    const o = JSON.parse(json);
    if ((o.gw || 96) !== GW) return { _incompat: true }; // save from an older, smaller map
    const un = (s, arr) => { const d = atob(s); for (let i = 0; i < d.length; i++) arr[i] = d.charCodeAt(i); };
    this.reset();
    un(o.ground, this.ground); un(o.tree, this.tree); un(o.road, this.roadMap);
    this.mountains = o.mountains || [];
    for (const bs of o.buildings) {
      const d = CAT[bs.t];
      if (!d) continue;
      if (bs.x + d.w > GW || bs.y + d.h + 1 > GH) continue; // old smaller-map safety
      const b = {
        id: this.nextId++, type: bs.t, x: bs.x, y: bs.y, w: d.w, h: d.h,
        variant: bs.variant || 0,
        door: { x: bs.x + (d.w >> 1), y: bs.y + d.h },
        connected: false, visitors: 0, inside: 0, parked: 0,
        residents: [], workers: [], jobs: d.jobs || 0, cars: [],
        level: bs.level || 1, funds: bs.funds || 0, ruined: !!bs.ruined, fire: 0,
        construction: bs.con || 0, upgrading: 0, renovating: 0,
      };
      this.buildings.push(b);
      for (let j = 0; j < d.h; j++) for (let i = 0; i < d.w; i++)
        this.bmap[this.idx(bs.x + i, bs.y + j)] = this.buildings.length;
    }
    this.refreshConnections();
    this.dirty = true;
    return o.extra || {};
  },
};
