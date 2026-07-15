/* ============================================================
   PixelVille — citizens, jobs, daily schedules, movement.
   People live in residential buildings, get jobs at workplaces,
   commute, shop, go to school, and enjoy evenings out.
   Time: game-minutes 0..1440. Day 0 mod 7 = Sunday.
   ============================================================ */
'use strict';

const SURNAMES = ['Miller', 'Tanaka', 'Okafor', 'Silva', 'Novak', 'Haddad', 'Kim', 'Rossi', 'Iyer', 'Berg',
  'Diaz', 'Chen', 'Dubois', 'Moreau', 'Papas', 'Singh', 'Owens', 'Weber', 'Costa', 'Ali',
  'Nakamura', 'Farrell', 'Osei', 'Petrov', 'Lund', 'Garcia', 'Yilmaz', 'Kowalski'];

// Kept deliberately gentle: the game clock moves much faster than a person
// should look as if they do on screen.  Fast-forward still speeds them up.
const WALK_SPEED = 0.62; // tiles per real second (scaled by sim speed)
const CAR_SPEED = 2.0;
const CAR_MIN_DIST = 14; // trips longer than this use the family car

/* ---------------- economy tables ---------------- */
const WAGES = { office: 22, skyscraper: 28, factory: 18, farm: 12, shop: 13, market: 14, mall: 16, restaurant: 14, cafe: 12, bakery: 12, hotel: 15, bank: 24, gas: 12, school: 18, college: 20, hospital: 22, police: 19, fire: 19, townhall: 20, courthouse: 22, temple: 10, library: 14, amusement: 15, stadium: 16, cinema: 14, theater: 14, museum: 15, gym: 13, pool: 12, airport: 20 };
const PRICES = { shop: 5, market: 7, mall: 10, bakery: 4, cafe: 5, restaurant: 12, cinema: 8, theater: 9, museum: 6, amusement: 13, stadium: 10, gym: 5, pool: 4, hotel: 15, library: 0, temple: 0, park: 0, playground: 0 };

/* A resident is more than a worker slot.  These profiles drive savings,
   ambitions, and the occasional risky choice without making crime common. */
const ADULT_LIFESTYLES = [
  { id: 'worker', weight: 62, aspiration: 'career', saveRate: 0.22, funding: 'wages' },
  { id: 'shopkeeper', weight: 12, aspiration: 'business', saveRate: 0.46, funding: 'wages', kinds: ['shop', 'bakery', 'cafe'] },
  { id: 'entrepreneur', weight: 11, aspiration: 'business', saveRate: 0.5, funding: 'wages', kinds: ['shop', 'cafe', 'bakery', 'market'] },
  { id: 'neighbor', weight: 10, aspiration: 'community', saveRate: 0.26, funding: 'wages' },
  { id: 'risk-taker', weight: 5, aspiration: 'business', saveRate: 0.38, funding: 'risk', kinds: ['shop', 'cafe', 'market'] },
];
const STARTUP_COSTS = { shop: 210, cafe: 230, bakery: 220, market: 320 };

function chooseLifestyle() {
  let roll = Math.random() * ADULT_LIFESTYLES.reduce((n, s) => n + s.weight, 0);
  for (const style of ADULT_LIFESTYLES) {
    roll -= style.weight;
    if (roll <= 0) return style;
  }
  return ADULT_LIFESTYLES[0];
}

/* thought bubble shown when someone sets off */
const DEST_EMOJI = {
  shop: '🛍️', market: '🛒', bakery: '🥐', cafe: '☕', restaurant: '🍽️', mall: '🛍️',
  cinema: '🎬', theater: '🎭', park: '🌳', playground: '⚽', stadium: '⚽', amusement: '🎡',
  library: '📚', gym: '🏋️', pool: '🏊', museum: '🖼️', temple: '⛪',
  school: '🎒', college: '🎓',
};

