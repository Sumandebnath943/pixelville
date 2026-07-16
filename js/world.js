/* ============================================================
   PixelVille — world grid, terrain, placement, auto-roads.
   Ground types: 0 grass, 1 water, 2 rock, 3 sand (beach).
   ============================================================ */
'use strict';

const GW = 128, GH = 128;
const G_GRASS = 0, G_WATER = 1, G_ROCK = 2, G_SAND = 3;
const MSIZE = 5; // mountain footprint (tiles)
const MIN_PER_SEC = 4; // game-minutes per real second at 1x — one day ≈ 6 real minutes

const World = {
  ground: new Uint8Array(GW * GH),
  tree: new Uint8Array(GW * GH),      // 0 none, 1..3 tree variant
  roadMap: new Uint8Array(GW * GH),   // 0/1
  railMap: new Uint8Array(GW * GH),   // 0/1 — railway tracks
  bmap: new Int16Array(GW * GH),      // building index + 1
  buildings: [],
  mountains: [],                       // {x,y} 3x3 rock + peak sprite
  nextId: 1,
  dirty: true,                         // ground layer needs re-render
  railStamp: 0,                        // bumped on every rail edit (train line re-check)
  signals: new Set(),                  // road-junction tiles governed by traffic lights
  crossings: new Set(),                // rail-over-road tiles with level-crossing gates
  onChange: null,                      // callback

  idx(x, y) { return y * GW + x; },
  inB(x, y) { return x >= 0 && y >= 0 && x < GW && y < GH; },
  isRoad(x, y) { return this.inB(x, y) && this.roadMap[this.idx(x, y)] === 1; },
  isRail(x, y) { return this.inB(x, y) && this.railMap[this.idx(x, y)] === 1; },

  reset() {
    this.ground.fill(0); this.tree.fill(0); this.roadMap.fill(0); this.railMap.fill(0); this.bmap.fill(0);
    this.buildings = []; this.mountains = []; this.nextId = 1; this.dirty = true; this.railStamp++;
    this.signals.clear(); this.crossings.clear();
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
    const mx = 10 + Math.floor(R() * 10), my = 74 + Math.floor(R() * 8);
    this.placeMountain(mx, my); this.placeMountain(mx + 5, my + 3);
    this.placeMountain(mx + 2, my + 7); this.placeMountain(mx + 8, my - 2);
    // the sea along the southern edge, with a broad sandy beach
    this.carveSea(R);
    // country roads entering from the west and the north — visitors arrive along them
    const ry = 58 + Math.floor(R() * 12);
    for (let x = 0; x < 18; x++) if (this.enterCost(x, ry) !== Infinity) this.setRoadWide(x, ry, true);
    const rx = 52 + Math.floor(R() * 16);
    for (let y = 0; y < 14; y++) if (this.enterCost(rx, y) !== Infinity) this.setRoadWide(rx, y, false);
    this.dirty = true;
  },

  /* a sea fills the southern rim; a wavy white-gold beach runs above it */
  carveSea(R) {
    R = R || Math.random;
    const base = GH - 8; // average waterline row
    for (let x = 0; x < GW; x++) {
      const wave = Math.sin(x * 0.05) * 2.2 + Math.sin(x * 0.13 + 4) * 1.6;
      const waterY = Math.round(base + wave);
      const sandY = waterY - (4 + Math.round(Math.sin(x * 0.045 + 2) * 1.5 + R() * 1.5));
      for (let y = sandY; y < GH; y++) {
        if (!this.inB(x, y) || !this.clearForTerrain(x, y)) continue;
        const i = this.idx(x, y);
        if (this.ground[i] === G_ROCK) continue;
        this.ground[i] = y >= waterY ? G_WATER : G_SAND;
        this.tree[i] = 0;
      }
    }
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
      const g = this.ground[k];
      const groundOk = g === G_GRASS || (d.sandOk && g === G_SAND);
      if (!groundOk || this.bmap[k] || this.roadMap[k] || this.railMap[k]) return false;
    }
    if (d.needsWater) { // docks must touch water on at least one side
      let wet = false;
      for (let j = -1; j <= d.h && !wet; j++) for (let i = -1; i <= d.w && !wet; i++) {
        if (i >= 0 && i < d.w && j >= 0 && j < d.h) continue;
        if (this.inB(x + i, y + j) && this.ground[this.idx(x + i, y + j)] === G_WATER) wet = true;
      }
      if (!wet) return false;
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
      // building work scales with footprint: a cottage goes up in a morning,
      // a stadium is a season-long project
      construction: instant ? 0 : 40 + d.w * d.h * 22,
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
    if (b.construction > 0 && typeof Tasks !== 'undefined')
      Tasks.add('b' + b.id, '🏗️', `Build the ${d.name}`);
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

  /* ---------- CITY PLANNING ----------
     Villagers and town hall no longer drop buildings on any free plot.
     Candidate spots along the road network are scored so that industry
     keeps away from homes, shops sit where customers live, services of
     the same kind spread across districts, and coverage targets (a new
     police or fire station for an underserved area) are honoured. */
  findPlannedSpot(key, target) {
    const d = CAT[key];
    if (!d || !d.draw) return this.findBuildSpot(key);
    const roads = [];
    for (let i = 0; i < this.roadMap.length; i++) if (this.roadMap[i]) roads.push(i);
    if (!roads.length) return null;
    const HEAVY = ['factory', 'steelworks', 'sawmill', 'brickworks', 'textilemill', 'cannery',
      'glassworks', 'warehouse', 'powerplant', 'airport', 'farm'];
    const isHeavy = HEAVY.includes(key);
    const isRes = !!d.res;
    const homes = this.buildings.filter(b => CAT[b.type].res && !b.ruined);
    const heavies = this.buildings.filter(b => HEAVY.includes(b.type) && !b.ruined);
    const sameType = this.buildings.filter(b => b.type === key && !b.ruined);
    const nearestDist = (list, x, y) => {
      let best = 99;
      for (const b of list) best = Math.min(best, Math.abs(b.x - x) + Math.abs(b.y - y));
      return best;
    };
    // waterfront buildings (docks) hug the shoreline instead of the streets
    let shoreline = null;
    if (d.needsWater) {
      shoreline = [];
      for (let i = 0; i < this.ground.length; i++) {
        if (this.ground[i] !== G_WATER) continue;
        const wx = i % GW, wy = (i / GW) | 0;
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const nx = wx + dx, ny = wy + dy;
          if (!this.inB(nx, ny)) continue;
          const ng = this.ground[this.idx(nx, ny)];
          if (ng === G_GRASS || (d.sandOk && ng === G_SAND)) { shoreline.push([nx, ny]); break; }
        }
      }
      if (!shoreline.length) return null;
    }
    let bestSpot = null, bestScore = -Infinity;
    for (let tries = 0; tries < 240; tries++) {
      let x, y, ox = 0, oy = 0;
      if (shoreline) {
        const [sx2, sy2] = shoreline[(Math.random() * shoreline.length) | 0];
        x = sx2 - ((Math.random() * d.w) | 0); y = sy2 - ((Math.random() * d.h) | 0);
      } else {
        const r = roads[(Math.random() * roads.length) | 0];
        const rx = r % GW, ry = (r / GW) | 0;
        // build NEAR the road network, not only exactly on it — the auto-road
        // then extends a street to the new door, and the town grows outward
        const spread = 1 + ((tries / 40) | 0); // widen the search when land gets tight
        ox = ((Math.random() * (5 + spread * 4)) | 0) - (2 + spread * 2);
        oy = ((Math.random() * (5 + spread * 4)) | 0) - (2 + spread * 2);
        x = rx + ox - (d.w >> 1); y = ry + oy - d.h;
      }
      if (!this.canPlace(key, x, y)) continue;
      const doorX = x + (d.w >> 1), doorY = y + d.h;
      if (this.enterCost(doorX, doorY) === Infinity) continue; // door must be connectable
      let score = Math.random() * 3; // a pinch of organic randomness
      score -= (Math.abs(ox) + Math.abs(oy)) * 0.6; // compact streets beat lonely outposts
      if (target) score -= (Math.abs(x - target.x) + Math.abs(y - target.y)) * 1.6; // coverage gap wants it HERE
      if (isHeavy) {
        score += Math.min(nearestDist(homes, x, y), 20) * 1.5;     // industry far from homes
        score += Math.min(nearestDist(sameType, x, y) * 0.3, 4);   // light clustering is fine
      } else if (isRes) {
        score += Math.min(nearestDist(heavies, x, y), 16) * 1.3;   // homes far from industry
        score += Math.max(0, 20 - nearestDist(homes, x, y)) * 0.5; // but near the neighbourhood
      } else {
        // shops, civic & leisure: walkable from homes, spread from twins
        score += Math.max(0, 26 - nearestDist(homes, x, y)) * 0.9;
        score += Math.min(nearestDist(sameType, x, y), 14) * 1.1;
        score += Math.min(nearestDist(heavies, x, y), 10) * 0.4;
      }
      if (score > bestScore) { bestScore = score; bestSpot = { x, y }; }
    }
    return bestSpot || this.findBuildSpot(key);
  },

  /* pioneers strike out for the far countryside: a buildable plot at least
     `minDist` manhattan-tiles from (cx, cy) whose door a road can reach */
  findRemoteSpot(key, cx, cy, minDist) {
    const d = CAT[key];
    if (!d || !d.draw) return null;
    let best = null, bestD = -1;
    for (let tries = 0; tries < 300; tries++) {
      const x = 2 + ((Math.random() * (GW - d.w - 4)) | 0);
      const y = 2 + ((Math.random() * (GH - d.h - 5)) | 0);
      const dist = Math.abs(x - cx) + Math.abs(y - cy);
      if (dist < minDist) continue;
      if (!this.canPlace(key, x, y)) continue;
      if (this.enterCost(x + (d.w >> 1), y + d.h) === Infinity) continue;
      if (dist > bestD) { bestD = dist; best = { x, y }; }
      if (best && tries > 120) break; // good enough — pioneers aren't picky
    }
    return best;
  },

  /* ---------- railway ---------- */
  setRail(x, y) {
    if (!this.inB(x, y)) return;
    const i = this.idx(x, y);
    if (this.railMap[i]) return;
    // rails cross grass, sand and roads (level crossings) and BRIDGE water
    // on trestles — only rock and buildings stop the line
    if (this.bmap[i] || this.ground[i] === G_ROCK) return;
    this.railMap[i] = 1; this.tree[i] = 0; this.railStamp++;
    this.dirty = true;
  },
  layRailLine(x0, y0, x1, y1) {
    const sx = Math.sign(x1 - x0) || 1, sy = Math.sign(y1 - y0) || 1;
    for (let x = x0; x !== x1 + sx; x += sx) this.setRail(x, y0);
    for (let y = y0; y !== y1 + sy; y += sy) this.setRail(x1, y);
  },
  railMask(x, y) {
    let m = 0;
    if (this.isRail(x, y - 1)) m |= 1;
    if (this.isRail(x + 1, y)) m |= 2;
    if (this.isRail(x, y + 1)) m |= 4;
    if (this.isRail(x - 1, y)) m |= 8;
    return m;
  },
  railPath(ax, ay, bx, by) {
    if (!this.isRail(ax, ay) || !this.isRail(bx, by)) return null;
    return this._bfs(ax, ay, bx, by, (x, y) => this.isRail(x, y));
  },

  /* ---------- government railway builder ----------
     Lays a full track between two tiles, routing around rock and
     buildings, bridging water and crossing roads. Returns tile count
     laid, or -1 when no route exists. */
  railEnterCost(x, y) {
    if (!this.inB(x, y)) return Infinity;
    const i = this.idx(x, y);
    if (this.bmap[i]) return Infinity;
    if (this.railMap[i]) return 0.1;   // reuse existing track
    const g = this.ground[i];
    if (g === G_ROCK) return Infinity;
    if (g === G_WATER) return 5;       // trestle bridges are expensive
    if (this.roadMap[i]) return 2.5;   // level crossings disliked
    return this.tree[i] ? 1.8 : 1;
  },
  connectRail(x0, y0, x1, y1) {
    if (this.railEnterCost(x0, y0) === Infinity || this.railEnterCost(x1, y1) === Infinity) return -1;
    const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const NS = GW * GH * 4;
    const dist = new Float64Array(NS).fill(Infinity);
    const prev = new Int32Array(NS).fill(-1);
    const heap = [];
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
    for (let d = 0; d < 4; d++) { const s = this.idx(x0, y0) * 4 + d; dist[s] = 0; push(0, s); }
    const goalTile = this.idx(x1, y1);
    let goal = -1;
    while (heap.length) {
      const [c, s] = pop();
      if (c > dist[s]) continue;
      const tile = s >> 2, sd = s & 3;
      if (tile === goalTile) { goal = s; break; }
      const tx = tile % GW, ty = (tile / GW) | 0;
      for (let nd = 0; nd < 4; nd++) {
        const nx = tx + DIRS[nd][0], ny = ty + DIRS[nd][1];
        const ec = this.railEnterCost(nx, ny);
        if (ec === Infinity) continue;
        const turn = nd === sd ? 0 : 1.4; // railways love straight lines
        const ns = this.idx(nx, ny) * 4 + nd;
        const ncost = c + ec + turn;
        if (ncost < dist[ns]) { dist[ns] = ncost; prev[ns] = s; push(ncost, ns); }
      }
    }
    if (goal < 0) return -1;
    let laid = 0, s = goal;
    while (s >= 0) {
      const tile = s >> 2;
      const tx = tile % GW, ty = (tile / GW) | 0;
      if (!this.railMap[tile]) laid++;
      this.setRail(tx, ty);
      s = prev[s];
    }
    return laid;
  },
  /* boats & ferries steam along connected water */
  waterPath(ax, ay, bx, by) {
    const wet = (x, y) => this.inB(x, y) && this.ground[this.idx(x, y)] === G_WATER;
    if (!wet(ax, ay) || !wet(bx, by)) return null;
    return this._bfs(ax, ay, bx, by, wet);
  },
  _bfs(ax, ay, bx, by, pass) {
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
        if (!pass(nx, ny)) continue;
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
    if (g === G_SAND) return 1.5;
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

    if (!this.anyRoadExists()) { // seed the first road segment (a proper avenue)
      this.setRoadWide(dx, dy, true);
      for (const dir of [-1, 1]) {
        for (let s = 1; s <= 3; s++) {
          const x = dx + dir * s;
          if (this.inB(x, dy) && this.enterCost(x, dy) <= 1.8 && this.ground[this.idx(x, dy)] === G_GRASS)
            this.setRoadWide(x, dy, true);
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
    // trace back, lay a two-lane road (the direction of travel tells us
    // which side to widen toward)
    let s = goal;
    while (s >= 0) {
      const tile = s >> 2, sd = s & 3;
      this.setRoadWide(tile % GW, (tile / GW) | 0, sd === 1 || sd === 3);
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

  /* every road is a two-tile-wide avenue: lay the tile plus its partner
     lane (south of horizontal runs, east of vertical runs) */
  setRoadWide(x, y, horizontal) {
    this.setRoad(x, y);
    const wx = horizontal ? x : x + 1, wy = horizontal ? y + 1 : y;
    if (this.enterCost(wx, wy) !== Infinity) this.setRoad(wx, wy);
  },

  /* manual road drag: L-shaped (horizontal then vertical) */
  layRoadLine(x0, y0, x1, y1) {
    const sx = Math.sign(x1 - x0) || 1, sy = Math.sign(y1 - y0) || 1;
    for (let x = x0; x !== x1 + sx; x += sx) if (this.enterCost(x, y0) !== Infinity) this.setRoadWide(x, y0, true);
    for (let y = y0; y !== y1 + sy; y += sy) if (this.enterCost(x1, y) !== Infinity) this.setRoadWide(x1, y, false);
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
    if (this.railMap[i]) { this.railMap[i] = 0; this.railStamp++; this.dirty = true; return { kind: 'rail' }; }
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

  /* nearest road tile to (x,y) within radius r — incident sites sit half a
     lane off the grid, so dispatch targets must snap back onto real asphalt */
  nearestRoad(x, y, r) {
    if (this.isRoad(x, y)) return { x, y };
    for (let d = 1; d <= r; d++)
      for (let j = -d; j <= d; j++) for (let i = -d; i <= d; i++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== d) continue;
        if (this.isRoad(x + i, y + j)) return { x: x + i, y: y + j };
      }
    return null;
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
      v: 3, gw: GW,
      ground: b64(this.ground), tree: b64(this.tree), road: b64(this.roadMap), rail: b64(this.railMap),
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
    if (o.rail) un(o.rail, this.railMap);
    this.mountains = o.mountains || [];
    for (const bs of o.buildings) {
      const d = CAT[bs.t];
      if (!d) continue;
      if (bs.x + d.w > GW || bs.y + d.h + 1 > GH) continue; // old smaller-map safety
      // building footprints have grown between versions: skip anything that
      // would now overlap an already-restored neighbour or blocked ground
      let clear = true;
      for (let j = 0; j < d.h && clear; j++) for (let i = 0; i < d.w; i++) {
        const k = this.idx(bs.x + i, bs.y + j);
        if (this.bmap[k] || this.ground[k] === G_ROCK || this.ground[k] === G_WATER) { clear = false; break; }
      }
      if (!clear) continue;
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
