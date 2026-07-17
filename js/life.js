/* ============================================================
   PixelVille — ambient life & the crime and justice system.
   Hikers trek up mountains (torches at night), birds cross the
   sky, and unemployment breeds night-time burglaries that the
   police (and courthouse) answer.
   ============================================================ */
'use strict';

const Life = {
  hikers: [],           // {route, idx, f, pause, seed, x, y, done}
  birds: [],            // {x, y, vx, ph}
  ducks: [],            // {x, y, tx, ty, flip}
  butterflies: [],      // {ax, ay, ph, v}
  tourists: [],         // out-of-town cars visiting venues
  rockets: [], sparks: [],
  fireflySpots: [],     // filled by main on ground rebuild (tree positions)
  waterTiles: [], edgeRoads: [],  // filled by main on ground rebuild
  crime: null,          // {burglar, target, phase, robT, fled}
  police: [],           // {path, prog, x, y, dirx, phase, station}
  arrests: 0, crimes: 0,
  cooldown: 240,        // game-min until first possible crime
  onEvent: null,        // toast hook

  reset() {
    this.hikers = []; this.birds = []; this.ducks = []; this.butterflies = [];
    this.tourists = []; this.rockets = []; this.sparks = [];
    this.crime = null; this.police = []; this.arrests = 0; this.crimes = 0; this.cooldown = 240;
    this.fireTrucks = []; this.firesRecent = 0; this.buckets = [];
    this.disaster = null; this.collapseCd = 1440;
    this.dispute = null; this.crash = null; this.incidentCd = 120; this.gawkers = [];
    this.riot = null; this.roadworks = []; this.workT = 200;
    this.rally = null;
    this.buses = []; this.busSig = ''; this.busT = 0;
    this.trains = []; this.trainSig = ''; this.trainT = 0;
    this.boats = []; this.ferry = null; this.ferrySig = '';
    this.helis = []; this.heliCd = 300;
    this.campaignCars = []; this.votingBooths = null;
    this.trials = []; this.graveCases = 0; this.graveCd = 2400; this.graveCrime = null;
    this.reporters = []; this.beachfolk = []; this.sandTiles = [];
    if (typeof Tasks !== 'undefined') Tasks.reset();
  },
  say(m) { if (this.onEvent) this.onEvent(m); },

  tick(dtSim, dtReal) {
    this.tickHikers(dtSim);
    this.tickBirds(dtSim);
    this.tickDucks(dtSim);
    this.tickButterflies(dtReal);
    this.tickTourists(dtSim);
    this.tickFireworks(dtReal);
    this.tickCrime(dtSim);
    this.tickFires(dtSim);
    this.tickPlanes(dtSim, dtReal);
    this.tickWorks(dtSim);
    this.tickIncidents(dtSim);
    this.tickGawkers(dtSim);
    this.tickDisaster(dtSim);
    this.tickRiot(dtSim);
    this.tickRally(dtSim);
    this.tickSky(dtSim, dtReal);
    this.tickBuses(dtSim);
    this.tickTrains(dtSim);
    this.tickBoats(dtSim);
    this.tickHelis(dtSim, dtReal);
    this.tickCampaignLife(dtSim);
    this.tickJustice(dtSim);
    this.tickReporters(dtSim);
    this.tickBeach(dtSim);
  },

  /* ---------------- the press: PVTV reporters cover every incident ---------------- */
  reporters: [],
  coverStory(cx, cy, ref, headline) {
    const station = World.buildings.find(b => b.type === 'tvstation' && b.connected && !b.construction && !b.ruined);
    if (!station || this.reporters.length >= 3) return;
    this.reporters.push({
      sx: station.door.x * T + 8, sy: station.door.y * T + 8,
      tx: cx + 10, ty: cy + 6,
      f: 0, phase: 'come', stay: 30, age: 0, ref: ref || null,
      seed: (station.id * 131 + this.reporters.length * 17) >>> 0,
    });
    if (headline && typeof News !== 'undefined') News.breaking(headline);
  },
  tickReporters(dt) {
    const gm = dt * MIN_PER_SEC;
    for (const r of this.reporters) {
      r.age += gm;
      if (r.phase === 'come') {
        r.f = Math.min(1, r.f + dt * 0.35);
        if (r.f >= 1) r.phase = 'report';
      } else if (r.phase === 'report') {
        r.stay -= gm;
        const live = r.ref && !r.ref.over && r.age < 200;
        if (r.stay <= 0 && !live) r.phase = 'leave';
      } else {
        r.f -= dt * 0.3;
      }
    }
    this.reporters = this.reporters.filter(r => r.phase !== 'leave' || r.f > 0);
  },

  /* ---------------- beach days: towels, umbrellas & waders on the sand ---------------- */
  beachfolk: [], sandTiles: [],
  tickBeach(dt) {
    const warm = Weather.season <= 1 && !Weather.isRaining();
    const daytime = Sim.clock > 540 && Sim.clock < 1140;
    const want = (warm && daytime && this.sandTiles.length > 20)
      ? Math.min(14, 2 + (Sim.people.length / 6 | 0)) : 0;
    while (this.beachfolk.length < want) {
      const [tx, ty] = this.sandTiles[(Math.random() * this.sandTiles.length) | 0];
      this.beachfolk.push({
        x: tx * T + 3 + Math.random() * 10, y: ty * T + 3 + Math.random() * 10,
        seed: (Math.random() * 1e6) | 0,
        kind: ['man', 'woman', 'kid'][(Math.random() * 3) | 0],
        mode: Math.random() < 0.4 ? 'towel' : Math.random() < 0.5 ? 'stand' : 'wade',
        towelC: ['#e05a5a', '#4f9ed0', '#f2c14f', '#5fae62'][(Math.random() * 4) | 0],
        umbrella: Math.random() < 0.45,
        ph: Math.random() * 7,
      });
    }
    if (this.beachfolk.length > want) this.beachfolk.length = want;
    for (const bf of this.beachfolk) bf.ph += dt;
  },

  /* ---------------- election rallies & celebrations ---------------- */
  rally: null,
  startRally(cand) {
    const venue = World.buildings.find(b => b.type === 'townhall' && b.connected && !b.ruined) ||
                  World.buildings.find(b => (b.type === 'park' || b.type === 'school') && b.connected && !b.ruined) ||
                  World.buildings.find(b => b.connected && !b.ruined);
    if (!venue) return;
    const cx = venue.door.x * T + 8, cy = venue.door.y * T + 22;
    const crowd = [];
    const adults = Sim.people.filter(p => p.kind !== 'kid');
    const n = Math.min(9, 3 + (adults.length / 3 | 0));
    for (let i = 0; i < n; i++)
      crowd.push({
        x: cx + (i % 5) * 9 - 18 + ((i * 7) % 3),
        y: cy + ((i / 5) | 0) * 8 + 6,
        seed: i * 449 + venue.id, kind: i % 3 === 0 ? 'woman' : 'man',
      });
    const speaker = cand.personId ? Sim.people.find(p => p.id === cand.personId) : null;
    this.rally = {
      x: cx, y: cy - 2, t: 150, crowd, color: cand.color || '#4f8ede',
      speakerKind: speaker ? speaker.kind : 'man',
      speakerSeed: speaker ? speaker.seed : cand.name.length * 37,
    };
  },
  tickRally(dt) {
    if (!this.rally) return;
    this.rally.t -= dt * MIN_PER_SEC;
    if (this.rally.t <= 0) this.rally = null;
  },
  celebrate(x, y, color) {
    for (let i = 0; i < 44; i++) {
      const a = Math.random() * 6.283, sp = 14 + Math.random() * 34;
      this.sparks.push({
        x: x + (Math.random() * 20 - 10), y: y - 6 - Math.random() * 8,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 14,
        life: 1 + Math.random() * 0.5,
        hue: Math.random() < 0.6 ? (color || '#ffd160') : ['#ffd160', '#ff90e0', '#80ff90'][(Math.random() * 3) | 0],
      });
    }
  },

  /* ---------------- building fires & the fire brigade ---------------- */
  fireTrucks: [], buckets: [],
  /* neighbours grab buckets and run over — the fire can only be contained
     when a crew is visibly on the scene */
  formBucket(b) {
    if (this.buckets.some(k => k.b === b)) return;
    const cx = b.x * T + b.w * 8, cy = b.y * T + b.h * 8;
    const helpers = [];
    for (const h of World.buildings) {
      if (helpers.length >= 4) break;
      if (!CAT[h.type].res || !h.residents.length || h === b || h.ruined) continue;
      if (Math.abs(h.x - b.x) + Math.abs(h.y - b.y) > 22) continue;
      helpers.push({
        sx: h.door.x * T + 8, sy: h.door.y * T + 8,
        tx: cx + Math.cos(helpers.length * 1.6 + b.id) * (b.w * 8 + 9),
        ty: cy + Math.sin(helpers.length * 1.6 + b.id) * (b.h * 8 + 7) + 5,
        f: 0, seed: (h.id * 613 + helpers.length * 7) >>> 0,
        kind: helpers.length % 2 ? 'woman' : 'man',
      });
    }
    if (helpers.length) this.buckets.push({ b, helpers });
  },
  dispatchFire(b, announce) {
    if (!b || !b.fire || this.fireTrucks.some(u => u.target === b && !u.done)) return false;
    const stations = World.buildings.filter(s => s.type === 'fire' && s.connected && !s.construction && !s.ruined);
    let best = null, bp = null;
    for (const s of stations) {
      const path = World.roadPath(s.door.x, s.door.y, b.door.x, b.door.y);
      if (path && (!bp || path.length < bp.length)) { best = s; bp = path; }
    }
    if (!best) {
      if (announce && !b.fireNoStationAnnounced) {
        b.fireNoStationAnnounced = true;
        this.say('🪣 No fire station — neighbours are forming a bucket brigade while the village considers one.');
      }
      return false;
    }
    this.fireTrucks.push({ path: bp, prog: 0, x: best.door.x * T + 8, y: best.door.y * T + 8, dirx: 1, diry: 0, phase: 'go', target: b, douse: 0 });
    this.say(`🚒 Fire brigade dispatched from the ${CAT[best.type].name}!`);
    return true;
  },
  tickFires(dt) {
    const gm = dt * MIN_PER_SEC;
    this.firesRecent = Math.max(0, (this.firesRecent || 0) - gm / 7200); // memory fades over ~5 days
    // ignition
    for (const b of World.buildings) {
      if (b.fire || b.ruined || b.construction) continue;
      const mult = b.type === 'factory' ? 3 : (b.type === 'restaurant' || b.type === 'bakery') ? 2 : 1;
      if (Math.random() < 0.000007 * mult * gm) {
        // Fires are emergencies, not an instant demolition timer.  A building
        // has time for a truck to cross town, and neighbours can still limit
        // the damage when the village has not built a station yet.
        b.fire = 1; b.fireT = 300 + Math.random() * 120;
        b.fireNoStationAnnounced = false; b.fireDispatchRetry = 0;
        this.firesRecent = (this.firesRecent || 0) + 1;
        for (const r of b.residents) {
          r.mood = Math.max(5, (r.mood === undefined ? 60 : r.mood) - 15); // shock
          if (typeof Mind !== 'undefined') Mind.remember(r, 'fire', 'watched their home catch fire', -2, b.id);
        }
        if (b.ownerId) { // the owner family takes it hard too
          const oh = World.buildings.find(o => o.id === b.ownerId);
          if (oh) for (const r of oh.residents) r.mood = Math.max(5, (r.mood === undefined ? 60 : r.mood) - 10);
        }
        this.say(`🔥 Fire at the ${CAT[b.type].name}!`);
        if (typeof Tasks !== 'undefined') Tasks.add('fire' + b.id, '🔥', `Put out the fire at the ${CAT[b.type].name}`);
        if (typeof Snd !== 'undefined') Snd.siren();
        this.dispatchFire(b, true);
        this.coverStory(b.x * T + b.w * 8, (b.y + b.h) * T, b, `Fire at the ${CAT[b.type].name} — crews responding`);
      }
    }
    // burn down
    for (const b of World.buildings) {
      if (!b.fire) continue;
      // If a fire station is completed while a blaze is active, it can still
      // answer the call instead of waiting for the next fire.
      b.fireDispatchRetry = Math.max(0, (b.fireDispatchRetry || 0) - gm);
      if (b.fireDispatchRetry <= 0 && !this.dispatchFire(b, false)) {
        b.fireDispatchRetry = 90;
        this.formBucket(b); // no truck coming — neighbours run over themselves
      }
      b.fireT -= gm;
      if (b.fireT <= 0) {
        // Saving the structure requires responders visibly on the scene: a
        // bucket crew that actually made it, or a fire truck still dousing.
        const bucket = this.buckets.find(k => k.b === b);
        const crew = bucket ? bucket.helpers.filter(h => h.f >= 1).length : 0;
        if (crew >= 2 && Math.random() < 0.78) {
          b.fire = 0;
          b.renovating = Math.max(b.renovating || 0, 260);
          b.fireDamage = true;
          this.say(`🪣 The bucket brigade beat the flames at the ${CAT[b.type].name} — repairs are under way.`);
          if (typeof Tasks !== 'undefined') Tasks.done('fire' + b.id, true, `Fire at the ${CAT[b.type].name} beaten by the bucket brigade`);
        } else {
          if (typeof Tasks !== 'undefined') Tasks.done('fire' + b.id, false, `The ${CAT[b.type].name} burned down`);
          b.fire = 0; b.ruined = true; b.ruinedAt = Sim.day;
          Sim.onBuildingRemoved(b);
          b.jobs = 0; b.level = 1;
          World.dirty = true;
          Sim.safety = Math.max(20, Sim.safety - 4);
          this.say(`💔 The ${CAT[b.type].name} burned down — but the neighbors won't let it end there…`);
          this.startDisaster(b, 'fire');
        }
      }
    }
    // bucket crews hurry over; disband when the fire is over
    for (const k of this.buckets) for (const h of k.helpers) h.f = Math.min(1, h.f + dt * 0.3);
    this.buckets = this.buckets.filter(k => k.b.fire);
    // trucks
    for (const u of this.fireTrucks) {
      if (u.phase === 'go') {
        u.prog += 3.4 * dt;
        this.followPath(u, u.path, u.prog, 3.5);
        if (u.prog >= u.path.length - 1) { u.phase = 'douse'; u.douse = 22; }
      } else if (u.phase === 'douse') {
        u.douse -= gm;
        if (u.douse <= 0 || !u.target.fire) {
          if (u.target.fire) {
            u.target.fire = 0;
            this.say(`🧯 Fire at the ${CAT[u.target.type].name} put out — building saved!`);
            if (typeof Tasks !== 'undefined') Tasks.done('fire' + u.target.id, true, `Fire brigade saved the ${CAT[u.target.type].name}`);
          }
          u.phase = 'return'; u.path = [...u.path].reverse(); u.prog = 0;
        }
      } else {
        u.prog += 3.4 * dt;
        this.followPath(u, u.path, u.prog, 3.5);
        if (u.prog >= u.path.length - 1) u.done = true;
      }
    }
    this.fireTrucks = this.fireTrucks.filter(u => !u.done);
  },

  /* ---------------- public buses between bus stops ---------------- */
  buses: [], busSig: '', busT: 0,
  activeOf(type) {
    return World.buildings.filter(b => b.type === type && b.connected && !b.construction && !b.ruined);
  },
  tickBuses(dt) {
    const gm = dt * MIN_PER_SEC;
    this.busT -= gm;
    if (this.busT <= 0) {
      this.busT = 90;
      const stops = this.activeOf('busstop');
      const sig = stops.map(s => s.id).join(',');
      if (sig !== this.busSig) {
        this.busSig = sig;
        this.buses = [];
        if (stops.length >= 2) {
          // chain the stops by proximity into one looping route
          const chain = [stops[0]];
          const rest = stops.slice(1);
          while (rest.length) {
            const last = chain[chain.length - 1];
            let bi = 0, bd = 1e9;
            rest.forEach((s, i) => {
              const d = Math.abs(s.x - last.x) + Math.abs(s.y - last.y);
              if (d < bd) { bd = d; bi = i; }
            });
            chain.push(rest.splice(bi, 1)[0]);
          }
          let route = [], stopIdx = [0];
          let ok = true;
          for (let i = 0; i < chain.length - 1; i++) {
            const seg = World.roadPath(chain[i].door.x, chain[i].door.y, chain[i + 1].door.x, chain[i + 1].door.y);
            if (!seg) { ok = false; break; }
            route = route.concat(i === 0 ? seg : seg.slice(1));
            stopIdx.push(route.length - 1);
          }
          if (ok && route.length > 3) {
            const nBuses = Math.min(3, 1 + ((chain.length / 3) | 0));
            for (let k = 0; k < nBuses; k++)
              this.buses.push({
                route, stopIdx, prog: (route.length - 1) * (k / nBuses), dir: 1,
                pause: 0, x: route[0][0] * T + 8, y: route[0][1] * T + 8, dirx: 1, diry: 0,
                lastStop: -1,
              });
            this.say(`🚌 The village bus line is running — ${chain.length} stops on the loop!`);
          }
        }
      }
    }
    for (const bus of this.buses) {
      if (bus.pause > 0) { bus.pause -= gm; continue; }
      // buses wait at closed level-crossing gates like everyone else
      const bni = bus.dir > 0 ? Math.ceil(bus.prog) : Math.floor(bus.prog);
      if (World.crossings.size && bni !== bus.prog && bni >= 0 && bni < bus.route.length) {
        const [bnx, bny] = bus.route[bni];
        if (World.crossings.has(World.idx(bnx, bny)) && this.trainNearTile(bnx, bny, 5)) continue;
      }
      bus.prog += 1.9 * dt * bus.dir;
      if (bus.prog >= bus.route.length - 1) { bus.prog = bus.route.length - 1; bus.dir = -1; bus.pause = 5; }
      if (bus.prog <= 0) { bus.prog = 0; bus.dir = 1; bus.pause = 5; }
      // brief stop at each bus shelter on the way
      const at = Math.round(bus.prog);
      if (bus.stopIdx.includes(at) && at !== bus.lastStop) { bus.lastStop = at; bus.pause = 4; }
      this.followPath(bus, bus.route, bus.prog, 3.5);
    }
  },

  /* ---------------- trains on player-laid rails ---------------- */
  trains: [], trainSig: '', trainT: 0,
  /* every rail tile touching the station — a station can face several tracks,
     and only one of them may lead to the other station */
  stationRailDoors(st) {
    const doors = [];
    for (let j = -1; j <= st.h; j++) for (let i = -1; i <= st.w; i++) {
      if (i >= 0 && i < st.w && j >= 0 && j < st.h) continue;
      if (World.isRail(st.x + i, st.y + j)) doors.push({ x: st.x + i, y: st.y + j });
    }
    return doors;
  },
  stationRailDoor(st) { return this.stationRailDoors(st)[0] || null; },
  tickTrains(dt) {
    const gm = dt * MIN_PER_SEC;
    this.trainT -= gm;
    if (this.trainT <= 0) {
      this.trainT = 120;
      const stations = World.buildings.filter(b => b.type === 'trainstation' && !b.construction && !b.ruined);
      const industry = World.buildings.some(b =>
        ['factory', 'steelworks', 'warehouse', 'sawmill', 'brickworks', 'cannery', 'glassworks', 'powerplant'].includes(b.type) &&
        !b.construction && !b.ruined);
      const sig = stations.map(s => s.id).join(',') + '|' + World.railStamp + '|' + (industry ? 'f' : '');
      if (sig !== this.trainSig) {
        this.trainSig = sig;
        const hadTrain = this.trains.length > 0;
        this.trains = [];
        if (stations.length >= 2) {
          // label each connected piece of track; "connected stations" then
          // simply means "stations touching the same piece"
          const comp = new Int32Array(GW * GH).fill(-1);
          let nc = 0;
          for (let i = 0; i < World.railMap.length; i++) {
            if (!World.railMap[i] || comp[i] !== -1) continue;
            const q = [i]; comp[i] = nc;
            let qi = 0;
            while (qi < q.length) {
              const cur = q[qi++], cx = cur % GW, cy = (cur / GW) | 0;
              for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
                if (!World.isRail(cx + dx, cy + dy)) continue;
                const ni = World.idx(cx + dx, cy + dy);
                if (comp[ni] === -1) { comp[ni] = nc; q.push(ni); }
              }
            }
            nc++;
          }
          const perComp = new Map(); // component id -> [{s, d}] stations on it
          let railless = 0;
          for (const s of stations) {
            const doors = this.stationRailDoors(s);
            if (!doors.length) { railless++; continue; }
            const seen = new Set();
            for (const d of doors) {
              const c = comp[World.idx(d.x, d.y)];
              if (seen.has(c)) continue;
              seen.add(c);
              if (!perComp.has(c)) perComp.set(c, []);
              perComp.get(c).push({ s, d });
            }
          }
          let best = null;
          for (const list of perComp.values())
            if (!best || list.length > best.length) best = list;
          if (best && best.length >= 2) {
            // chain the stations along the track, nearest-first; every path
            // exists because they all sit on the same piece of track
            const left = best.slice();
            let cur = left.shift();
            let route = [[cur.d.x, cur.d.y]], served = 1;
            const stopIdx = [0];
            while (left.length) {
              let picked = -1, seg = null;
              for (let i = 0; i < left.length; i++) {
                const s2 = World.railPath(cur.d.x, cur.d.y, left[i].d.x, left[i].d.y);
                if (s2 && (!seg || s2.length < seg.length)) { seg = s2; picked = i; }
              }
              if (picked < 0) break;
              route = route.concat(seg.slice(1));
              stopIdx.push(route.length - 1);
              cur = left.splice(picked, 1)[0];
              served++;
            }
            if (served >= 2 && route.length >= 2) {
              // a fleet grows with the line: the local calls at every station,
              // an express dashes end-to-end, freight rumbles through for industry.
              // Each service runs on its OWN track of the three-track mainline
              // (lane = px offset onto its rails), so trains never overlap.
              const mk = (type, speed, cars, prog) => ({
                route, stopIdx: type === 'local' ? stopIdx : [0, route.length - 1],
                prog: prog || 0, dir: 1, pause: 8, type, speed, cars, lastStop: -1,
                lane: type === 'express' ? -5 : type === 'freight' ? 5 : 0,
                x: route[0][0] * T + 8, y: route[0][1] * T + 8, dirx: 1, diry: 0,
              });
              this.trains.push(mk('local', 4.2, 3, 0));
              if (served >= 3 && route.length > 26) this.trains.push(mk('express', 6.4, 2, (route.length - 1) * 0.5));
              if (industry && route.length > 18) this.trains.push(mk('freight', 3.1, 4, (route.length - 1) * 0.82));
              if (!hadTrain || served > 2) {
                const extra = [];
                if (this.trains.some(t2 => t2.type === 'express')) extra.push('an express');
                if (this.trains.some(t2 => t2.type === 'freight')) extra.push('a freight run');
                this.say(`🚂 All aboard! The railway serves ${served} station${served > 1 ? 's' : ''}${extra.length ? ' — plus ' + extra.join(' and ') : ''}.`);
              }
            }
          } else if (railless) {
            this.say('🛤️ A train station has no track touching it — drag the railway right up to the station walls.');
          } else {
            this.say('🛤️ Each station has track, but the tracks aren\'t joined into one line yet.');
          }
        }
      }
    }
    for (const tr of this.trains) {
      if (tr.pause > 0) { tr.pause -= gm; continue; }
      tr.prog += (tr.speed || 4.2) * dt * tr.dir;
      if (tr.prog >= tr.route.length - 1) { tr.prog = tr.route.length - 1; tr.dir = -1; tr.pause = 12; tr.lastStop = tr.route.length - 1; }
      else if (tr.prog <= 0) { tr.prog = 0; tr.dir = 1; tr.pause = 12; tr.lastStop = 0; }
      else if (tr.stopIdx) {
        const at = Math.round(tr.prog);
        if (tr.stopIdx.includes(at) && at !== tr.lastStop && at !== 0 && at !== tr.route.length - 1) {
          tr.lastStop = at; tr.pause = 6; // calling at an intermediate station
        }
      }
      this.followPath(tr, tr.route, tr.prog, 0);
    }
  },

  /* ---------------- boats & the ferry ---------------- */
  boats: [], ferry: null, ferrySig: '',
  tickBoats(dt) {
    if (Weather.season === 3) { this.boats = []; this.ferry = null; return; } // frozen water
    if (typeof Calamity !== 'undefined' && Calamity.droughtLevel > 0.5) { this.boats = []; this.ferry = null; return; } // no water!
    const docks = this.activeOf('dock').concat(this.activeOf('boatclub'), this.activeOf('fishmarket'));
    // rowboats pottering about near the waterfront — villager-owned fishing
    // boats join the fleet
    const owned = World.buildings.filter(b => b.boat && !b.ruined).length;
    const cap = Math.min(9, docks.length * 2 + owned);
    if (docks.length && this.waterTiles.length > 6 && this.boats.length < cap && Math.random() < dt * 0.04) {
      const d = docks[(Math.random() * docks.length) | 0];
      let best = null, bd = 1e9;
      for (const [tx, ty] of this.waterTiles) {
        const dd = Math.abs(tx - d.x) + Math.abs(ty - d.y);
        if (dd < bd) { bd = dd; best = [tx, ty]; }
      }
      if (best && bd < 8)
        this.boats.push({ x: best[0] * T + 8, y: best[1] * T + 8, tx: best[0] * T + 8, ty: best[1] * T + 8, flip: 1, ph: Math.random() * 7 });
    }
    for (const b of this.boats) {
      b.ph += dt;
      const dx = b.tx - b.x, dy = b.ty - b.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 2) {
        for (let tries = 0; tries < 8; tries++) {
          const [tx, ty] = this.waterTiles[(Math.random() * this.waterTiles.length) | 0];
          if (Math.abs(tx * T + 8 - b.x) + Math.abs(ty * T + 8 - b.y) < 90) {
            b.tx = tx * T + 6 + Math.random() * 4; b.ty = ty * T + 6 + Math.random() * 4;
            break;
          }
        }
      } else {
        b.x += dx / dist * 7 * dt; b.y += dy / dist * 7 * dt;
        if (Math.abs(dx) > 0.5) b.flip = Math.sign(dx);
      }
    }
    // a ferry shuttles between two docks joined by open water
    if (docks.length >= 2) {
      const sig = docks.map(d => d.id).join(',');
      if (sig !== this.ferrySig) {
        this.ferrySig = sig;
        this.ferry = null;
        const waterNear = d => {
          for (let j = -1; j <= d.h; j++) for (let i = -1; i <= d.w; i++) {
            if (i >= 0 && i < d.w && j >= 0 && j < d.h) continue;
            if (World.inB(d.x + i, d.y + j) && World.ground[World.idx(d.x + i, d.y + j)] === G_WATER)
              return { x: d.x + i, y: d.y + j };
          }
          return null;
        };
        const a = waterNear(docks[0]), b = waterNear(docks[1]);
        if (a && b) {
          const path = World.waterPath(a.x, a.y, b.x, b.y);
          if (path && path.length > 8) {
            this.ferry = { route: path, prog: 0, dir: 1, pause: 10, x: a.x * T + 8, y: a.y * T + 8, dirx: 1, diry: 0 };
            this.say('⛴️ A ferry now sails between the docks!');
          }
        }
      }
      if (this.ferry) {
        const gm = dt * MIN_PER_SEC;
        if (this.ferry.pause > 0) this.ferry.pause -= gm;
        else {
          this.ferry.prog += 1.6 * dt * this.ferry.dir;
          if (this.ferry.prog >= this.ferry.route.length - 1) { this.ferry.prog = this.ferry.route.length - 1; this.ferry.dir = -1; this.ferry.pause = 14; }
          if (this.ferry.prog <= 0) { this.ferry.prog = 0; this.ferry.dir = 1; this.ferry.pause = 14; }
          this.followPath(this.ferry, this.ferry.route, this.ferry.prog, 0);
        }
      }
    } else this.ferry = null;
  },

  /* ---------------- helicopters between helipads ---------------- */
  helis: [], heliCd: 300,
  heliPads() {
    return World.buildings.filter(b => ['heliport', 'hospital', 'skyscraper'].includes(b.type) &&
      !b.construction && !b.ruined);
  },
  tickHelis(dtSim, dtReal) {
    const gm = dtSim * MIN_PER_SEC;
    if (this.heliCd > 0) this.heliCd -= gm;
    const pads = this.heliPads();
    const hasPort = pads.some(p => p.type === 'heliport');
    if (hasPort && !this.helis.length && this.heliCd <= 0 && Sim.clock > 420 && Sim.clock < 1200) {
      const from = pads[(Math.random() * pads.length) | 0];
      const others = pads.filter(p => p !== from);
      const to = others.length && Math.random() < 0.7 ? others[(Math.random() * others.length) | 0] : null;
      this.helis.push({
        x: -30, y: Math.random() * GH * T * 0.6 + 40,
        tx: from.x * T + from.w * 8, ty: from.y * T + from.h * 8,
        next: to, alt: 44, phase: 'in', wait: 0, rot: 0,
      });
      this.heliCd = 500 + Math.random() * 500;
    }
    for (const h of this.helis) {
      h.rot += dtReal * 20;
      const dx = h.tx - h.x, dy = h.ty - h.y;
      const dist = Math.hypot(dx, dy);
      if (h.phase === 'in' || h.phase === 'hop') {
        if (dist > 3) {
          const sp = 46 * dtSim;
          h.x += dx / dist * Math.min(sp, dist); h.y += dy / dist * Math.min(sp, dist);
          if (dist < 60) h.alt = Math.max(12, h.alt - 22 * dtSim);
        } else h.phase = 'land';
      } else if (h.phase === 'land') {
        h.alt -= 14 * dtSim;
        if (h.alt <= 0) { h.alt = 0; h.phase = 'wait'; h.wait = 14 + Math.random() * 12; }
      } else if (h.phase === 'wait') {
        h.wait -= gm;
        if (h.wait <= 0) h.phase = 'takeoff';
      } else if (h.phase === 'takeoff') {
        h.alt += 16 * dtSim;
        if (h.alt >= 44) {
          h.alt = 44;
          if (h.next) {
            h.tx = h.next.x * T + h.next.w * 8; h.ty = h.next.y * T + h.next.h * 8;
            h.next = null; h.phase = 'hop';
          } else { h.tx = GW * T + 60; h.ty = h.y - 30; h.phase = 'out'; }
        }
      } else { // out
        const sp = 52 * dtSim;
        h.x += dx / dist * sp; h.y += dy / dist * sp;
        if (h.x > GW * T + 40) h.done = true;
      }
    }
    this.helis = this.helis.filter(h => !h.done);
  },

  /* ---------------- campaign cars & voting day ---------------- */
  campaignCars: [], votingBooths: null,
  tickCampaignLife(dt) {
    const campaigning = typeof Gov !== 'undefined' && Gov.campaign && !Gov.campaign.votingDay;
    if (!campaigning) { this.campaignCars = []; return; }
    // a couple of cars with candidate banners cruise the streets with a megaphone
    if (this.campaignCars.length < 2 && Math.random() < dt * 0.05) {
      const roads = [];
      for (let i = 0; i < World.roadMap.length; i++)
        if (World.roadMap[i]) roads.push([i % GW, (i / GW) | 0]);
      if (roads.length > 10) {
        const a = roads[(Math.random() * roads.length) | 0];
        const b = roads[(Math.random() * roads.length) | 0];
        const path = World.roadPath(a[0], a[1], b[0], b[1]);
        if (path && path.length > 10) {
          const ci = (Math.random() * Gov.campaign.candidates.length) | 0;
          this.campaignCars.push({ path, prog: 0, ci, x: a[0] * T + 8, y: a[1] * T + 8, dirx: 1, diry: 0, seed: ci * 3 });
        }
      }
    }
    for (const c of this.campaignCars) {
      c.prog += 1.6 * dt;
      this.followPath(c, c.path, c.prog, 3.5);
      if (c.prog >= c.path.length - 1) c.done = true;
    }
    this.campaignCars = this.campaignCars.filter(c => !c.done);
  },
  setupVotingBooths(campaign) {
    const venue = World.buildings.find(b => b.type === 'townhall' && b.connected && !b.ruined) ||
                  World.buildings.find(b => (b.type === 'school' || b.type === 'park') && b.connected && !b.ruined) ||
                  World.buildings.find(b => b.connected && !b.ruined);
    if (!venue) return;
    // the polling station stands on open ground BESIDE the hall — booths,
    // ballot box and the whole queue need a clear lawn, not the middle of
    // the road outside the front door
    const vcx = venue.x + (venue.w >> 1), vcy = venue.y + venue.h;
    let spot = null;
    for (let r = 1; r <= 7 && !spot; r++) {
      for (let j = -r; j <= r && !spot; j++) for (let i = -r; i <= r; i++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
        const x = vcx + i, y = vcy + j;
        let ok = true;
        for (let dx = -2; dx <= 2 && ok; dx++) for (let dy = 0; dy <= 1; dy++) {
          if (!World.inB(x + dx, y + dy)) { ok = false; break; }
          const k = World.idx(x + dx, y + dy);
          const gk = World.ground[k];
          if ((gk !== G_GRASS && gk !== G_SAND) || World.bmap[k] || World.roadMap[k] || World.railMap[k]) { ok = false; break; }
        }
        if (ok) spot = { x, y };
      }
    }
    const cx = spot ? spot.x * T + 8 : venue.door.x * T + 8;
    const cy = spot ? spot.y * T + 8 : venue.door.y * T + 30;
    const queue = [];
    const adults = Sim.people.filter(p => p.kind !== 'kid');
    const n = Math.min(10, 4 + (adults.length / 4 | 0));
    for (let i = 0; i < n; i++) {
      const p = adults[i % adults.length];
      queue.push({ seed: p ? p.seed : i * 331, kind: p ? p.kind : (i % 2 ? 'woman' : 'man') });
    }
    this.votingBooths = { x: cx, y: cy, queue, colors: campaign.candidates.map(c => c.color) };
  },

  /* ---------------- grave crimes, trials & the ultimate penalty ---------------- */
  trials: [], graveCases: 0, graveCd: 2400, graveCrime: null,
  tickJustice(dt) {
    const gm = dt * MIN_PER_SEC;
    if (this.graveCd > 0) this.graveCd -= gm;

    // scheduled trials reach their verdict
    for (const trial of this.trials) {
      if (Sim.day < trial.day) continue;
      trial.done = true;
      const p = Sim.people.find(q => q.id === trial.pid);
      const guilty = Math.random() < 0.75;
      if (!guilty) {
        this.say(`⚖️ The court found ${trial.name} NOT GUILTY of ${trial.charge} — released for lack of proof.`);
        if (p) { p.heldUntil = 0; p.mood = Math.min(98, (p.mood || 60) + 5); }
        if (typeof Tasks !== 'undefined') Tasks.done('trial' + trial.pid, true, `Trial of ${trial.name}: acquitted`);
      } else if (trial.capital) {
        this.say(`⚖️ VERDICT: ${trial.name} was found guilty of ${trial.charge}. The sentence is death — carried out at dawn. The village is silent.`);
        if (p) Sim.removePerson(p, true);
        Sim.safety = Math.min(100, Sim.safety + 6);
        if (typeof Tasks !== 'undefined') Tasks.done('trial' + trial.pid, true, `Trial of ${trial.name}: guilty — capital sentence carried out`);
      } else {
        this.say(`⚖️ VERDICT: ${trial.name} was found guilty of ${trial.charge} and sent to prison.`);
        if (p) { p.heldUntil = Sim.day + 14; p.mood = 15; }
        Sim.safety = Math.min(100, Sim.safety + 3);
        if (typeof Tasks !== 'undefined') Tasks.done('trial' + trial.pid, true, `Trial of ${trial.name}: guilty — imprisoned`);
      }
    }
    this.trials = this.trials.filter(t => !t.done);

    // very rare, very serious crime — the darkest day a village can have
    if (this.graveCd > 0 || Sim.people.length < 14) return;
    const badMood = Sim.people.filter(p => p.kind !== 'kid' && (p.mood === undefined ? 60 : p.mood) < 38 && p.heldUntil <= Sim.day);
    const risk = gm * 0.000012 * Math.min(2, Math.max(1, Sim.people.length / 40)) *
      (Sim.safety < 60 ? 1.8 : 1) * (badMood.length >= 3 ? 1.6 : 0.5);
    if (Math.random() >= risk) return;
    this.graveCd = 5000 + Math.random() * 4000;
    this.graveCases++;
    const adults = Sim.people.filter(p => p.kind !== 'kid');
    const perp = badMood.length ? badMood[(Math.random() * badMood.length) | 0] : adults[(Math.random() * adults.length) | 0];
    const victims = adults.filter(p => p !== perp && p.home !== perp.home);
    if (!victims.length || !perp) return;
    const victim = victims[(Math.random() * victims.length) | 0];
    const murder = Math.random() < 0.55;
    const charge = murder ? 'murder' : 'a violent assault';
    Sim.safety = Math.max(10, Sim.safety - (murder ? 14 : 8));
    if (murder) {
      this.say(`🕯️ DARK DAY: ${Sim.fullName(victim)} was found murdered. The village is in shock and demands justice.`);
      for (const r of victim.home.residents) if (r !== victim) r.mood = Math.max(5, (r.mood || 60) - 30);
      Sim.removePerson(victim);
    } else {
      this.say(`🚨 ${Sim.fullName(victim)} was violently attacked — the village demands the culprit is found.`);
      victim.mood = Math.max(5, (victim.mood || 60) - 25);
    }
    if (typeof Tasks !== 'undefined') Tasks.add('trial' + perp.id, '⚖️', `Bring the ${charge} case to justice`);
    const police = World.buildings.some(b => b.type === 'police' && b.connected && !b.construction && !b.ruined);
    this.dispatchTo(perp.home.door.x, perp.home.door.y);
    const caught = Math.random() < (police ? 0.82 : 0.3);
    if (!caught) {
      this.say(`🌫️ The culprit slipped away in the night — ${police ? 'the manhunt continues' : 'without police, there was no one to give chase'}.`);
      Sim.safety = Math.max(10, Sim.safety - 5);
      if (Math.random() < 0.5) Sim.removePerson(perp, true); // fled the village for good
      if (typeof Tasks !== 'undefined') Tasks.done('trial' + perp.id, false, `The ${charge} case went cold — culprit at large`);
      return;
    }
    perp.heldUntil = Sim.day + 30;
    this.arrests++;
    const court = World.buildings.some(b => b.type === 'courthouse' && b.connected && !b.construction && !b.ruined);
    if (court) {
      this.trials.push({ pid: perp.id, name: Sim.fullName(perp), charge, capital: murder, day: Sim.day + 2 });
      this.say(`🚔 ${Sim.fullName(perp)} was arrested for ${charge}. Trial at the courthouse in 2 days${murder ? ' — the gravest charge carries the ultimate penalty' : ''}.`);
    } else {
      this.say(`🚔 ${Sim.fullName(perp)} was arrested for ${charge} — held in the cells. Without a courthouse there can be no proper trial!`);
      if (typeof Tasks !== 'undefined') Tasks.done('trial' + perp.id, true, `${Sim.fullName(perp)} held for ${charge} (no courthouse for a trial)`);
    }
  },

  /* ---------------- air traffic ---------------- */
  planes: [], planeT: 0,
  tickPlanes(dtSim, dtReal) {
    const airport = World.buildings.find(b => b.type === 'airport' && !b.construction && !b.ruined);
    if (!airport) { this.planes = []; return; }
    this.planeT -= dtSim * MIN_PER_SEC;
    if (this.planeT <= 0 && this.planes.length < 2) {
      this.planeT = 100 + Math.random() * 140;
      const ry = airport.y * T + airport.h * T - 19; // runway sits along the south apron
      const rx0 = airport.x * T + 4, rx1 = airport.x * T + airport.w * T - 4;
      if (Math.random() < 0.5) this.planes.push({ mode: 'takeoff', x: rx0, y: ry, alt: 0, v: 14, rx1 });
      else this.planes.push({ mode: 'land', x: -40, y: ry, alt: 70, v: 85, rx0, rx1, stop: rx1 - 30 });
    }
    for (const pl of this.planes) {
      if (pl.mode === 'takeoff') {
        pl.v = Math.min(110, pl.v + 40 * dtReal);
        pl.x += pl.v * dtReal;
        if (pl.x > pl.rx1 - 30) pl.alt += 34 * dtReal;
        if (pl.x > GW * T + 60 || pl.alt > 110) pl.done = true;
      } else {
        pl.x += pl.v * dtReal;
        if (pl.x < pl.rx0 + 20) pl.alt = Math.max(0, pl.alt - 20 * dtReal * (pl.v / 60));
        else if (pl.alt > 0) pl.alt = Math.max(0, pl.alt - 30 * dtReal);
        if (pl.alt <= 0) pl.v = Math.max(0, pl.v - 55 * dtReal);
        if (pl.v <= 1 || pl.x > pl.stop + 60) { pl.done = true; airport.visitors += 3 + (Math.random() * 4 | 0); }
      }
    }
    this.planes = this.planes.filter(p => !p.done);
  },

  /* ---------------- road works & renovations ---------------- */
  roadworks: [], workT: 200,
  tickWorks(dt) {
    const gm = dt * MIN_PER_SEC;
    this.workT -= gm;
    if (this.workT <= 0) {
      this.workT = 260 + Math.random() * 300;
      if (this.roadworks.length < 2) {
        const straights = [];
        for (let i = 0; i < World.roadMap.length; i++) {
          if (!World.roadMap[i]) continue;
          const x = i % GW, y = (i / GW) | 0;
          const m = World.roadMask(x, y);
          if ((m === 5 || m === 10) && World.ground[i] !== G_WATER) straights.push([x, y]);
        }
        if (straights.length > 6) {
          const [x, y] = straights[(Math.random() * straights.length) | 0];
          this.roadworks.push({ x, y, t: 150 });
          this.say('🚧 Road maintenance crew at work');
        }
      }
      // building renovation
      const cands = World.buildings.filter(b => !b.construction && !b.ruined && !b.fire && !b.upgrading && !b.renovating && CAT[b.type].ex > 6);
      if (cands.length > 3 && Math.random() < 0.5) {
        const b = cands[(Math.random() * cands.length) | 0];
        b.renovating = 170;
      }
    }
    for (const rw of this.roadworks) rw.t -= gm;
    this.roadworks = this.roadworks.filter(rw => rw.t > 0);
    for (const b of World.buildings) if (b.renovating > 0) {
      b.renovating -= gm;
      if (b.renovating <= 0) { b.renovating = 0; b.quakeDamage = false; } // repairs done, cracks patched
    }
  },

  /* ---------------- collapse, solidarity & rebuilding ----------------
     When a building falls (collapse or fire), neighbors run to the site,
     emergency services roll out, the rubble is cleared together and the
     community rebuilds the same building. */
  disaster: null, firesRecent: 0, collapseCd: 1440,
  startDisaster(b, cause) {
    if (this.disaster) return; // one crisis at a time
    const cx = b.x * T + b.w * 8, cy = b.y * T + b.h * 8;
    // neighbours AND nearby shopkeepers/workers run over — a ruin in a
    // commercial district must draw a visible crowd too
    const helpers = [];
    for (const spot of this.crowdSpots(cx, cy, 40)) {
      if (helpers.length >= 7) break;
      helpers.push({
        sx: spot.x, sy: spot.y,
        tx: cx + Math.cos(helpers.length * 1.3) * (b.w * 8 + 10),
        ty: cy + Math.sin(helpers.length * 1.3) * (b.h * 8 + 8),
        f: 0, seed: (spot.id * 977 + helpers.length) >>> 0,
        kind: ['man', 'woman'][helpers.length % 2],
      });
    }
    this.disaster = { b, cause, phase: 'respond', t: 70, helpers };
    this.disaster.unit = this.dispatchTo(b.door.x, b.door.y, this.disaster, 18); // police secure the area
    this.coverStory(cx, cy, this.disaster, `${CAT[b.type].name} down — neighbours rush to help`);
    if (cause === 'collapse') { // fire brigade checks for survivors
      const st = World.buildings.find(s => s.type === 'fire' && s.connected && !s.construction);
      if (st) {
        const path = World.roadPath(st.door.x, st.door.y, b.door.x, b.door.y);
        if (path) this.fireTrucks.push({ path, prog: 0, x: st.door.x * T + 8, y: st.door.y * T + 8, dirx: 1, diry: 0, phase: 'go', target: b, douse: 8 });
      }
    }
  },
  tickDisaster(dt) {
    const gm = dt * MIN_PER_SEC;
    if (this.collapseCd > 0) this.collapseCd -= gm;
    // rare structural collapse
    if (!this.disaster && this.collapseCd <= 0) {
      const cands = World.buildings.filter(b => !b.ruined && !b.construction && !b.fire &&
        b.type !== 'airport' && CAT[b.type].ex > 4 && Math.random() < 0.002);
      if (cands.length && Math.random() < gm * 0.0006) {
        const b = cands[(Math.random() * cands.length) | 0];
        b.ruined = true; b.ruinedAt = Sim.day;
        Sim.onBuildingRemoved(b);
        World.dirty = true;
        Sim.safety = Math.max(20, Sim.safety - 3);
        this.say(`💥 The ${CAT[b.type].name} suddenly collapsed! Neighbors are rushing to help`);
        if (typeof Snd !== 'undefined') Snd.crunch();
        this.startDisaster(b, 'collapse');
        this.collapseCd = 4000;
      }
    }
    const D = this.disaster;
    if (!D) {
      // old ruins the player ignores get rebuilt by the community after a day
      const ruin = World.buildings.find(b => b.ruined && b.ruinedAt !== undefined && Sim.day - b.ruinedAt >= 2);
      if (ruin) this.startDisaster(ruin, 'rebuild');
      return;
    }
    for (const h of D.helpers) h.f = Math.min(1, h.f + dt * 0.25); // hurry to the site
    D.t -= gm;
    if (D.phase === 'respond' && D.t <= 30) {
      D.phase = 'clear';
      this.say('🤝 The whole street is out clearing the rubble together');
    }
    if (D.t <= 0) {
      const b = D.b;
      const type = b.type, x = b.x, y = b.y;
      World.removeBuilding(b);
      const nb = World.placeBuilding(type, x, y);
      if (nb) {
        nb.construction = Math.max(nb.construction, 60);
        this.say(`🧱 Community rebuild started — the ${CAT[type].name} will rise again!`);
      }
      World.refreshConnections();
      D.over = true;
      this.disaster = null;
    }
  },

  /* ---------------- riots: the people vs. city hall ---------------- */
  riot: null,
  tickRiot(dt) {
    const gm = dt * MIN_PER_SEC;
    if (this.riot) {
      this.riot.t -= gm;
      if (this.riot.t <= 0) {
        this.say('🕊️ The protest disperses… for now.');
        if (Gov.leader && (Gov.leader.type.kind === 'corrupt' || Gov.approval < 15))
          Gov.forceResign('under public pressure');
        this.riot = null;
      }
      return;
    }
    if (typeof Gov === 'undefined' || !Gov.leader || Gov.riotCd > 0) return;
    const s = Sim.stats();
    const grievance = Gov.grievanceReport();
    // Protests grow from specific, visible failures (unsafe streets, missing
    // emergency cover, unemployment or corruption), rather than appearing
    // just because a random approval number happened to be low.
    const riotChance = gm * 0.00045 * (grievance.severity / 100);
    if (Gov.approval < 45 && grievance.severity >= 42 && s.pop >= 10 && Math.random() < riotChance) {
      const hall = World.buildings.find(b => b.type === 'townhall' && !b.ruined) ||
                   World.buildings.find(b => !b.ruined && b.connected);
      if (!hall) return;
      // protests are made of the actually-unhappy, not extras from casting
      const angry = Sim.people.filter(p => p.kind !== 'kid' && (p.mood === undefined ? 60 : p.mood) < 46);
      if (angry.length < 4) return; // not enough genuinely upset villagers to riot
      const cx = hall.door.x * T + 8, cy = hall.door.y * T + 20;
      const crowd = [];
      const n = Math.min(9, angry.length);
      for (let i = 0; i < n; i++)
        crowd.push({ x: cx + (i % 4) * 9 - 14, y: cy + ((i / 4) | 0) * 9, seed: angry[i].seed, kind: angry[i].kind });
      this.riot = { x: cx, y: cy, t: 40, crowd, reason: grievance.reason };
      Gov.approval = Math.max(5, Gov.approval - 6);
      Sim.safety = Math.max(20, Sim.safety - 3);
      Gov.riotCd = 6;
      this.say(`📢 Villagers are rioting outside ${hall.type === 'townhall' ? 'town hall' : 'in the street'} over ${grievance.reason} — they demand better from Mayor ${Gov.leader.name}!`);
      this.dispatchTo(hall.door.x, hall.door.y, this.riot, 25);
      this.coverStory(cx, cy, this.riot, `Protest over ${grievance.reason} outside town hall`);
    }
  },

  /* ---------------- onlookers: crowds gather at incidents ----------------
     Anywhere something dramatic happens, people from nearby occupied
     buildings walk over, stand in a loose ring and watch until it's over. */
  gawkers: [],
  /* doors of nearby occupied buildings (homes or staffed workplaces),
     closest first — the pool that crowds and helpers are drawn from */
  crowdSpots(cx, cy, maxTiles) {
    const spots = [];
    for (const h of World.buildings) {
      if (h.ruined || h.construction) continue;
      const occupied = (h.residents && h.residents.length) || (h.workers && h.workers.length);
      if (!occupied) continue;
      const d = Math.abs(h.door.x * T + 8 - cx) + Math.abs(h.door.y * T + 8 - cy);
      if (d > maxTiles * T) continue;
      spots.push({ x: h.door.x * T + 8, y: h.door.y * T + 8, d, id: h.id });
    }
    spots.sort((a, b) => a.d - b.d);
    return spots;
  },
  spawnGawkers(cx, cy, n, ref) {
    const spots = this.crowdSpots(cx, cy, 40);
    for (let i = 0; i < n && i < spots.length; i++) {
      const a = i * 2.4 + (cx + cy) * 0.01;
      this.gawkers.push({
        sx: spots[i].x, sy: spots[i].y,
        tx: cx + Math.cos(a) * (11 + (i % 2) * 4), ty: cy + Math.sin(a) * 8 + 3,
        f: 0, phase: 'come', stay: 14 + i * 4, age: 0, ref: ref || null, gawk: true,
        seed: (spots[i].id * 389 + i * 31) >>> 0, kind: i % 2 ? 'woman' : 'man',
      });
    }
  },
  tickGawkers(dt) {
    const gm = dt * MIN_PER_SEC;
    for (const g of this.gawkers) {
      g.age += gm;
      if (g.phase === 'come') {
        g.f = Math.min(1, g.f + dt * 0.3);
        if (g.f >= 1) g.phase = 'watch';
      } else if (g.phase === 'watch') {
        g.stay -= gm;
        // stay as long as the incident is live (with a hard cap), wander home after
        const live = g.ref && !g.ref.over && g.age < 240;
        if (g.stay <= 0 && !live) g.phase = 'leave';
      } else {
        g.f -= dt * 0.25;
      }
    }
    this.gawkers = this.gawkers.filter(g => g.phase !== 'leave' || g.f > 0);
  },

  /* ---------------- disputes & crashes ---------------- */
  dispute: null, crash: null, incidentCd: 120,
  tickIncidents(dt) {
    const gm = dt * MIN_PER_SEC;
    if (this.incidentCd > 0) this.incidentCd -= gm;
    // shop alarms triggered by petty thefts wind down on their own
    for (const b of World.buildings) {
      if (!b.alarmT) continue;
      b.alarmT -= gm;
      if (b.alarmT <= 0) { b.alarmT = 0; if (!this.crime || this.crime.target !== b) b.alarm = false; }
    }

    if (this.dispute) {
      const d0 = this.dispute;
      // if a squad car is on the way the quarrel keeps simmering until it
      // pulls up (capped, in case the car can never make it there)
      if (d0.unit && !d0.unit.done && !d0.arrived && (d0.stall = (d0.stall || 0) + gm) < 120) {
        if (d0.t < 3) d0.t = 3;
        for (const p of d0.ppl) p.freezeT = Math.max(p.freezeT || 0, 4);
      }
      if (d0.arrived && !d0.calmed) {
        d0.calmed = true;
        d0.t = Math.min(d0.t, 4);
        for (const p of d0.ppl) { p.bubble = '🚔'; p.bubbleUntil = performance.now() + 1800; }
        this.say('🚔 An officer talked the quarrellers down');
      }
      d0.t -= gm;
      if (!d0.calmed && d0.t % 2 < 0.3) for (const p of d0.ppl) { p.bubble = Math.random() < 0.5 ? '💢' : '😠'; p.bubbleUntil = performance.now() + 1500; }
      if (d0.t <= 0) {
        for (const p of d0.ppl) { p.freezeT = 0; p.bubble = '🤝'; p.bubbleUntil = performance.now() + 2000; }
        d0.over = true;
        this.dispute = null;
      }
    }
    if (this.crash) {
      const c = this.crash;
      // the wreck stays on the road until the squad car actually arrives
      if (c.unit && !c.unit.done && !c.arrived && (c.stall = (c.stall || 0) + gm) < 180) {
        if (c.t < 5) c.t = 5;
      }
      if (c.arrived && !c.secured) {
        c.secured = true;
        c.t = Math.min(c.t, 10);
        this.say('🚔 Police reached the crash — statements taken, tow truck called');
      }
      c.t -= gm;
      if (c.t <= 0) { c.over = true; this.say('🛻 Tow truck cleared the crash site'); this.crash = null; }
    }
    if (this.incidentCd > 0 || Sim.clock < 420 || Sim.clock > 1320) return;

    // dispute: two pedestrians clash
    if (!this.dispute && Math.random() < gm * 0.0012) {
      const walkers = Sim.travelers().filter(p => !p.trip.car && p.kind !== 'kid');
      for (let i = 0; i < walkers.length && !this.dispute; i++) for (let j = i + 1; j < walkers.length; j++) {
        const a = walkers[i], b = walkers[j];
        if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 16) {
          a.freezeT = b.freezeT = 9;
          this.dispute = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, t: 9, ppl: [a, b] };
          this.dispute.unit = this.dispatchTo(Math.round(a.x / T), Math.round(a.y / T), this.dispute, 8);
          this.say(this.dispute.unit ? '😠 Public dispute in the street — police en route!' : '😠 A loud argument breaks out in the street');
          this.spawnGawkers(this.dispute.x, this.dispute.y, 3, this.dispute);
          this.incidentCd = 300;
          break;
        }
      }
    }
    // crash: two cars collide
    if (!this.crash && Math.random() < gm * 0.0009) {
      const cars = Sim.travelers().filter(p => p.trip.car);
      for (let i = 0; i < cars.length && !this.crash; i++) for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 20) {
          this.crash = {
            x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, t: 30, t0: 30,
            s1: a.trip.car.seed, s2: b.trip.car.seed,
            a1: (Math.random() - 0.5) * 1.1, a2: (Math.random() - 0.5) * 1.1 + 1.5,
          };
          for (const p of [a, b]) { // shaken drivers head home
            if (p.trip.car) p.trip.car.free = true;
            p.state = 'in'; p.at = p.home; p.trip = null; p.dest = null; p.returnAt = undefined; p.backTo = null;
          }
          if (typeof Snd !== 'undefined') Snd.crunch();
          this.crash.unit = this.dispatchTo(Math.round(this.crash.x / T), Math.round(this.crash.y / T), this.crash, 12);
          this.say(this.crash.unit ? '💥 Car crash! Police are on the way' : '💥 Car crash! No squad car can respond — the drivers sort it out themselves');
          this.spawnGawkers(this.crash.x, this.crash.y, 5, this.crash);
          this.coverStory(this.crash.x, this.crash.y, this.crash, 'Two-car collision snarls traffic');
          Sim.safety = Math.max(20, Sim.safety - 2);
          this.incidentCd = 400;
          break;
        }
      }
    }
  },
  /* send the nearest squad car to a tile; `scene` (optional) is the incident
     object — it gets .arrived stamped when the car pulls up, and the car then
     holds the scene for `wait` game-minutes before heading back */
  dispatchTo(tx, ty, scene, wait) {
    const spot = World.nearestRoad(tx, ty, 4);
    if (!spot) return null;
    const stations = World.buildings.filter(s => s.type === 'police' && s.connected && !s.construction && !s.ruined);
    let best = null, bp = null;
    for (const s of stations) {
      const path = World.roadPath(s.door.x, s.door.y, spot.x, spot.y);
      if (path && (!bp || path.length < bp.length)) { best = s; bp = path; }
    }
    if (!best) return null;
    const u = { path: bp, prog: 0, x: best.door.x * T + 8, y: best.door.y * T + 8, dirx: 1, diry: 0, phase: 'go', station: best, patrol: true, scene: scene || null, wait: wait || 10 };
    this.police.push(u);
    if (typeof Snd !== 'undefined') Snd.siren();
    return u;
  },

  /* ---------------- sky events: balloons, UFO ---------------- */
  balloons: [], ufo: null, ufoCd: 0,
  tickSky(dtSim, dtReal) {
    // hot-air balloons on calm days
    const calm = Weather.kind === 'clear' && Weather.season !== 3 && Sim.clock > 420 && Sim.clock < 1100;
    if (calm && this.balloons.length < 2 && Math.random() < dtSim * 0.006) {
      this.balloons.push({ x: -20, y: 60 + Math.random() * (GH * T - 160), vx: 6 + Math.random() * 4, ph: Math.random() * 7 });
      this.say('🎈 A hot-air balloon drifts over the valley');
    }
    for (const b of this.balloons) { b.x += b.vx * dtReal * (UI.speeds[UI.speedIdx] || 0); b.ph += dtReal; }
    this.balloons = this.balloons.filter(b => b.x < GW * T + 40);
    // …and something stranger, on dark nights
    const night = Sim.clock >= 1380 || Sim.clock < 180;
    if (this.ufoCd > 0) this.ufoCd -= dtSim * MIN_PER_SEC;
    if (!this.ufo && night && this.ufoCd <= 0 && Math.random() < dtSim * 0.0022) {
      let x = Math.random() * GW * T, y = Math.random() * GH * T * 0.5;
      if (World.mountains.length) { const m = World.mountains[(Math.random() * World.mountains.length) | 0]; x = m.x * T + 40; y = m.y * T - 40; }
      this.ufo = { x, y, t: 13, ph: 0 };
      this.say('👽 Strange lights reported in the night sky…');
    }
    if (this.ufo) {
      const u = this.ufo;
      u.t -= dtReal; u.ph += dtReal * 2;
      u.x += Math.sin(u.ph) * 14 * dtReal; u.y += Math.cos(u.ph * 0.7) * 8 * dtReal;
      if (u.t <= 0) { u.x += 900 * dtReal; if (u.t < -0.6) this.ufo = null; } // zips away
    }
  },

  /* ---------------- ducks on the water ---------------- */
  tickDucks(dt) {
    if (Weather.season === 3) { this.ducks = []; return; } // frozen over
    const cap = Math.min(9, (this.waterTiles.length / 12) | 0);
    if (this.waterTiles.length > 5 && this.ducks.length < cap && Math.random() < dt * 0.06) {
      const [tx, ty] = this.waterTiles[(Math.random() * this.waterTiles.length) | 0];
      this.ducks.push({ x: tx * T + 8, y: ty * T + 8, tx: tx * T + 8, ty: ty * T + 8, flip: 1, ph: Math.random() * 7 });
    }
    if (this.ducks.length > cap) this.ducks.length = Math.max(0, cap);
    for (const d of this.ducks) {
      d.ph += dt * 2;
      const dx = d.tx - d.x, dy = d.ty - d.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 2) {
        // paddle toward a nearby water tile
        for (let tries = 0; tries < 8; tries++) {
          const [tx, ty] = this.waterTiles[(Math.random() * this.waterTiles.length) | 0];
          if (Math.abs(tx * T + 8 - d.x) + Math.abs(ty * T + 8 - d.y) < 70) {
            d.tx = tx * T + 4 + Math.random() * 8; d.ty = ty * T + 4 + Math.random() * 8;
            break;
          }
        }
      } else {
        d.x += dx / dist * 5 * dt; d.y += dy / dist * 5 * dt;
        if (Math.abs(dx) > 0.5) d.flip = Math.sign(dx);
      }
    }
  },

  /* ---------------- butterflies ---------------- */
  tickButterflies(dt) {
    const want = (Weather.season <= 1 && !Weather.isRaining() && Sim.clock > 420 && Sim.clock < 1100)
      ? Math.min(8, this.fireflySpots.length) : 0;
    while (this.butterflies.length < want) {
      const s = this.fireflySpots[(Math.random() * this.fireflySpots.length) | 0];
      if (!s) break;
      this.butterflies.push({ ax: s.x, ay: s.y, ph: Math.random() * 7, v: (Math.random() * 3) | 0 });
    }
    if (this.butterflies.length > want) this.butterflies.length = want;
    for (const b of this.butterflies) b.ph += dt * 2.4;
  },

  /* ---------------- tourists (out-of-town visitors) ---------------- */
  tickTourists(dt) {
    const daytime = Sim.clock > 570 && Sim.clock < 1230;
    if (daytime && this.tourists.length < 4 && this.edgeRoads.length && Math.random() < dt * 0.045) {
      const venues = World.buildings.filter(b => CAT[b.type].visit && b.connected);
      if (venues.length) {
        const v = venues[(Math.random() * venues.length) | 0];
        const e = this.edgeRoads[(Math.random() * this.edgeRoads.length) | 0];
        const path = World.roadPath(e[0], e[1], v.door.x, v.door.y);
        if (path && path.length > 6) {
          this.tourists.push({
            path, prog: 0, phase: 'in', venue: v, stay: 20 + Math.random() * 25,
            seed: (Math.random() * 8) | 0, x: e[0] * T + 8, y: e[1] * T + 8, dirx: 1, diry: 0,
          });
        }
      }
    }
    for (const t of this.tourists) {
      if (t.phase === 'visit') { t.stay -= dt * MIN_PER_SEC; if (t.stay <= 0) { t.phase = 'out'; t.path = [...t.path].reverse(); t.prog = 0; } continue; }
      t.prog += 2.0 * dt;
      this.followPath(t, t.path, t.prog, 3.5);
      if (t.prog >= t.path.length - 1) {
        if (t.phase === 'in') { t.phase = 'visit'; t.venue.visitors++; }
        else t.done = true;
      }
    }
    this.tourists = this.tourists.filter(t => !t.done);
  },

  /* ---------------- fireworks ---------------- */
  fireworkVenues() {
    const always = World.buildings.filter(b => b.type === 'amusement' && b.connected);
    if (Weather.season === 1 && Sim.day % 7 === 0)
      return always.concat(World.buildings.filter(b => (b.type === 'stadium' || b.type === 'park') && b.connected));
    return always;
  },
  /* on festival nights the WHOLE town becomes a launch pad */
  festiveLaunchSites() {
    if (this._festDay !== Sim.day || !this._festSites) {
      this._festDay = Sim.day;
      const all = World.buildings.filter(b => !b.ruined && !b.construction && b.connected);
      const picks = [];
      for (let i = 0; i < 14 && all.length; i++) picks.push(all[(Math.random() * all.length) | 0]);
      this._festSites = picks;
    }
    return this._festSites;
  },
  tickFireworks(dt) {
    const festive = typeof Festivals !== 'undefined' && Festivals.fireworksNight();
    const show = (Sim.clock >= 21 * 60 && Sim.clock <= 22.5 * 60) ||
                 (festive && (Sim.clock >= 19.5 * 60 || Sim.clock < 40));
    const cap = festive ? 420 : 120; // festival skies are LOUD
    if (show && this.rockets.length + this.sparks.length < cap) {
      const sites = festive ? this.fireworkVenues().concat(this.festiveLaunchSites()) : this.fireworkVenues();
      for (const v of sites) {
        if (Math.random() < dt * (festive ? 0.4 : 0.5)) {
          this.rockets.push({
            x: v.x * T + Math.random() * v.w * T, y: v.y * T,
            vy: -(46 + Math.random() * 22), t: 0.9 + Math.random() * 0.5,
            hue: ['#ff6060', '#ffd160', '#60c0ff', '#80ff90', '#ff90e0', '#c0a0ff'][(Math.random() * 6) | 0],
          });
          if (typeof Snd !== 'undefined') Snd.launch();
        }
      }
    }
    for (const r of this.rockets) {
      r.y += r.vy * dt; r.t -= dt;
      if (r.t <= 0) {
        const n = 22 + (Math.random() * 10 | 0);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * 6.283, sp = 26 + Math.random() * 30;
          this.sparks.push({ x: r.x, y: r.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1.1, hue: r.hue });
        }
        if (typeof Snd !== 'undefined') Snd.pop();
        r.dead = true;
      }
    }
    this.rockets = this.rockets.filter(r => !r.dead);
    for (const s of this.sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 26 * dt; s.life -= dt * 0.85; }
    this.sparks = this.sparks.filter(s => s.life > 0);
  },

  /* ---------------- hikers ---------------- */
  tickHikers(dt) {
    const cap = Math.min(5, World.mountains.length * 2);
    if (World.mountains.length && this.hikers.length < cap && Math.random() < dt * 0.03) {
      const m = World.mountains[(Math.random() * World.mountains.length) | 0];
      const spr = SPR.mountains[(m.v || 0) % SPR.mountains.length];
      const peak = spr.peaks.reduce((a, b) => (a[1] < b[1] ? a : b));
      const bx = m.x * T + 8 + Math.random() * (MSIZE * T - 16);
      const by = (m.y + MSIZE) * T - 3;
      const px = m.x * T + peak[0], py = m.y * T - spr.oy + peak[1] + 4;
      const up = [[bx, by]];
      const steps = 5;
      for (let i = 1; i <= steps; i++) {
        const f = i / steps;
        up.push([
          bx + (px - bx) * f + (i < steps ? (Math.random() * 26 - 13) : 0),
          by + (py - by) * f,
        ]);
      }
      const route = up.concat(up.slice(0, -1).reverse());
      this.hikers.push({ route, topIdx: steps, idx: 0, f: 0, pause: 0, paused: false, seed: (Math.random() * 1e6) | 0, x: bx, y: by });
    }
    for (const h of this.hikers) {
      if (h.pause > 0) { h.pause -= dt; continue; }
      const a = h.route[h.idx], b = h.route[h.idx + 1];
      if (!b) { h.done = true; continue; }
      const dist = Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1]));
      h.f += dt * 8.5 / dist;
      if (h.f >= 1) {
        h.f = 0; h.idx++;
        if (h.idx === h.topIdx && !h.paused) { h.pause = 14 + Math.random() * 16; h.paused = true; } // admire the view
      }
      const na = h.route[h.idx], nb = h.route[h.idx + 1] || na;
      h.x = na[0] + (nb[0] - na[0]) * h.f;
      h.y = na[1] + (nb[1] - na[1]) * h.f;
    }
    this.hikers = this.hikers.filter(h => !h.done);
  },

  /* ---------------- birds ---------------- */
  tickBirds(dt) {
    const day = Sim.clock > 330 && Sim.clock < 1180;
    if (day && this.birds.length < 12 && Math.random() < dt * 0.045) {
      const ltr = Math.random() < 0.5;
      const y = Math.random() * GH * T;
      const n = 3 + (Math.random() * 4 | 0);
      for (let i = 0; i < n; i++)
        this.birds.push({
          x: ltr ? -30 - i * 14 : GW * T + 30 + i * 14,
          y: y + (Math.random() * 30 - 15),
          vx: (ltr ? 1 : -1) * (30 + Math.random() * 14),
          ph: Math.random() * 7,
        });
    }
    for (const b of this.birds) { b.x += b.vx * dt; b.ph += dt * 9; }
    this.birds = this.birds.filter(b => b.x > -90 && b.x < GW * T + 90);
  },

  /* ---------------- crime & justice ---------------- */
  unemployedCount() { return Sim.people.filter(p => p.kind !== 'kid' && !p.work).length; },

  tickCrime(dtSim) {
    const gm = dtSim * MIN_PER_SEC; // game-minutes elapsed
    if (this.cooldown > 0) this.cooldown -= gm;
    const night = Sim.clock >= 1290 || Sim.clock < 270;

    if (!this.crime && night && this.cooldown <= 0 && Sim.people.length >= 4) {
      const chance = (0.10 + this.unemployedCount() * 0.06) * (gm / 60); // per game-hour
      if (Math.random() < chance) this.startCrime();
    }

    const c = this.crime;
    if (c) {
      const B = c.burglar;
      if (B.phase === 'approach' || B.phase === 'flee') {
        B.prog += 1.7 * dtSim;
        this.followPath(B, B.path, B.prog, 4.5);
        if (B.prog >= B.path.length - 1) {
          if (B.phase === 'approach') {
            B.phase = 'rob'; c.robT = 26;
            c.target.alarm = true;
            this.say(`🚨 Break-in at the ${CAT[c.target.type].name}!`);
            this.crimeN = (this.crimeN || 0) + 1;
            c.taskId = 'burglary' + this.crimeN;
            if (typeof Tasks !== 'undefined') Tasks.add(c.taskId, '🚨', `Catch the burglar at the ${CAT[c.target.type].name}`);
            this.dispatchPolice(c);
          } else this.resolve(false); // reached the edge of town with the loot
        }
      } else if (B.phase === 'rob') {
        c.robT -= gm;
        if (c.robT <= 0) {
          c.target.alarm = false;
          B.phase = 'flee'; B.prog = 0;
          B.path = this.escapePath(c.target);
          if (!B.path) this.resolve(false);
        }
      }
    }

    // police movement
    for (const u of this.police) {
      if (u.phase === 'scene') { // parked at the incident, lights flashing
        u.wait -= gm;
        if (u.wait <= 0) { u.phase = 'return'; u.path = [...u.path].reverse(); u.prog = 0; }
        continue;
      }
      u.prog += 3.2 * dtSim;
      this.followPath(u, u.path, u.prog, 3.5);
      if (u.prog >= u.path.length - 1) {
        if (u.phase === 'go') {
          // arrived at the scene
          const cc = u.patrol ? null : this.crime;
          if (cc && (cc.burglar.phase === 'rob' ||
                     (cc.burglar.phase === 'flee' && this.tileDist(u, cc.burglar) < 9))) {
            const court = World.buildings.some(b => b.type === 'courthouse' && b.connected);
            if (Math.random() < (court ? 0.95 : 0.8)) { this.resolve(true, u); }
            else { this.say('💨 The burglar slipped away in the chaos!'); this.resolve(false, null, true); }
          } else if (cc) { /* too late — burglar still fleeing; wait it out */ }
          if (u.scene) u.scene.arrived = true;
          if (u.patrol) { // hold the scene instead of an instant U-turn
            u.phase = 'scene';
            if (u.wait === undefined) u.wait = 6;
            continue;
          }
          u.phase = 'return';
          u.path = [...u.path].reverse(); u.prog = 0;
        } else u.done = true;
      }
    }
    this.police = this.police.filter(u => !u.done);
  },

  startCrime() {
    const weights = { bank: 5, mall: 3, market: 2.5, shop: 2, restaurant: 1.5, hotel: 1.5, house: 1, cottage: 1 };
    const targets = World.buildings.filter(b => weights[b.type] && b.connected);
    if (!targets.length) return;
    let sum = 0; for (const t of targets) sum += weights[t.type];
    let r = Math.random() * sum, target = targets[0];
    for (const t of targets) { r -= weights[t.type]; if (r <= 0) { target = t; break; } }
    // burglar sneaks in from a distant road tile
    const roads = [];
    for (let i = 0; i < World.roadMap.length; i++)
      if (World.roadMap[i]) roads.push([i % GW, (i / GW) | 0]);
    if (roads.length < 8) return;
    let spawn = null, bd = -1;
    for (let tries = 0; tries < 14; tries++) {
      const rt = roads[(Math.random() * roads.length) | 0];
      const d = Math.abs(rt[0] - target.door.x) + Math.abs(rt[1] - target.door.y);
      if (d > bd) { bd = d; spawn = rt; }
    }
    const path = World.roadPath(spawn[0], spawn[1], target.door.x, target.door.y);
    if (!path || path.length < 4) return;
    this.crime = {
      target,
      burglar: { phase: 'approach', path, prog: 0, x: spawn[0] * T + 8, y: spawn[1] * T + 8, seed: (Math.random() * 1e6) | 0 },
    };
  },

  escapePath(from) {
    const roads = [];
    for (let i = 0; i < World.roadMap.length; i++)
      if (World.roadMap[i]) roads.push([i % GW, (i / GW) | 0]);
    let best = null, bd = -1;
    for (let tries = 0; tries < 12; tries++) {
      const rt = roads[(Math.random() * roads.length) | 0];
      const d = Math.abs(rt[0] - from.door.x) + Math.abs(rt[1] - from.door.y);
      if (d > bd) { bd = d; best = rt; }
    }
    return best ? World.roadPath(from.door.x, from.door.y, best[0], best[1]) : null;
  },

  dispatchPolice(c) {
    const stations = World.buildings.filter(b => b.type === 'police' && b.connected);
    let best = null, bp = null;
    for (const s of stations) {
      const p = World.roadPath(s.door.x, s.door.y, c.target.door.x, c.target.door.y);
      if (p && (!bp || p.length < bp.length)) { best = s; bp = p; }
    }
    if (!best) { this.say('😰 No police in town — nobody answers the alarm…'); return; }
    this.police.push({ path: bp, prog: 0, x: best.door.x * T + 8, y: best.door.y * T + 8, dirx: 1, diry: 0, phase: 'go', station: best });
    this.say('🚔 Police dispatched!');
    if (typeof Snd !== 'undefined') Snd.siren();
  },

  resolve(arrested, unit, vanished) {
    const c = this.crime;
    if (!c) return;
    c.target.alarm = false;
    if (c.taskId && typeof Tasks !== 'undefined')
      Tasks.done(c.taskId, arrested, arrested ? 'Burglar arrested' : `The burglar got away from the ${CAT[c.target.type].name}`);
    if (arrested) {
      this.arrests++;
      Sim.safety = Math.min(100, Sim.safety + 3);
      const court = World.buildings.some(b => b.type === 'courthouse' && b.connected);
      this.say(court ? '⚖️ Burglar arrested and convicted — justice served!' : '🚔 Burglar arrested!');
      if (unit && unit.station) unit.station.visitors++;
    } else if (!vanished) {
      this.crimes++;
      Sim.safety = Math.max(20, Sim.safety - 9);
      this.say(`💰 The burglar got away with the loot from the ${CAT[c.target.type].name}…`);
    } else {
      this.crimes++;
      Sim.safety = Math.max(20, Sim.safety - 5);
    }
    this.crime = null;
    this.cooldown = 380 + Math.random() * 400;
  },

  /* is any train within r tiles of this spot? (level-crossing gates ask)
     A train dwelling at a station platform doesn't keep distant gates
     down for the whole stop — only one actually ON the crossing does. */
  trainNearTile(x, y, r) {
    for (const tr of this.trains) {
      const d = Math.abs(tr.x / T - x) + Math.abs(tr.y / T - y);
      if (d >= r) continue;
      if (tr.pause > 3 && d > 2.5) continue;
      return true;
    }
    return false;
  },

  /* shared path-follower (tile paths → px position with lane offset) */
  followPath(o, path, prog, off) {
    const i = Math.min(Math.floor(prog), path.length - 1);
    const f = Math.min(1, prog - i);
    const [ax, ay] = path[i], [bx, by] = path[Math.min(i + 1, path.length - 1)];
    const dx = bx - ax, dy = by - ay;
    o.x = (ax + dx * f) * T + 8 + (dy !== 0 ? (dy > 0 ? -off : off) : 0);
    o.y = (ay + dy * f) * T + 8 + (dx !== 0 ? (dx > 0 ? off : -off) : 0);
    if (dx || dy) { o.dirx = dx; o.diry = dy; }
  },

  tileDist(a, b) { return (Math.abs(a.x - b.x) + Math.abs(a.y - b.y)) / T; },
};