const Sim = {
  people: [],
  clock: 7 * 60,       // start 07:00
  day: 1,
  nextPid: 1,
  safety: 92,          // town safety 0-100 (crime lowers it, arrests & time heal it)
  grandOpening: null,  // {b, day} — freshly opened venue that draws a crowd

  growthT: 0, nextGrowthDay: 0, nextEnterpriseDay: 0,

  reset() {
    this.people = []; this.clock = 7 * 60; this.day = 1; this.nextPid = 1;
    this.safety = 92; this.grandOpening = null; this.completed = [];
    this.growthT = 0; this.nextGrowthDay = 0; this.nextEnterpriseDay = 0;
  },

  hour() { return Math.floor(this.clock / 60); },
  isWeekend() { return this.day % 7 === 0; },
  timeStr() {
    const h = Math.floor(this.clock / 60), m = Math.floor(this.clock % 60);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  },

  /* ---------- building lifecycle ---------- */
  onBuildingAdded(b) {
    const d = CAT[b.type];
    const msgs = [];
    if (b.ruined) return msgs;
    if (d.res === 'family') {
      const fam = this.spawnFamily(b);
      b.funds = 40 + Math.random() * 80;
      if (d.cars) b.cars.push({ free: true, seed: (Math.random() * 8) | 0 });
      msgs.push(`The ${fam.surname} family moved in — ${fam.n} resident${fam.n > 1 ? 's' : ''} 🏠`);
    } else if (d.res === 'block') {
      let total = 0;
      const famCount = 4;
      for (let i = 0; i < famCount; i++) total += this.spawnFamily(b).n;
      for (let i = 0; i < (d.cars || 0); i++) b.cars.push({ free: true, seed: (Math.random() * 8) | 0 });
      msgs.push(`${total} new residents moved into the apartments 🏢`);
    }
    if (d.jobs) {
      msgs.push(`${d.name} opened — ${d.jobs} jobs 💼`);
      // a founder runs their own place
      if (b.founderId) {
        const f = this.people.find(p => p.id === b.founderId);
        if (f) {
          if (f.work) f.work.workers = f.work.workers.filter(w => w !== f);
          f.work = b; b.workers.push(f);
          msgs.push(`💼 ${f.surname} quit the day job to run the family business!`);
        }
      }
      this.assignJobs();
    }
    if (d.school || d.college) this.assignSchools();
    if (d.visit && b.connected) {
      this.grandOpening = { b, day: this.day };
      msgs.push(`🎉 Grand opening at the ${d.name} — the whole town is talking!`);
    }
    if (!b.connected) msgs.push(`⚠️ ${d.name} couldn't reach the road network`);
    // everyone re-plans their day around the new building
    let replanned = 0;
    for (const p of this.people) if (p.state === 'in' && p.at === p.home) { this.planDay(p); replanned++; }
    if (replanned > 2 && (d.visit || d.jobs || d.school || d.college))
      msgs.push(`🔁 ${replanned} villagers replanned their day`);
    return msgs;
  },

  onBuildingRemoved(b) {
    // residents vanish, workers/students lose their assignment
    this.people = this.people.filter(p => p.home !== b);
    for (const p of this.people) {
      if (p.work === b) p.work = null;
      if (p.school === b) p.school = null;
      if (p.dest === b || p.at === b) { // stranded mid-trip or inside: send home instantly
        p.state = 'in'; p.at = p.home; p.trip = null; p.events = [];
        this.planDay(p);
      }
    }
    this.assignJobs();
  },

  spawnFamily(b) {
    const surname = SURNAMES[(Math.random() * SURNAMES.length) | 0];
    const mk = (kind) => {
      const style = kind === 'kid' ? null : chooseLifestyle();
      const businessKinds = style && style.kinds;
      const p = {
        id: this.nextPid++, kind, surname, seed: (Math.random() * 1e6) | 0,
        home: b, work: null, school: null,
        state: 'in', at: b, dest: null, trip: null, events: [],
        trait: style && style.aspiration === 'business' ? 'entrepreneur' : 'worker',
        lifestyle: style ? style.id : 'student',
        aspiration: style ? style.aspiration : 'learn',
        fundingPlan: style ? style.funding : 'none',
        savingsRate: style ? style.saveRate : 0,
        businessKind: businessKinds ? businessKinds[(Math.random() * businessKinds.length) | 0] : null,
        savings: kind === 'kid' ? 0 : 8 + Math.random() * 22,
        heldUntil: 0, lastIllegalDay: -99,
        mood: 58 + Math.random() * 22, // 0-100: feelings drive votes, riots & outings
        x: 0, y: 0,
      };
      b.residents.push(p); this.people.push(p);
      return p;
    };
    let n = 0;
    mk('man'); n++;
    mk('woman'); n++;
    if (Math.random() < 0.55) { mk('kid'); n++; }
    this.assignJobs(); this.assignSchools();
    for (const p of b.residents) this.planDay(p);
    return { surname, n };
  },

  /* ---------- assignments ---------- */
  workplaces() { return World.buildings.filter(b => (CAT[b.type].jobs || 0) > 0 && b.connected && !b.construction && !b.ruined); },

  assignJobs() {
    const seekers = this.people.filter(p => p.kind !== 'kid' && !p.work && p.home.connected);
    for (const p of seekers) {
      let best = null, bd = 1e9;
      for (const w of this.workplaces()) {
        if (w.workers.length >= w.jobs) continue;
        const d = Math.abs(w.x - p.home.x) + Math.abs(w.y - p.home.y);
        if (d < bd) { bd = d; best = w; }
      }
      if (best) { p.work = best; best.workers.push(p); }
    }
  },

  assignSchools() {
    const schools = World.buildings.filter(b => CAT[b.type].school && b.connected && !b.construction && !b.ruined);
    for (const p of this.people) {
      if (p.kind !== 'kid' || p.school) continue;
      let best = null, bd = 1e9;
      for (const s of schools) {
        const d = Math.abs(s.x - p.home.x) + Math.abs(s.y - p.home.y);
        if (d < bd) { bd = d; best = s; }
      }
      p.school = best;
    }
  },

  /* ---------- daily planning ----------
     Builds today's event list for one person: {t, dest, until} */
  planDay(p) {
    p.events = [];
    const wkend = this.isWeekend();
    const jit = () => (Math.random() * 40 - 20) | 0;
    const add = (t, dest, until) => {
      if (dest && dest.connected) p.events.push({ t: Math.max(5, t), dest, until: Math.min(1435, until) });
    };

    if (p.kind === 'kid') {
      if (!wkend && p.school) {
        add(470 + jit() / 2, p.school, 900 + jit() / 2);
        if (Math.random() < 0.4) {
          const play = this.pickVenue('leisure', p, ['playground', 'park']);
          add(930, play, 1020);
        }
      } else if (Math.random() < 0.6) {
        add(600 + jit(), this.pickVenue('leisure', p, ['playground', 'park', 'pool', 'amusement']), 780 + jit());
      }
    } else {
      const wd = p.work ? CAT[p.work.type] : null;
      const worksToday = p.work && (!wkend || wd.wkd);
      if (worksToday) {
        add(wd.hours.s - 40 + jit(), p.work, wd.hours.e + jit());
        // lunch break at a nearby café or restaurant
        const food = World.buildings.filter(v =>
          ['cafe', 'restaurant', 'bakery'].includes(v.type) && v.connected && !v.construction &&
          Math.abs(v.x - p.work.x) + Math.abs(v.y - p.work.y) < 26);
        if (food.length && Math.random() < 0.45 && wd.hours.s < 700) {
          const lt = wd.hours.s + 230 + jit();
          p.events.push({ t: lt, dest: food[(Math.random() * food.length) | 0], until: lt + 40, back: 'work' });
        }
      } else {
        // college for the jobless on weekdays
        const college = World.buildings.find(b => CAT[b.type].college && b.connected);
        if (!wkend && college && Math.random() < 0.65) add(530 + jit(), college, 900 + jit());
      }
      // errand: someone from the house goes shopping
      if (Math.random() < (worksToday ? 0.25 : 0.7)) {
        const shopT = worksToday ? 1120 + jit() : 560 + Math.random() * 500;
        add(shopT, this.pickVenue('shop', p), shopT + 30 + Math.random() * 35);
      }
      // evening out — weather, season and feelings set the mood
      let outP = wkend ? 0.75 : 0.45;
      if (typeof Weather !== 'undefined') {
        if (Weather.isRaining() || Weather.isSnowing()) outP *= 0.5;
        if (Weather.season === 1) outP *= 1.2;   // summer nights
        if (Weather.season === 3) outP *= 0.75;  // winter cocooning
      }
      if ((p.mood === undefined ? 60 : p.mood) < 45) outP *= 1.3; // gloomy people go looking for cheer
      if (Math.random() < outP) {
        const t = 1110 + Math.random() * 120;
        add(t, this.pickVenue('leisure', p), t + 55 + Math.random() * 50);
      }
      // a stroll around the block (often with the dog)
      if (Math.random() < 0.4) {
        const t = 500 + Math.random() * 620;
        p.events.push({ t, stroll: true, until: t + 60 });
      }
    }
    p.events.sort((a, b) => a.t - b.t);
    // drop overlaps (lunch breaks are nested inside the work day, keep them)
    let end = -1;
    p.events = p.events.filter(e => {
      if (e.back) return true;
      if (e.t < end) return false;
      end = e.until + 30; return true;
    });
  },

  pickVenue(kind, p, preferTypes) {
    // a freshly opened venue draws the crowds all day
    const go = this.grandOpening;
    if (go && go.day === this.day && CAT[go.b.type].visit === kind &&
        go.b.connected && Math.random() < 0.5 && World.buildings.includes(go.b))
      return go.b;
    let opts = World.buildings.filter(b => CAT[b.type].visit === kind && b.connected && !b.construction && !b.ruined && b !== p.home);
    if (!preferTypes && kind === 'leisure' && p.home.funds < 30) preferTypes = ['park', 'playground', 'library', 'temple']; // broke week: free fun
    if (preferTypes) {
      const pref = opts.filter(b => preferTypes.includes(b.type));
      if (pref.length) opts = pref;
    }
    if (!opts.length) return null;
    // weight closer venues higher
    opts.sort((a, b) =>
      (Math.abs(a.x - p.home.x) + Math.abs(a.y - p.home.y)) - (Math.abs(b.x - p.home.x) + Math.abs(b.y - p.home.y)));
    const i = Math.min(opts.length - 1, Math.floor(Math.abs(Math.random() + Math.random() - 1) * opts.length));
    return opts[i];
  },

  /* ---------- tick ---------- */
  tick(dtSim) { // dtSim = real seconds * speed multiplier
    this.clock += dtSim * MIN_PER_SEC;
    if (this.clock >= 1440) {
      this.clock -= 1440;
      this.day++;
      this.safety = Math.min(100, this.safety + 1.5); // town heals over time
      for (const b of World.buildings) { b.visitors = 0; b.inside = Math.max(0, Math.min(b.inside, 3)); }
      for (const p of this.people) if (p.state === 'in' && p.at === p.home) this.planDay(p);
      this.dailyEconomy();
      // Government decisions happen after families have earned, saved, and
      // made their own plans for the day.
      if (typeof Gov !== 'undefined') Gov.dayTick();
    }
    // construction sites make progress
    const gm = dtSim * MIN_PER_SEC;
    for (const b of World.buildings) {
      if (b.construction > 0) { b.construction -= gm; if (b.construction <= 0) { b.construction = 0; this.completed.push(b); World.dirty = true; } }
      if (b.upgrading > 0) {
        b.upgrading -= gm;
        if (b.upgrading <= 0) {
          b.upgrading = 0; b.level = Math.min(3, b.level + 1); World.dirty = true;
          if (typeof Life !== 'undefined') Life.say(`🏠 The ${b.residents[0] ? b.residents[0].surname : ''} home got an extra floor! (level ${b.level})`);
        }
      }
    }
    // Demand is reviewed during idle play, but development is intentionally
    // patient so a city grows in visible, steady steps rather than exploding.
    this.growthT = (this.growthT || 0) + gm;
    if (this.growthT > 180) { this.growthT = 0; this.checkGrowth(); }
    for (const p of this.people) this.tickPerson(p, dtSim);
  },
  completed: [],

  /* ---------- feelings: a light daily mood model ----------
     Mood follows real circumstances — work, savings, safety, home, fun —
     and in turn drives votes, protests, and how people spend their evenings. */
  updateMoods() {
    for (const p of this.people) {
      if (p.mood === undefined) p.mood = 60;
      let target = 50;
      target += p.work ? 12 : (p.kind === 'kid' ? 6 : -12);
      target += Math.max(-8, Math.min(12, (p.home.funds - 30) / 12));
      target += (this.safety - 70) * 0.18;
      if (p.home.ruined || p.home.fire) target -= 28;
      if (p.heldUntil > this.day) target -= 22; // in trouble with the law
      if (p.ownsBusiness) target += 8;          // pride of ownership
      if (p.funDay === this.day - 1) target += 7; // yesterday's outing still glows
      if (typeof Weather !== 'undefined' && Weather.kind === 'clear') target += 3;
      p.mood = Math.max(5, Math.min(98, p.mood + (target - p.mood) * 0.3 + (Math.random() - 0.5) * 6));
    }
  },

  /* ---------- household economy: upgrades, cars, rentals, luck ---------- */
  dailyEconomy() {
    this.updateMoods();
    for (const b of World.buildings) {
      if (b.ruined || b.construction) continue;
      const d = CAT[b.type];
      if (d.res === 'block') { b.funds = Math.max(0, b.funds - 8); continue; } // apartment rent to the void
      if (d.res !== 'family' || !b.residents.length) continue;
      // rent flows to the landlord
      if (b.ownerId) {
        const owner = World.buildings.find(o => o.id === b.ownerId);
        if (owner && owner.residents.length && b.funds > 4) { b.funds -= 4; owner.funds += 4; }
      }
      const say = m => { if (typeof Life !== 'undefined') Life.say(m); };
      const name = b.residents[0].surname;
      if (Math.random() < 0.002) { b.funds += 600; say(`🎉 The ${name}s won the lottery! (+$600)`); }
      // home improvements
      if (b.type === 'house' && !b.upgrading) {
        if (b.level === 1 && b.funds >= 250) { b.funds -= 180; b.upgrading = 240; say(`🔨 The ${name}s are adding a floor to their house`); }
        else if (b.level === 2 && b.funds >= 600) { b.funds -= 420; b.upgrading = 300; say(`🔨 The ${name}s are turning their home into a villa`); }
      }
      // a second car
      const adults = b.residents.filter(r => r.kind !== 'kid').length;
      if (b.cars.length < Math.min(2, adults) && b.funds >= 350) {
        b.funds -= 250;
        b.cars.push({ free: true, seed: (Math.random() * 8) | 0 });
        say(`🚗 The ${name}s bought a new car`);
      }
      // property investment: build a rental home
      if (b.level >= 2 && b.funds >= 900 && this.day >= (b.nextInvestmentDay || 0) && Math.random() < 0.1) {
        const spot = World.findBuildSpot('house');
        if (spot) {
          b.funds -= 600;
          const nb = World.placeBuilding('house', spot.x, spot.y);
          if (nb) {
            nb.ownerId = b.id;
            b.nextInvestmentDay = this.day + 5 + ((Math.random() * 4) | 0);
            say(`🏗️ The ${name}s are building a rental home — landlords now!`);
            World.refreshConnections();
          }
        }
      }
    }
    this.advanceAmbitions();
  },

  /* ---------- personal ambitions and small business ---------- */
  startupCapital(p) {
    const personal = p.savings || 0;
    const reserve = CAT[p.home.type].res ? 45 : 0;
    // Families can back a venture, but retain an emergency reserve.
    return personal + Math.max(0, p.home.funds - reserve);
  },

  advanceAmbitions() {
    // Aspiring owners without a formal job can earn a little through legal odd
    // jobs while regular workers save a portion of their daily wage.
    for (const p of this.people) {
      if (p.kind === 'kid' || p.aspiration !== 'business' || p.ownsBusiness || p.heldUntil > this.day) continue;
      if (!p.work && p.fundingPlan !== 'risk' && Math.random() < 0.65) {
        p.savings = (p.savings || 0) + 3 + Math.random() * 4;
        p.oddJobDays = (p.oddJobDays || 0) + 1;
      }
    }

    if (this.day < this.nextEnterpriseDay) return;
    const founders = this.people
      .filter(p => p.kind !== 'kid' && p.aspiration === 'business' && !p.ownsBusiness &&
        p.businessKind && p.home.connected && p.heldUntil <= this.day)
      .sort((a, b) => {
        const ar = this.startupCapital(a) / (STARTUP_COSTS[a.businessKind] || 300);
        const br = this.startupCapital(b) / (STARTUP_COSTS[b.businessKind] || 300);
        return br - ar;
      });
    if (!founders.length) return;

    const founder = founders[0];
    const kind = founder.businessKind;
    const cost = STARTUP_COSTS[kind] || 300;
    if (this.startupCapital(founder) < cost) {
      // This is limited to the small risk-taking group, has a long cooldown,
      // and carries a meaningful arrest/hold consequence.
      if (founder.fundingPlan === 'risk') this.tryPettyTheft(founder);
      this.nextEnterpriseDay = this.day + 1 + ((Math.random() * 2) | 0);
      return;
    }

    const spot = World.findBuildSpot(kind); // founder buys a plot beside the road network
    if (!spot) { this.nextEnterpriseDay = this.day + 1; return; }
    const business = World.placeBuilding(kind, spot.x, spot.y);
    if (!business) { this.nextEnterpriseDay = this.day + 1; return; }

    const personalSpend = Math.min(founder.savings || 0, cost);
    founder.savings = Math.max(0, (founder.savings || 0) - personalSpend);
    const familySpend = cost - personalSpend;
    founder.home.funds = Math.max(0, founder.home.funds - familySpend);
    business.ownerId = founder.home.id;
    business.founderId = founder.id;
    founder.ownsBusiness = true;
    founder.fundingRoute = familySpend > 0 && personalSpend > 0 ? 'savings and family backing' :
      familySpend > 0 ? 'family savings' : 'personal savings';
    this.nextEnterpriseDay = this.day + 3 + ((Math.random() * 3) | 0);
    World.refreshConnections();
    if (typeof Life !== 'undefined') {
      const title = founder.kind === 'woman' ? 'Ms.' : 'Mr.';
      Life.say(`Business: ${title} ${founder.surname} bought a plot for a ${CAT[kind].name.toLowerCase()} with ${founder.fundingRoute}`);
    }
  },

  tryPettyTheft(p) {
    if (this.day - (p.lastIllegalDay === undefined ? -99 : p.lastIllegalDay) < 5 || Math.random() >= 0.12) return false;
    const targets = World.buildings.filter(b =>
      !b.ruined && !b.construction && b.connected && b !== p.home && b.ownerId !== p.home.id &&
      ['shop', 'market', 'bakery', 'cafe', 'restaurant', 'mall'].includes(b.type) && b.funds >= 18);
    if (!targets.length) return false;

    const target = targets[(Math.random() * targets.length) | 0];
    const amount = Math.min(30, Math.max(8, Math.round(8 + Math.random() * 22)), Math.floor(target.funds));
    target.funds = Math.max(0, target.funds - amount);
    p.savings = (p.savings || 0) + amount;
    p.lastIllegalDay = this.day;
    p.illicitIncome = (p.illicitIncome || 0) + amount;
    // the alarm rings and a patrol car visibly answers the call
    target.alarm = true; target.alarmT = 30;
    if (typeof Life !== 'undefined') Life.dispatchTo(target.door.x, target.door.y);
    const ownerHome = target.ownerId ? World.buildings.find(o => o.id === target.ownerId) : null;
    if (ownerHome) for (const r of ownerHome.residents) r.mood = Math.max(5, (r.mood === undefined ? 60 : r.mood) - 8);

    const policePresent = World.buildings.some(b => b.type === 'police' && b.connected && !b.construction && !b.ruined);
    const caught = Math.random() < (policePresent ? 0.7 : 0.24);
    if (caught) {
      const fine = Math.min(p.savings, 10 + Math.round(Math.random() * 15));
      p.savings -= fine;
      p.heldUntil = this.day + 3;
      this.safety = Math.max(20, this.safety - 1);
      if (typeof Life !== 'undefined') {
        Life.arrests++;
        Life.say(`${p.surname} was caught stealing from the ${CAT[target.type].name}; the business plan is on hold`);
      }
    } else {
      this.safety = Math.max(20, this.safety - 2);
      if (typeof Life !== 'undefined') {
        Life.crimes++;
        Life.say(`A petty theft at the ${CAT[target.type].name} shakes the neighborhood`);
      }
    }
    return true;
  },

  /* the town grows on its own when jobs outstrip housing */
  checkGrowth() {
    if (this.day < this.nextGrowthDay) return;
    const underCon = World.buildings.filter(b => b.construction > 0 && CAT[b.type].res).length;
    if (underCon >= 1) return;
    const s = this.stats();
    const vacant = World.buildings.filter(b => CAT[b.type].res && !b.construction && !b.ruined && b.residents.length === 0).length;
    const unfilled = s.jobs - s.employed;
    if (unfilled > 4 && vacant === 0 && Math.random() < 0.18) {
      const key = unfilled > 16 && this.people.length > 30 ? 'apartment' : 'house';
      const spot = World.findBuildSpot(key);
      if (spot) {
        World.placeBuilding(key, spot.x, spot.y);
        this.nextGrowthDay = this.day + 2 + ((Math.random() * 3) | 0);
        World.refreshConnections();
        if (typeof Life !== 'undefined')
          Life.say(key === 'apartment' ? '🏗️ Demand is booming — an apartment block is going up!' : '🏗️ New settlers are building a house — the town is growing!');
      }
    }
  },

  tickPerson(p, dt) {
    if (p.state === 'in') {
      // due to leave somewhere?
      if (p.at === p.home) {
        p.events = p.events.filter(e => e.until > this.clock); // drop expired
        const e = p.events.find(e => this.clock >= e.t && !e.back);
        if (e) {
          p.events.splice(p.events.indexOf(e), 1);
          if (e.stroll) this.startStroll(p);
          else this.startTrip(p, e.dest, e.until);
        }
      } else if (p.at === p.work && p.state === 'in') {
        // lunch break?
        const e = p.events.find(e => e.back === 'work' && this.clock >= e.t && this.clock < e.until);
        if (e) {
          p.events.splice(p.events.indexOf(e), 1);
          p.savedUntil = p.returnAt;
          this.startTrip(p, e.dest, e.until, p.work);
          return;
        }
        if (p.returnAt !== undefined && this.clock >= p.returnAt) this.startTrip(p, p.home, null);
      } else if (p.returnAt !== undefined && this.clock >= p.returnAt) {
        if (p.backTo) { const b = p.backTo; p.backTo = null; this.startTrip(p, b, p.savedUntil); }
        else this.startTrip(p, p.home, null);
      }
      return;
    }
    if (p.state === 'walk' && p.trip) {
      if (p.freezeT > 0) { p.freezeT -= dt * MIN_PER_SEC; return; } // stopped mid-street (dispute)
      // feelings show on faces in the street
      if (!p.trip.car && (!p.bubbleUntil || performance.now() > p.bubbleUntil) && Math.random() < dt * 0.05) {
        const m = p.mood === undefined ? 60 : p.mood;
        p.bubble = m >= 75 ? '😄' : m >= 52 ? '🙂' : m >= 36 ? '😕' : '😠';
        p.bubbleUntil = performance.now() + 1800;
      }
      const t = p.trip;
      const speed = t.car ? CAR_SPEED : WALK_SPEED;
      t.prog += speed * dt;
      if (t.prog >= t.path.length - 1) { // arrived
        const dest = p.dest;
        p.state = 'in'; p.at = dest; p.trip = null; p.dest = null;
        if (dest !== p.home) {
          p.carHeld = t.car || null; // keep the car parked at the venue for the return trip
          p.returnAt = p.until;
          dest.inside++;
          if (t.car) dest.parked++;
          const cd = CAT[dest.type];
          if (cd.visit) {
            dest.visitors++;
            if (cd.visit === 'leisure') { // fun genuinely lifts the spirit
              p.mood = Math.min(98, (p.mood === undefined ? 60 : p.mood) + 4);
              p.funDay = this.day;
            }
            const price = PRICES[dest.type] || 0; // money changes hands
            if (price && p.home.funds > price) {
              p.home.funds -= price;
              const owner = dest.ownerId ? World.buildings.find(o => o.id === dest.ownerId) : null;
              if (owner && owner.residents.length) { owner.funds += price * 0.7; dest.funds += price * 0.3; }
              else dest.funds += price;
            }
          }
          if (dest === p.work && p.paidDay !== this.day) { // payday
            p.paidDay = this.day;
            const wage = WAGES[dest.type] || 15;
            // Each adult keeps a small personal fund for their own ambitions;
            // the rest still supports the household.
            const personal = wage * (p.savingsRate === undefined ? 0.2 : p.savingsRate);
            p.savings = (p.savings || 0) + personal;
            p.home.funds += wage - personal;
          }
        } else {
          if (t.car) t.car.free = true;
          p.carHeld = null;
          p.returnAt = undefined;
        }
        return;
      }
      // interpolate position
      const i = Math.floor(t.prog), f = t.prog - i;
      const [ax, ay] = t.path[i], [bx, by] = t.path[Math.min(i + 1, t.path.length - 1)];
      const dirx = bx - ax, diry = by - ay;
      // lane offset: keep right of travel direction
      const off = t.car ? 3.5 : 5.5;
      p.x = (ax + (bx - ax) * f) * T + 8 + (diry !== 0 ? (diry > 0 ? -off : off) : 0);
      p.y = (ay + (by - ay) * f) * T + 8 + (dirx !== 0 ? (dirx > 0 ? off : -off) : 0);
      p.dirx = dirx; p.diry = diry;
    }
  },

  startTrip(p, dest, until, backTo) {
    if (!dest || !p.home.connected || !dest.connected || dest.construction || dest.ruined) { p.returnAt = undefined; return; }
    const path = World.roadPath(p.at.door.x, p.at.door.y, dest.door.x, dest.door.y);
    if (!path || path.length < 2) {
      // unreachable: if going out, skip; if going home, teleport
      if (dest === p.home) { p.state = 'in'; p.at = p.home; p.returnAt = undefined; }
      return;
    }
    if (p.at !== p.home && p.at !== dest) { // leaving a venue/workplace
      p.at.inside = Math.max(0, p.at.inside - 1);
      if (p.carHeld) p.at.parked = Math.max(0, p.at.parked - 1);
    }
    p.backTo = backTo || null;
    // family car for long trips (adults only); reuse the one parked at the venue.
    // In the rain, people reach for the car keys much sooner.
    const carMin = (typeof Weather !== 'undefined' && (Weather.isRaining() || Weather.isSnowing())) ? 8 : CAR_MIN_DIST;
    let car = p.carHeld || null;
    if (!car && p.kind !== 'kid' && path.length >= carMin) {
      car = p.home.cars.find(c => c.free) || null;
      if (car) car.free = false;
    }
    p.carHeld = null;
    p.state = 'walk';
    p.dest = dest;
    p.until = until;
    p.trip = { path, prog: 0, car };
    if (!car && p.kind !== 'kid' && Math.random() < 0.15) p.trip.dog = (Math.random() * 2) | 0; // walk the dog
    if (dest !== p.home && DEST_EMOJI[dest.type]) {
      p.bubble = DEST_EMOJI[dest.type];
      p.bubbleUntil = performance.now() + 2600;
    }
    const [sx, sy] = path[0];
    p.x = sx * T + 8; p.y = sy * T + 8;
  },

  /* a wander to a nearby corner and back — pure flânerie */
  startStroll(p) {
    if (!p.home.connected) return;
    const roads = [];
    for (let dy = -9; dy <= 9; dy++) for (let dx = -9; dx <= 9; dx++) {
      const x = p.home.door.x + dx, y = p.home.door.y + dy;
      if (Math.abs(dx) + Math.abs(dy) >= 5 && World.isRoad(x, y)) roads.push([x, y]);
    }
    if (!roads.length) return;
    const [tx, ty] = roads[(Math.random() * roads.length) | 0];
    const out = World.roadPath(p.at.door.x, p.at.door.y, tx, ty);
    if (!out || out.length < 3) return;
    p.state = 'walk';
    p.dest = p.home;
    p.until = null;
    p.trip = { path: out.concat([...out].reverse().slice(1)), prog: 0, car: null };
    if (Math.random() < 0.45) p.trip.dog = (Math.random() * 2) | 0;
    p.bubble = p.trip.dog !== undefined ? '🐕' : '🚶';
    p.bubbleUntil = performance.now() + 2600;
    const [sx, sy] = p.trip.path[0];
    p.x = sx * T + 8; p.y = sy * T + 8;
  },

  /* ---------- stats ---------- */
  stats() {
    const pop = this.people.length;
    const adults = this.people.filter(p => p.kind !== 'kid');
    const employed = adults.filter(p => p.work).length;
    const active = b => b.connected && !b.construction && !b.ruined;
    const jobs = World.buildings.reduce((s, b) => s + (active(b) ? (CAT[b.type].jobs || 0) : 0), 0);
    const leisureN = World.buildings.filter(b => CAT[b.type].visit === 'leisure' && active(b)).length;
    const shopN = World.buildings.filter(b => CAT[b.type].visit === 'shop' && active(b)).length;
    const wealth = Math.round(World.buildings.reduce((s, b) => s + (CAT[b.type].res ? b.funds : 0), 0));
    const vacant = World.buildings.filter(b => CAT[b.type].res && active(b) && b.residents.length === 0).length;
    const unfilled = Math.max(0, jobs - employed);
    const clamp01 = v => Math.max(0, Math.min(1, v));
    const demand = {
      r: clamp01((unfilled - vacant * 3) / 12),
      c: clamp01((pop / 12 - shopN) / 4),
      i: clamp01((adults.length - employed) / 6),
    };
    let hap = 50;
    if (adults.length) {
      const base =
        45 * (employed / adults.length) +
        20 * Math.min(1, leisureN / Math.max(1, pop / 14)) +
        15 * Math.min(1, shopN / Math.max(1, pop / 18)) +
        20 * (this.safety / 100);
      const avgMood = this.people.reduce((s2, p) => s2 + (p.mood === undefined ? 60 : p.mood), 0) / this.people.length;
      hap = Math.round(base * 0.6 + avgMood * 0.4); // the town is as happy as its people feel
    }
    return { pop, employed, adults: adults.length, jobs, happiness: pop ? hap : 100, safety: Math.round(this.safety), wealth, demand, vacant };
  },

  travelers() { return this.people.filter(p => p.state === 'walk' && p.trip); },
};
