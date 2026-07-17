/* ============================================================
   PixelVille — festivals & traditions.
   The village year is 28 days (7 per season). Feasts fall on the
   same days every year, so traditions really are traditions:

     day  1        New Year's Day (fireworks spill past midnight)
     day  4–5      Easter — painted eggs, park picnics
     day 18–19     DIWALI — diyas on every sill, two nights of
                   town-wide fireworks
     day 15–16     tree scouting      ┐
     day 17–18     the great haul     │ the Christmas tree
     day 19–21     raising & lights   │ tradition, every winter
     day 22–28     THE TREE IS LIT — a month of celebration,
                   every building decorated, lights all night,
                   carols round the tree (Eve 24, Christmas 25)
     day 27–28     New Year fireworks — two nights, all rooftops
   ============================================================ */
'use strict';

const Festivals = {
  tree: null,          // { year, x, y, src, phase, prog, haulPath }
  markets: [],         // {x, y, seed} — big Christmas markets, all season
  carolers: [],        // {x, y, seed} — singing groups outside homes
  santa: null,         // Santa walking the streets by day
  sleigh: null,        // …and flying at midnight
  sleighDay: 0,
  carolT: 0,
  _seasonOn: false,
  lastAnnounce: '',

  reset() {
    this.tree = null; this.lastAnnounce = '';
    this.markets = []; this.carolers = []; this.santa = null; this.sleigh = null;
    this.sleighDay = 0; this.carolT = 0; this._seasonOn = false;
  },
  say(m) { if (typeof Life !== 'undefined') Life.say(m); },

  yearDay() { return ((Sim.day - 1) % 28) + 1; },
  year() { return Math.floor((Sim.day - 1) / 28); },

  isEaster() { const d = this.yearDay(); return d === 4 || d === 5; },
  isDiwali() { const d = this.yearDay(); return d === 18 || d === 19; },
  isChristmasSeason() { return this.yearDay() >= 22; },   // the whole of winter
  decorated() { return this.isChristmasSeason(); },        // lights on every building
  /* does the season lock fast-forward right now? The player chooses how much
     of Christmas is savoured at 1x: just Eve & Day (default), the whole
     festive week, or not at all. */
  speedLocked() {
    const mode = typeof Settings !== 'undefined' ? Settings.get('xmasLock') : 'eve';
    if (mode === 'off') return false;
    if (mode === 'season') return this.isChristmasSeason();
    const d = this.yearDay();
    return d === 24 || d === 25;
  },
  diyasTonight() { return this.isDiwali(); },
  fireworksNight() {
    const d = this.yearDay();
    return d === 18 || d === 19 ||            // Diwali, two nights
           d === 27 || d === 28 ||            // New Year, two nights
           (d === 1 && Sim.clock < 90);       // …and past midnight
  },

  tick(dtSim) {
    const gm = dtSim * MIN_PER_SEC;
    this.tickTree(gm);
    this.tickSeason(gm);
    this.announce();
  },

  /* ---------- the Christmas month: markets, carolers, Santa ---------- */
  tickSeason(gm) {
    const on = this.isChristmasSeason() && Sim.people.length >= 8;
    if (on && !this._seasonOn) { this._seasonOn = true; this.setupMarkets(); }
    if (!on) {
      if (this._seasonOn) { this._seasonOn = false; this.markets = []; this.carolers = []; this.santa = null; this.sleigh = null; }
      return;
    }
    // carol groups move from doorstep to doorstep
    this.carolT -= gm;
    if (this.carolT <= 0) {
      this.carolT = 90 + Math.random() * 70;
      this.carolers = [];
      const spots = World.buildings.filter(b => b.connected && !b.ruined && !b.construction &&
        (CAT[b.type].res && b.residents.length || b.type === 'church'));
      for (let k = 0; k < Math.min(4, 1 + (spots.length / 8 | 0)); k++) {
        const b = spots[(Math.random() * spots.length) | 0];
        this.carolers.push({ x: b.door.x * T + 8, y: b.door.y * T + 12, seed: b.id * 31 + k });
      }
    }
    // Santa strolls the streets by day, sack over his shoulder
    if (!this.santa && Sim.clock > 540 && Sim.clock < 1200 && Math.random() < gm * 0.012) {
      const roads = [];
      for (let i = 0; i < World.roadMap.length; i++) if (World.roadMap[i]) roads.push(i);
      if (roads.length > 20) {
        const a = roads[(Math.random() * roads.length) | 0], b = roads[(Math.random() * roads.length) | 0];
        const path = World.roadPath(a % GW, (a / GW) | 0, b % GW, (b / GW) | 0);
        if (path && path.length > 14) this.santa = { path, prog: 0, x: path[0][0] * T + 8, y: path[0][1] * T + 8, dirx: 1, diry: 0 };
      }
    }
    if (this.santa) {
      this.santa.prog += 0.55 * (gm / MIN_PER_SEC);
      Life.followPath(this.santa, this.santa.path, this.santa.prog, 5.5);
      if (this.santa.prog >= this.santa.path.length - 1) this.santa = null;
    }
    // …and at midnight, the sleigh crosses the sky, dropping gifts
    const midnight = Sim.clock >= 1420 || Sim.clock < 30;
    if (!this.sleigh && midnight && this.sleighDay !== Sim.day) {
      this.sleighDay = Sim.day;
      this.sleigh = { x: -50, y: 50 + Math.random() * (GH * T * 0.5), ph: Math.random() * 7 };
      this.say('🛷 Bells in the midnight sky — SANTA is over the village, delivering gifts rooftop to rooftop!');
    }
    if (this.sleigh) {
      const dts = gm / MIN_PER_SEC;
      this.sleigh.x += 66 * dts;
      this.sleigh.ph += dts * 2;
      if (Math.random() < dts * 2.2 && typeof Life !== 'undefined' && Life.sparks.length < 220)
        Life.sparks.push({ // a gift twinkles down over the rooftops
          x: this.sleigh.x - 8, y: this.sleigh.y + 10 + Math.random() * 8,
          vx: (Math.random() - 0.5) * 6, vy: 14 + Math.random() * 10,
          life: 1.5, hue: Math.random() < 0.5 ? '#ffd160' : '#ff90e0',
        });
      if (this.sleigh.x > GW * T + 60) this.sleigh = null;
    }
  },

  /* the big Christmas markets: 2–3 of them, placed on open ground by the roads */
  setupMarkets() {
    this.markets = [];
    const roads = [];
    for (let i = 0; i < World.roadMap.length; i++) if (World.roadMap[i]) roads.push(i);
    if (roads.length < 20) return;
    const want = Math.min(3, 1 + Math.floor(Sim.people.length / 50));
    for (let tries = 0; tries < 500 && this.markets.length < want; tries++) {
      const r = roads[(Math.random() * roads.length) | 0];
      const rx = r % GW, ry = (r / GW) | 0;
      const x = rx - 2 + ((Math.random() * 6) | 0) - 2, y = ry + 1 + ((Math.random() * 3) | 0);
      let ok = true;
      for (let j = 0; j < 4 && ok; j++) for (let i2 = 0; i2 < 5; i2++) {
        const xx = x + i2, yy = y + j;
        if (!World.inB(xx, yy)) { ok = false; break; }
        const k = World.idx(xx, yy);
        if (World.ground[k] !== G_GRASS || World.bmap[k] || World.roadMap[k] || World.railMap[k]) { ok = false; break; }
      }
      if (!ok) continue;
      if (this.markets.some(m => Math.abs(m.x - x) + Math.abs(m.y - y) < 30)) continue;
      if (this.tree && Math.abs(this.tree.x - x) + Math.abs(this.tree.y - y) < 9) continue;
      this.markets.push({ x, y, seed: (Math.random() * 1e6) | 0 });
    }
    if (this.markets.length) {
      this.say(`🎪 The Christmas markets are OPEN — ${this.markets.length} of them across town! Stalls, lights, roast chestnuts and mulled cocoa.`);
      if (typeof News !== 'undefined') News.breaking('Christmas markets open across town — lights, stalls and cocoa');
    }
  },

  /* ---------- once-a-day festival announcements & effects ---------- */
  announce() {
    const yd = this.yearDay(), key = this.year() + ':' + yd;
    if (this.lastAnnounce === key) return;
    this.lastAnnounce = key;
    if (Sim.people.length < 4) return;
    const boost = n => { for (const p of Sim.people) p.mood = Math.min(98, (p.mood === undefined ? 60 : p.mood) + n); };
    if (yd === 1) {
      this.say('🎆 HAPPY NEW YEAR, PixelVille! Confetti in the streets and resolutions all round.');
      boost(6);
    } else if (yd === 4) {
      this.say('🐣 Easter morning! Painted eggs on every doorstep and egg hunts in the parks.');
      boost(4);
    } else if (yd === 18) {
      this.say('🪔 DIWALI! The festival of lights — every home glows with diyas tonight, and the sky will burn with fireworks.');
      if (typeof News !== 'undefined') News.breaking('Diwali tonight — diyas on every sill, fireworks over the whole town');
      boost(6);
    } else if (yd === 24) {
      this.say('🎄 Christmas Eve — stockings hung, the great tree shining, carols around the square.');
      boost(5);
    } else if (yd === 25) {
      this.say('🎁 MERRY CHRISTMAS! Presents under every tree — the whole village gathers at the great one.');
      if (typeof News !== 'undefined') News.breaking('Merry Christmas from PVTV — scenes of joy at the great tree');
      boost(8);
      for (const b of World.buildings) // presents aren't free
        if (CAT[b.type].res && b.residents.length) b.funds = Math.max(0, b.funds - 5);
    } else if (yd === 28) {
      this.say("🎇 New Year's Eve — the countdown is on. Fireworks at midnight over every rooftop!");
      if (typeof News !== 'undefined') News.breaking("New Year's Eve — town-wide fireworks at midnight");
    }
  },

  /* ---------- the Christmas tree: an annual, visible tradition ----------
     Scouting (15–16) → the great haul along the streets (17–18) →
     scaffolds & decoration (19–21) → LIT all winter (22–28), then it
     comes down in the new year. */
  findTreeSpot() {
    const c = typeof Gov !== 'undefined' ? Gov.townCenter() : { x: GW >> 1, y: GH >> 1 };
    const plaza = World.buildings.find(b => (b.type === 'plaza' || b.type === 'grandpark') && !b.ruined);
    const cx = plaza ? plaza.x + (plaza.w >> 1) : c.x, cy = plaza ? Math.max(2, plaza.y - 2) : c.y;
    for (let r = 0; r < 24; r++) for (let t = 0; t < Math.max(1, r * 8); t++) {
      const a = (t / Math.max(1, r * 8)) * 6.283;
      const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
      let ok = true;
      for (let j = 0; j < 2 && ok; j++) for (let i = 0; i < 2; i++) {
        if (!World.inB(x + i, y + j)) { ok = false; break; }
        const k = World.idx(x + i, y + j);
        if (World.ground[k] !== G_GRASS || World.bmap[k] || World.roadMap[k] || World.railMap[k]) { ok = false; break; }
      }
      if (ok) return { x, y };
    }
    return null;
  },

  tickTree(gm) {
    const yd = this.yearDay(), yr = this.year();
    if (Sim.people.length < 8) { this.tree = null; return; } // traditions need a village
    if (yd >= 15) {
      if (!this.tree || this.tree.year !== yr) {
        const spot = this.findTreeSpot();
        if (!spot) return;
        // the grandest tree in the farthest woods
        let src = null, bd = -1;
        for (let i = 0; i < World.tree.length; i++) {
          if (!World.tree[i]) continue;
          const x = i % GW, y = (i / GW) | 0;
          const d = Math.abs(x - spot.x) + Math.abs(y - spot.y);
          if (d > bd) { bd = d; src = { x, y }; }
        }
        this.tree = { year: yr, x: spot.x, y: spot.y, src, phase: 'scouting', prog: 0, haulPath: null };
        this.say("🎄 The tree committee set out into the far woods to choose this year's Christmas tree — the great tradition begins!");
        if (typeof News !== 'undefined') News.breaking('Tree committee departs — the hunt for the perfect tree is on');
      }
      const tr = this.tree;
      if (tr.phase === 'scouting' && yd >= 17) {
        tr.phase = 'hauling'; tr.prog = 0;
        const a = tr.src ? World.nearestRoad(tr.src.x, tr.src.y, 30) : null;
        const b = World.nearestRoad(tr.x, tr.y, 12);
        tr.haulPath = a && b ? World.roadPath(a.x, a.y, b.x, b.y) : null;
        if (tr.src) { World.tree[World.idx(tr.src.x, tr.src.y)] = 0; World.dirty = true; } // felled!
        this.say(`🚛 They found it — a giant from the ${typeof Gov !== 'undefined' && tr.src ? Gov.districtName(tr.src.x, tr.src.y) : 'deep woods'}! The great tree is on the move; whole streets are lining up to watch it pass.`);
      }
      if (tr.phase === 'hauling') {
        if (tr.haulPath && tr.haulPath.length > 1) {
          tr.prog += (gm / (1.6 * 1440)) * tr.haulPath.length; // the haul takes about two days
          if (tr.prog >= tr.haulPath.length - 1 || yd >= 19) { tr.phase = 'raising'; tr.prog = 0; }
        } else if (yd >= 19) { tr.phase = 'raising'; tr.prog = 0; }
      }
      if (tr.phase === 'raising') {
        tr.prog = Math.min(1, tr.prog + gm / (2.5 * 1440)); // scaffolds, ladders, tangled lights
        if (tr.prog >= 1 || yd >= 22) {
          tr.phase = 'lit';
          this.say('✨ TREE-LIGHTING NIGHT! The great tree blazes into light at the town centre — carols, cocoa and half the village in scarves.');
          if (typeof News !== 'undefined') News.breaking('The Christmas tree is LIT — celebrations all month at the town centre');
          if (typeof Life !== 'undefined') Life.celebrate(tr.x * T + 16, tr.y * T + 16, '#ffd160');
          for (const p of Sim.people) p.mood = Math.min(98, (p.mood === undefined ? 60 : p.mood) + 8);
        }
      }
    } else if (this.tree) {
      if (this.tree.phase === 'lit' && this.tree.year !== yr) {
        this.say('🎄 The great tree came down for another year — needles everywhere, memories all round. See you next winter.');
        this.tree = null;
      } else if (this.tree.year !== yr) {
        this.tree = null; // an unfinished tradition resets quietly
      }
    }
  },
};
