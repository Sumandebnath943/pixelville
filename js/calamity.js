/* ============================================================
   PixelVille — natural calamities.
   Very rare, very dramatic, always survived together: droughts
   that visibly dry the rivers (the monsoon refills them), monsoon
   floods with rafts in the streets, earthquakes that crack and
   topple buildings, and tornadoes that carve a path across town.
   ============================================================ */
'use strict';

const Calamity = {
  active: null,        // { type, phase, t, ... }
  cooldown: 18000,     // game-min until the first possible event (~2 weeks)
  droughtLevel: 0,     // 0..1 — 1 = rivers & lakes fully dry
  flooded: new Set(),  // tile indices currently under flood water
  rafts: [],           // rafts plying the flooded streets
  shakeT: 0,           // seconds of camera shake remaining
  tornado: null,       // { x, y, vx, vy, ph }
  _dryShown: false,
  _floodTiles: null,

  reset() {
    this.active = null;
    this.cooldown = 18000 + Math.random() * 12000;
    this.droughtLevel = 0;
    this.flooded = new Set();
    this.rafts = [];
    this.shakeT = 0;
    this.tornado = null;
    this._dryShown = false;
    this._floodTiles = null;
    for (const b of World.buildings) { b.flooded = false; b.quakeDamage = false; }
  },

  say(m, at) { if (typeof Life !== 'undefined') Life.say(m, at); },
  news(m) { if (typeof News !== 'undefined') News.breaking(m); },

  tick(dtSim) {
    const gm = dtSim * MIN_PER_SEC;
    if (this.shakeT > 0) this.shakeT -= dtSim;
    this.tickDrought(gm);
    this.tickFlood(gm, dtSim);
    this.tickTornado(gm, dtSim);
    this.tickQuake(gm);
    if (this.active) return;
    if (this.cooldown > 0) { this.cooldown -= gm; return; }
    if (Sim.people.length < 12) return;
    // beyond the cooldown, still a very rare roll — the point of a calamity
    // is that years can pass without one
    if (Math.random() > gm * 0.0004) return;
    const opts = ['quake'];
    if (Weather.season === 1 && this.droughtLevel === 0 && Life.waterTiles.length > 30) opts.push('drought', 'drought');
    if ((Weather.season === 0 || Weather.season === 2) && (Weather.kind === 'rain' || Weather.kind === 'heavy')) opts.push('flood', 'flood');
    if (Weather.season !== 3) opts.push('tornado');
    const type = opts[(Math.random() * opts.length) | 0];
    if (type === 'drought') this.startDrought();
    else if (type === 'flood') this.startFlood();
    else if (type === 'tornado') this.startTornado();
    else this.startQuake();
  },

  endEvent() {
    this.active = null;
    this.cooldown = 25000 + Math.random() * 30000; // a calamity is a once-in-years story
  },

  /* ---------------- drought: the water visibly disappears ---------------- */
  startDrought() {
    this.active = { type: 'drought', t: (2.5 + Math.random() * 2) * 1440, hurt: 0 };
    this.say('☀️ DROUGHT DECLARED: weeks without rain — the river is dropping day by day. Elders speak of rationing.');
    this.news('Drought declared — rivers and lakes are running dry');
    if (typeof Tasks !== 'undefined') Tasks.add('drought', '🌵', 'Survive the drought — hold on for the monsoon');
    Weather.kind = 'clear'; Weather.target = 0; Weather.nextChange = 500;
  },
  tickDrought(gm) {
    const A = this.active;
    if (A && A.type === 'drought') {
      this.droughtLevel = Math.min(1, this.droughtLevel + gm / 2200);
      if (!this._dryShown && this.droughtLevel >= 0.5) {
        this._dryShown = true; World.dirty = true;
        this.say('🌾 The fields are baking — farm work pays half wages and the fishing boats sit idle until the rains return.');
      }
      A.t -= gm;
      A.hurt += gm;
      if (A.hurt > 720) { // twice a day the drought bites
        A.hurt = 0;
        for (const p of Sim.people) if (Math.random() < 0.5) p.mood = Math.max(5, (p.mood === undefined ? 60 : p.mood) - 5);
        const pump = World.buildings.some(b => b.type === 'watertower' && !b.ruined && !b.construction);
        if (!pump && Math.random() < 0.4) {
          const frail = Sim.people.filter(p => p.age >= 60);
          if (frail.length && Math.random() < 0.5) {
            const v = frail[(Math.random() * frail.length) | 0];
            this.say(`🤒 The drought takes its toll: ${Sim.fullName(v)} fell gravely ill from bad water and passed away. Neighbours carry water for the family.`);
            Sim.removePerson(v);
          } else {
            this.say('🤒 Heat sickness is spreading — everyone is urged to share clean water.');
          }
        } else if (Math.random() < 0.5) {
          this.say('🪣 Neighbours share wells and haul water together — the village holds on.');
        }
      }
      if (Weather.isRaining()) A.t -= gm * 6; // early rain shortens the ordeal
      if (A.t <= 0) {
        this.active = { type: 'monsoon', t: 900 };
        this.say('🌧️ THE MONSOON BREAKS THE DROUGHT! Rain at last — the whole village is out dancing in it.');
        this.news('The monsoon arrives — drought broken, rivers refilling');
        Weather.kind = 'heavy'; Weather.target = 1; Weather.nextChange = 350;
        if (typeof Tasks !== 'undefined') Tasks.done('drought', true, 'The drought broke with the monsoon — the village endured');
      }
    } else if (A && A.type === 'monsoon') {
      this.droughtLevel = Math.max(0, this.droughtLevel - gm / 700);
      if (this._dryShown && this.droughtLevel < 0.5) { this._dryShown = false; World.dirty = true; }
      A.t -= gm;
      if (this.droughtLevel <= 0 && A.t <= 0) {
        this.endEvent();
        this.say('🏞️ The rivers and lakes are full again. Ducks, boats and ferries return to the water.');
      }
    }
  },

  /* ---------------- flood: streets under water, rafts, then a shared drain ---------------- */
  startFlood() {
    const rings = 2 + ((Math.random() * 3) | 0); // how far the water swells
    const flood = new Set();
    let frontier = [];
    for (let i = 0; i < World.ground.length; i++) if (World.ground[i] === G_WATER) frontier.push(i);
    if (frontier.length < 20) return;
    for (let r = 0; r < rings; r++) {
      const next = [];
      for (const i of frontier) {
        const x = i % GW, y = (i / GW) | 0;
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const nx = x + dx, ny = y + dy;
          if (!World.inB(nx, ny)) continue;
          const ni = World.idx(nx, ny);
          if (World.ground[ni] === G_WATER || World.ground[ni] === G_ROCK || flood.has(ni)) continue;
          flood.add(ni); next.push(ni);
        }
      }
      frontier = next;
    }
    if (flood.size < 14) return;
    this.flooded = flood;
    this._floodTiles = [...flood];
    // the water remembers which streets it swallowed — some wash out for good
    const washout = [...flood].filter(i => World.roadMap[i]);
    this.active = { type: 'flood', phase: 'rising', t: 500 + Math.random() * 400, drain: 0, washout };
    for (let k = 0; k < 2 + Math.min(5, (flood.size / 30) | 0); k++) {
      const i = this._floodTiles[(Math.random() * this._floodTiles.length) | 0];
      this.rafts.push({ x: (i % GW) * T + 8, y: ((i / GW) | 0) * T + 8, tx: 0, ty: 0, ph: Math.random() * 7, flip: 1 });
    }
    // buildings caught in the water are partially submerged
    for (const b of World.buildings) {
      let wet = false;
      for (let j = 0; j <= b.h && !wet; j++) for (let i = 0; i < b.w; i++)
        if (flood.has(World.idx(b.x + i, b.y + j))) { wet = true; break; }
      b.flooded = wet;
      if (wet) for (const r of b.residents) r.mood = Math.max(5, (r.mood === undefined ? 60 : r.mood) - 12);
    }
    Weather.kind = 'heavy'; Weather.target = 1; Weather.nextChange = Math.max(Weather.nextChange, 420);
    this.say('🌊 FLOOD! The monsoon burst the banks — streets are under water. Villagers are pulling each other onto rafts!', this._floodTiles && this._floodTiles.length ? { x: (this._floodTiles[0] % GW) * T, y: ((this._floodTiles[0] / GW) | 0) * T } : undefined);
    this.news('Flooding across the village — rafts out, everyone helping everyone');
    if (typeof Tasks !== 'undefined') Tasks.add('flood', '🌊', 'Ride out the flood, then drain the streets together');
    if (typeof Life !== 'undefined') {
      const t0 = this._floodTiles[0];
      Life.coverStory((t0 % GW) * T + 8, ((t0 / GW) | 0) * T + 8, this.active);
    }
  },
  tickFlood(gm, dtSim) {
    const F = this.active && this.active.type === 'flood' ? this.active : null;
    if (!F) return;
    const tiles = this._floodTiles || [];
    for (const rf of this.rafts) { // rafts drift between flooded streets
      rf.ph += dtSim;
      const dx = rf.tx - rf.x, dy = rf.ty - rf.y, dist = Math.hypot(dx, dy);
      if (!rf.tx || dist < 3) {
        if (!tiles.length) continue;
        const i = tiles[(Math.random() * tiles.length) | 0];
        rf.tx = (i % GW) * T + 8; rf.ty = ((i / GW) | 0) * T + 8;
      } else {
        rf.x += dx / dist * 6 * dtSim; rf.y += dy / dist * 6 * dtSim;
        if (Math.abs(dx) > 0.5) rf.flip = Math.sign(dx);
      }
    }
    F.t -= gm;
    if (F.phase === 'rising' && F.t <= 0) {
      F.phase = 'draining'; F.t = 700;
      Weather.kind = 'clouds'; Weather.target = 0.15;
      this.say('🤝 The rain has stopped. Bucket lines and pumps everywhere — the whole village is draining the streets together.');
    } else if (F.phase === 'draining') {
      F.drain += gm;
      if (F.drain > 110 && this.flooded.size) { // the water recedes ring by ring
        F.drain = 0;
        const toGo = [];
        for (const i of this.flooded) {
          const x = i % GW, y = (i / GW) | 0;
          for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
            const nx = x + dx, ny = y + dy;
            if (!World.inB(nx, ny)) { toGo.push(i); break; }
            const ni = World.idx(nx, ny);
            if (!this.flooded.has(ni) && World.ground[ni] !== G_WATER) { toGo.push(i); break; }
          }
        }
        for (const i of toGo) this.flooded.delete(i);
        this._floodTiles = [...this.flooded];
        while (this.rafts.length > Math.ceil(this.flooded.size / 40)) this.rafts.pop();
        for (const b of World.buildings) { // re-check who is still in the water
          if (!b.flooded) continue;
          let wet = false;
          for (let j = 0; j <= b.h && !wet; j++) for (let i = 0; i < b.w; i++)
            if (this.flooded.has(World.idx(b.x + i, b.y + j))) { wet = true; break; }
          b.flooded = wet;
        }
      }
      if (F.t <= 0 || !this.flooded.size) {
        this.flooded.clear(); this._floodTiles = null; this.rafts = [];
        for (const b of World.buildings) b.flooded = false;
        // the receding water leaves scars: a few streets washed out for good
        const wash = (F.washout || []).filter(i => World.roadMap[i]);
        const n = Math.min(3, wash.length);
        for (let k = 0; k < n; k++) {
          const i = wash.splice((Math.random() * wash.length) | 0, 1)[0];
          World.roadMap[i] = 0; World.roadStamp++;
        }
        if (n) {
          World.dirty = true;
          World.refreshConnections();
          this.say(`🛣️ The flood washed out ${n} stretch${n > 1 ? 'es' : ''} of road — the crews will have to relay them.`);
        }
        F.over = true;
        this.endEvent();
        for (const p of Sim.people) p.mood = Math.min(98, (p.mood === undefined ? 60 : p.mood) + 6); // pride
        this.say('🌤️ The streets are dry. Muddy, tired and grinning, the village celebrates having pulled through together.');
        if (typeof Tasks !== 'undefined') Tasks.done('flood', true, 'Flood beaten — the village drained the streets together');
      }
    }
  },

  /* ---------------- earthquake: shake, crack, collapse, rebuild ---------------- */
  startQuake() {
    this.shakeT = 5;
    this.active = { type: 'quake', t: 500 };
    const cands = World.buildings.filter(b => !b.ruined && !b.construction);
    const n = Math.min(cands.length, 2 + ((Math.random() * 3) | 0));
    let collapsed = 0, cracked = 0;
    for (let k = 0; k < n; k++) {
      const b = cands[(Math.random() * cands.length) | 0];
      if (b.quakeDamage || b.ruined) continue;
      if (Math.random() < 0.35) {
        b.ruined = true; b.ruinedAt = Sim.day;
        Sim.onBuildingRemoved(b); b.jobs = 0; collapsed++;
      } else {
        b.quakeDamage = true; b.renovating = Math.max(b.renovating || 0, 320); cracked++;
      }
    }
    World.dirty = true;
    if (typeof Snd !== 'undefined') Snd.crunch();
    for (const p of Sim.people) p.mood = Math.max(5, (p.mood === undefined ? 60 : p.mood) - 12);
    Sim.safety = Math.max(15, Sim.safety - 6);
    // a ruptured gas line can turn one cracked building into a blaze
    if (cracked && Math.random() < 0.5 && typeof Life !== 'undefined') {
      const damaged = World.buildings.find(b => b.quakeDamage && !b.fire && !b.ruined);
      if (damaged) Life.igniteBuilding(damaged, `🔥 A gas line ruptured in the quake — the ${CAT[damaged.type].name} is on fire!`);
    }
    this.say(`🫨 EARTHQUAKE! The ground heaved${collapsed ? ` — ${collapsed} building${collapsed > 1 ? 's' : ''} collapsed` : ''}${cracked ? `, ${cracked} more cracked` : ''}. Everyone is out in the streets digging and helping.`);
    this.news('Earthquake rocks the village — neighbours dig through the rubble side by side');
    if (typeof Tasks !== 'undefined') Tasks.add('quake', '🫨', 'Shore up, dig out and rebuild after the earthquake');
  },
  tickQuake(gm) {
    const A = this.active && this.active.type === 'quake' ? this.active : null;
    if (!A) return;
    A.t -= gm;
    if (!A.aftershock && A.t < 300 && Math.random() < gm * 0.004) {
      A.aftershock = true;
      this.shakeT = 2.2;
      this.say('🫨 An aftershock rattles the windows — then silence again.');
    }
    if (A.t <= 0) {
      A.over = true;
      this.endEvent();
      if (typeof Tasks !== 'undefined') Tasks.done('quake', true, 'The village stood back up after the earthquake');
      this.say('🧱 Cracks patched, rubble cleared — the village stood back up, the way it always does.');
    }
  },

  /* ---------------- tornado: a funnel carves across the map ---------------- */
  startTornado() {
    const fromLeft = Math.random() < 0.5;
    this.tornado = {
      x: fromLeft ? -20 : GW * T + 20,
      y: 60 + Math.random() * (GH * T - 160),
      vx: (fromLeft ? 1 : -1) * (13 + Math.random() * 8),
      vy: (Math.random() - 0.5) * 8,
      ph: 0,
    };
    this.active = { type: 'tornado', t: 9999 };
    Weather.kind = 'heavy'; Weather.target = 1; Weather.nextChange = 300;
    this.say('🌪️ TORNADO! A funnel has touched down — take cover! Sirens are wailing across the village.', { x: this.tornado.x, y: this.tornado.y });
    this.news('Tornado on the ground — take cover NOW');
    if (typeof Tasks !== 'undefined') Tasks.add('tornado', '🌪️', 'Shelter from the tornado, then rebuild together');
    if (typeof Snd !== 'undefined') Snd.siren();
  },
  tickTornado(gm, dtSim) {
    const tn = this.tornado;
    if (!tn) return;
    tn.ph += dtSim * 9;
    tn.x += tn.vx * dtSim;
    tn.y += tn.vy * dtSim + Math.sin(tn.ph * 0.3) * 12 * dtSim;
    const tx = Math.round(tn.x / T), ty = Math.round(tn.y / T);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { // shredded trees
      if (!World.inB(tx + i, ty + j)) continue;
      const k = World.idx(tx + i, ty + j);
      if (World.tree[k]) { World.tree[k] = 0; World.dirty = true; }
    }
    const b = World.buildingAt(tx, ty);
    if (b && !b.ruined && !b.construction && Math.random() < dtSim * 0.8) {
      if (Math.random() < 0.4) {
        b.ruined = true; b.ruinedAt = Sim.day;
        Sim.onBuildingRemoved(b); b.jobs = 0; World.dirty = true;
        this.say(`💥 The tornado tore the ${CAT[b.type].name} apart!`);
      } else if (!b.quakeDamage) {
        b.quakeDamage = true; b.renovating = Math.max(b.renovating || 0, 280); World.dirty = true;
      }
    }
    if (tn.x < -40 || tn.x > GW * T + 40 || tn.y < -40 || tn.y > GH * T + 40) {
      this.tornado = null;
      if (this.active) this.active.over = true;
      this.endEvent();
      for (const p of Sim.people) p.mood = Math.max(5, (p.mood === undefined ? 60 : p.mood) - 8);
      if (typeof Tasks !== 'undefined') Tasks.done('tornado', true, 'The tornado passed — rebuilding began the same day');
      this.say('🌤️ The funnel lifted. Everyone is out checking on their neighbours — rebuilding starts today.');
    }
  },
};
