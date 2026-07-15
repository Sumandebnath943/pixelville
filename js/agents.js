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
const WAGES = { office: 22, skyscraper: 28, factory: 18, farm: 12, shop: 13, market: 14, mall: 16, restaurant: 14, cafe: 12, bakery: 12, hotel: 15, bank: 24, gas: 12, school: 18, college: 20, hospital: 22, police: 19, fire: 19, townhall: 20, courthouse: 22, temple: 10, library: 14, amusement: 15, stadium: 16, cinema: 14, theater: 14, museum: 15, gym: 13, pool: 12, airport: 20,
  deptstore: 16, pharmacy: 16, barber: 12, florist: 12, bookshop: 13, butcher: 14, tailor: 13, electronics: 16, toyshop: 13, jeweler: 18, petshop: 12, hardware: 14, furniture: 15, icecream: 11, pizzeria: 13, arcade: 13, laundry: 11, autoshop: 15,
  steelworks: 22, sawmill: 16, brickworks: 16, textilemill: 14, cannery: 15, glassworks: 17, warehouse: 14, powerplant: 24,
  taxistand: 13, trainstation: 16, dock: 15, heliport: 20, postoffice: 14, zoo: 14 };
const PRICES = { shop: 5, market: 7, mall: 10, bakery: 4, cafe: 5, restaurant: 12, cinema: 8, theater: 9, museum: 6, amusement: 13, stadium: 10, gym: 5, pool: 4, hotel: 15, library: 0, temple: 0, park: 0, playground: 0,
  deptstore: 9, pharmacy: 6, barber: 7, florist: 6, bookshop: 7, butcher: 8, tailor: 9, electronics: 14, toyshop: 8, jeweler: 20, petshop: 7, hardware: 9, furniture: 15, icecream: 4, pizzeria: 7, arcade: 6, laundry: 4, autoshop: 12,
  zoo: 9, plaza: 0, grandpark: 0 };

/* A resident is more than a worker slot.  These profiles drive savings,
   ambitions, and the occasional risky choice without making crime common. */
const ADULT_LIFESTYLES = [
  { id: 'worker', weight: 44, aspiration: 'career', saveRate: 0.22, funding: 'wages' },
  { id: 'shopkeeper', weight: 15, aspiration: 'business', saveRate: 0.46, funding: 'wages',
    kinds: ['shop', 'bakery', 'cafe', 'florist', 'barber', 'bookshop', 'butcher', 'icecream', 'laundry', 'petshop', 'toyshop'] },
  { id: 'entrepreneur', weight: 14, aspiration: 'business', saveRate: 0.5, funding: 'wages',
    kinds: ['shop', 'cafe', 'bakery', 'market', 'pharmacy', 'tailor', 'hardware', 'electronics', 'pizzeria', 'furniture', 'autoshop', 'arcade', 'gym', 'jeweler'] },
  { id: 'tycoon', weight: 6, aspiration: 'business', saveRate: 0.55, funding: 'loan',
    kinds: ['deptstore', 'hotel', 'restaurant', 'cinema', 'mall'] },
  { id: 'industrialist', weight: 5, aspiration: 'business', saveRate: 0.52, funding: 'loan',
    kinds: ['sawmill', 'brickworks', 'textilemill', 'cannery', 'glassworks', 'warehouse', 'factory'] },
  { id: 'neighbor', weight: 10, aspiration: 'community', saveRate: 0.26, funding: 'wages' },
  { id: 'risk-taker', weight: 6, aspiration: 'business', saveRate: 0.38, funding: 'risk', kinds: ['shop', 'cafe', 'market', 'arcade', 'pizzeria'] },
];
const STARTUP_COSTS = {
  shop: 210, cafe: 230, bakery: 220, market: 320,
  florist: 190, barber: 180, bookshop: 220, butcher: 240, icecream: 170, laundry: 200, petshop: 240, toyshop: 260,
  pharmacy: 300, tailor: 200, hardware: 300, electronics: 380, pizzeria: 260, furniture: 400, autoshop: 350, arcade: 380, gym: 320, jeweler: 420,
  deptstore: 900, hotel: 1100, restaurant: 340, cinema: 760, mall: 1400,
  sawmill: 520, brickworks: 540, textilemill: 580, cannery: 500, glassworks: 560, warehouse: 400, factory: 640,
};

/* ---------------- twenty-plus honest ways to earn a little money ----------------
   Odd jobs for anyone between careers (and pocket money for the enterprising).
   Some only make sense in certain seasons or near certain terrain. */
const SIDE_GIGS = [
  { name: 'babysitting', emoji: '🍼', pay: [4, 9] },
  { name: 'dog walking', emoji: '🐕', pay: [3, 7] },
  { name: 'tutoring kids', emoji: '📚', pay: [5, 11], need: 'school' },
  { name: 'fishing at the lake', emoji: '🎣', pay: [4, 12], water: true },
  { name: 'street music', emoji: '🎸', pay: [2, 10] },
  { name: 'delivering parcels', emoji: '📦', pay: [5, 10] },
  { name: 'gardening for neighbours', emoji: '🌷', pay: [4, 9], notWinter: true },
  { name: 'washing windows', emoji: '🪟', pay: [4, 8] },
  { name: 'shoveling snow', emoji: '❄️', pay: [6, 12], winter: true },
  { name: 'picking berries', emoji: '🫐', pay: [3, 8], seasons: [1, 2] },
  { name: 'a lemonade stand', emoji: '🍋', pay: [2, 6], seasons: [1] },
  { name: 'cutting hair at home', emoji: '✂️', pay: [5, 10] },
  { name: 'fixing bicycles', emoji: '🚲', pay: [5, 11] },
  { name: 'sewing and mending', emoji: '🪡', pay: [4, 9] },
  { name: 'painting fences', emoji: '🖌️', pay: [5, 10], notWinter: true },
  { name: 'washing cars', emoji: '🧽', pay: [4, 9], notWinter: true },
  { name: 'helping with the harvest', emoji: '🌾', pay: [6, 12], need: 'farm', seasons: [2] },
  { name: 'a newspaper round', emoji: '🗞️', pay: [3, 6] },
  { name: 'collecting recyclables', emoji: '♻️', pay: [2, 6] },
  { name: 'foraging mushrooms', emoji: '🍄', pay: [3, 9], seasons: [2] },
  { name: 'selling home baking', emoji: '🧁', pay: [4, 10] },
  { name: 'guiding tourists', emoji: '🗺️', pay: [5, 12], need: 'hotel' },
];

const GIVEN_NAMES = ['Asha', 'Maya', 'Ishan', 'Noor', 'Dev', 'Elena', 'Farah', 'Jonah',
  'Kiran', 'Lina', 'Mateo', 'Nia', 'Omar', 'Priya', 'Sana', 'Tomas', 'Ada', 'Ben',
  'Chloe', 'Dario', 'Esme', 'Felix', 'Greta', 'Hugo', 'Ida', 'Jasper', 'Kai', 'Luna'];

/* the arc of a life, in years — a year passes each in-game day */
const AGE_ADULT = 18, AGE_RETIRE = 65, AGE_FRAIL = 70;

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
  deptstore: '🏬', pharmacy: '💊', barber: '💈', florist: '🌸', bookshop: '📖', butcher: '🥩',
  tailor: '🧵', electronics: '📺', toyshop: '🧸', jeweler: '💍', petshop: '🐾', hardware: '🔨',
  furniture: '🛋️', icecream: '🍦', pizzeria: '🍕', arcade: '🕹️', laundry: '🧺', autoshop: '🔧',
  zoo: '🦁', plaza: '⛲', grandpark: '🧺',
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
      const weds = b.newlywedIds ? this.people.filter(p => b.newlywedIds.includes(p.id)) : [];
      if (weds.length) { // a couple built this house for themselves
        for (const p of weds) this.moveHomes(p, b);
        b.funds = 40 + Math.random() * 40;
        b.newlywedIds = null;
        if (d.cars) b.cars.push({ free: true, seed: (Math.random() * 8) | 0 });
        msgs.push(`💑 The ${weds[0].surname} newlyweds moved into their brand-new home!`);
        for (const p of weds) this.planDay(p);
      } else {
        const fam = this.spawnFamily(b);
        b.funds = (d.rich ? 380 : 40) + Math.random() * 80;
        for (let i = 0; i < (d.cars || 0); i++) b.cars.push({ free: true, seed: (Math.random() * 8) | 0 });
        msgs.push(`The ${fam.surname} family moved in — ${fam.n} resident${fam.n > 1 ? 's' : ''} 🏠`);
      }
    } else if (d.res === 'block') {
      let total = 0;
      const famCount = d.fams || 4;
      for (let i = 0; i < famCount; i++) total += this.spawnFamily(b).n;
      for (let i = 0; i < (d.cars || 0); i++) b.cars.push({ free: true, seed: (Math.random() * 8) | 0 });
      msgs.push(`${total} new residents moved into the ${d.name.toLowerCase()} 🏢`);
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

  /* create one villager; used by move-ins, births and grown-up kids */
  makePerson(kind, surname, home, age) {
    const style = kind === 'kid' ? null : chooseLifestyle();
    const businessKinds = style && style.kinds;
    const seed = (Math.random() * 1e6) | 0;
    const p = {
      id: this.nextPid++, kind, surname, seed,
      name: GIVEN_NAMES[seed % GIVEN_NAMES.length],
      age: age !== undefined ? age : (kind === 'kid' ? 6 + Math.floor(Math.random() * 8) : 22 + Math.floor(Math.random() * 24)),
      home, work: null, school: null,
      partnerId: null, // sweetheart / spouse
      married: false,
      state: 'in', at: home, dest: null, trip: null, events: [],
      trait: style && style.aspiration === 'business' ? 'entrepreneur' : 'worker',
      lifestyle: style ? style.id : 'student',
      aspiration: style ? style.aspiration : 'learn',
      fundingPlan: style ? style.funding : 'none',
      savingsRate: style ? style.saveRate : 0,
      businessKind: businessKinds ? businessKinds[(Math.random() * businessKinds.length) | 0] : null,
      savings: kind === 'kid' ? 0 : 8 + Math.random() * 22,
      wageMult: 1, jobDays: 0,
      heldUntil: 0, lastIllegalDay: -99,
      mood: 58 + Math.random() * 22, // 0-100: feelings drive votes, riots & outings
      x: 0, y: 0,
    };
    home.residents.push(p); this.people.push(p);
    return p;
  },

  fullName(p) { return `${p.name} ${p.surname}`; },

  spawnFamily(b) {
    const surname = SURNAMES[(Math.random() * SURNAMES.length) | 0];
    let n = 0;
    const a = this.makePerson('man', surname, b); n++;
    const w = this.makePerson('woman', surname, b); n++;
    a.partnerId = w.id; w.partnerId = a.id; a.married = w.married = true;
    if (Math.random() < 0.55) { this.makePerson('kid', surname, b); n++; }
    this.assignJobs(); this.assignSchools();
    for (const p of b.residents) this.planDay(p);
    return { surname, n };
  },

  /* ---------- assignments ---------- */
  workplaces() { return World.buildings.filter(b => (CAT[b.type].jobs || 0) > 0 && b.connected && !b.construction && !b.ruined); },

  assignJobs() {
    const seekers = this.people.filter(p => p.kind !== 'kid' && !p.work && p.home.connected &&
      (p.age === undefined || p.age < AGE_RETIRE));
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
    if (p.kind !== 'kid' && p.heldUntil > this.day) return; // behind bars — no plans today
    const wkend = this.isWeekend();
    const jit = () => (Math.random() * 40 - 20) | 0;
    const add = (t, dest, until) => {
      if (dest && dest.connected) p.events.push({ t: Math.max(5, t), dest, until: Math.min(1435, until) });
    };

    if (p.kind === 'kid') {
      if (p.age !== undefined && p.age < 5) return; // toddlers stay home with family
      if (!wkend && p.school) {
        add(470 + jit() / 2, p.school, 900 + jit() / 2);
        if (Math.random() < 0.4) {
          const play = this.pickVenue('leisure', p, ['playground', 'park', 'grandpark']);
          add(930, play, 1020);
        }
      } else if (Math.random() < 0.6) {
        add(600 + jit(), this.pickVenue('leisure', p, ['playground', 'park', 'pool', 'amusement', 'grandpark', 'zoo']), 780 + jit());
      }
    } else if (p.age !== undefined && p.age >= AGE_RETIRE) {
      // retirement: slow mornings, park benches, the occasional treat
      if (Math.random() < 0.75) {
        const t = 560 + Math.random() * 200;
        add(t, this.pickVenue('leisure', p, ['park', 'plaza', 'grandpark', 'library', 'temple', 'cafe']), t + 70 + Math.random() * 60);
      }
      if (Math.random() < 0.4) {
        const t2 = 900 + Math.random() * 200;
        add(t2, this.pickVenue('shop', p), t2 + 40);
      }
      if (Math.random() < 0.5) {
        const t3 = 480 + Math.random() * 600;
        p.events.push({ t: t3, stroll: true, until: t3 + 60 });
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
      this.lifeCycle(); // birthdays, love, weddings, births, old age
      for (const p of this.people) if (p.state === 'in' && p.at === p.home) this.planDay(p);
      this.dailyEconomy();
      // Government decisions happen after families have earned, saved, and
      // made their own plans for the day.
      if (typeof Gov !== 'undefined') Gov.dayTick();
    }
    // construction sites make progress — but the village shares one crew of
    // builders, so many simultaneous projects all move more slowly
    const gm = dtSim * MIN_PER_SEC;
    const sites = World.buildings.filter(b => b.construction > 0).length;
    const builders = 3 + Math.floor(this.people.filter(p => p.kind !== 'kid').length / 8);
    const crewRate = sites > 0 ? Math.min(1, builders / sites) : 1;
    for (const b of World.buildings) {
      if (b.construction > 0) {
        b.construction -= gm * crewRate;
        if (b.construction <= 0) {
          b.construction = 0; this.completed.push(b); World.dirty = true;
          if (typeof Tasks !== 'undefined') Tasks.done('b' + b.id, true, `Build the ${CAT[b.type].name}`);
        }
      }
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
    if (this.growthT > 110) { this.growthT = 0; this.checkGrowth(); }
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

  /* ---------- the circle of life ----------
     A year passes each in-game day. Kids grow up, sweethearts find each
     other, couples move in together and marry, babies arrive, elders
     retire, and in time the village buries its own and carries on. */
  removePerson(p, quiet) {
    p.home.residents = p.home.residents.filter(r => r !== p);
    if (p.work) p.work.workers = p.work.workers.filter(w => w !== p);
    if (p.trip && p.trip.car) p.trip.car.free = true;
    if (p.at && p.at !== p.home && p.state === 'in') p.at.inside = Math.max(0, p.at.inside - 1);
    const partner = p.partnerId ? this.people.find(q => q.id === p.partnerId) : null;
    if (partner) {
      partner.partnerId = null;
      if (!quiet) partner.mood = Math.max(5, (partner.mood === undefined ? 60 : partner.mood) - 25);
    }
    this.people = this.people.filter(q => q !== p);
  },

  moveHomes(p, to) {
    p.home.residents = p.home.residents.filter(r => r !== p);
    p.home = to;
    to.residents.push(p);
    if (p.state === 'in') p.at = to;
  },

  lifeCycle() {
    const say = m => { if (typeof Life !== 'undefined') Life.say(m); };
    const toRemove = [];
    for (const p of this.people) {
      if (p.age === undefined) p.age = p.kind === 'kid' ? 9 : 30;
      p.age++;

      // coming of age: a kid becomes an adult with dreams of their own
      if (p.kind === 'kid' && p.age >= AGE_ADULT) {
        p.kind = (p.seed % 2) ? 'woman' : 'man';
        const style = chooseLifestyle();
        p.lifestyle = style.id; p.aspiration = style.aspiration;
        p.fundingPlan = style.funding; p.savingsRate = style.saveRate;
        p.businessKind = style.kinds ? style.kinds[(Math.random() * style.kinds.length) | 0] : null;
        p.savings = 5 + Math.random() * 15;
        p.school = null;
        say(`🎓 ${this.fullName(p)} turned ${AGE_ADULT} and is looking for work${p.aspiration === 'business' ? ' — and dreams of a business' : ''}`);
        this.assignJobs();
      }

      // retirement
      if (p.age === AGE_RETIRE && p.work) {
        say(`🪑 ${this.fullName(p)} retired after a long working life at the ${CAT[p.work.type].name}`);
        p.work.workers = p.work.workers.filter(w => w !== p);
        p.work = null;
        this.assignJobs();
      }

      // old age claims its own
      if (p.age > AGE_FRAIL && Math.random() < (p.age - AGE_FRAIL) * 0.013) toRemove.push(p);
    }

    for (const p of toRemove) {
      say(`🕊️ ${this.fullName(p)} passed away peacefully at ${p.age} — the village mourns`);
      for (const r of p.home.residents) if (r !== p) r.mood = Math.max(5, (r.mood === undefined ? 60 : r.mood) - 18);
      this.removePerson(p);
    }

    this.tickRomance(say);
    this.tickBirths(say);
  },

  tickRomance(say) {
    // singles notice each other around town
    const singles = this.people.filter(p => p.kind !== 'kid' && !p.partnerId &&
      p.age >= AGE_ADULT && p.age < 58 && !p.home.ruined);
    if (singles.length >= 2 && Math.random() < Math.min(0.5, singles.length * 0.07)) {
      const men = singles.filter(p => p.kind === 'man');
      const women = singles.filter(p => p.kind === 'woman');
      if (men.length && women.length) {
        const a = men[(Math.random() * men.length) | 0];
        const b = women[(Math.random() * women.length) | 0];
        if (a.home !== b.home) {
          a.partnerId = b.id; b.partnerId = a.id;
          a.datingSince = b.datingSince = this.day;
          a.mood = Math.min(98, a.mood + 12); b.mood = Math.min(98, b.mood + 12);
          say(`💕 ${this.fullName(a)} and ${this.fullName(b)} are falling in love — they were seen at the park together`);
        }
      }
    }
    // couples move in together, then marry
    for (const p of this.people) {
      if (!p.partnerId || p.married || p.kind === 'kid') continue;
      const q = this.people.find(o => o.id === p.partnerId);
      if (!q || q.id < p.id) continue; // handle each couple once
      const days = this.day - (p.datingSince || this.day);
      if (p.home !== q.home && days >= 3 + (p.seed % 4)) {
        // move into whichever home has more room (or more money behind it)
        const dest = (p.home.residents.length <= q.home.residents.length) ? p.home : q.home;
        const mover = dest === p.home ? q : p;
        this.moveHomes(mover, dest);
        mover.surname = dest.residents.find(r => r !== mover) ? dest.residents.find(r => r !== mover).surname : mover.surname;
        say(`📦 ${this.fullName(mover)} moved in with ${this.fullName(mover === p ? q : p)} — young love under one roof`);
      } else if (p.home === q.home && days >= 6 + (p.seed % 5)) {
        p.married = q.married = true;
        const venue = World.buildings.find(b => b.type === 'temple' && b.connected && !b.ruined) ||
                      World.buildings.find(b => b.type === 'townhall' && b.connected && !b.ruined) ||
                      World.buildings.find(b => (b.type === 'park' || b.type === 'grandpark') && b.connected && !b.ruined);
        say(`💍 Wedding bells! ${this.fullName(p)} and ${this.fullName(q)} got married${venue ? ` at the ${CAT[venue.type].name}` : ''} 🎉`);
        p.home.funds = Math.max(0, p.home.funds - 25); // the party isn't free
        p.mood = q.mood = 95;
        if (typeof Life !== 'undefined' && venue)
          Life.celebrate(venue.x * T + venue.w * 8, venue.y * T + venue.h * 16, '#f2b8cc');
        // newlyweds with savings look for a place of their own
        if (p.home.residents.length > 4) this.seekNewHome(p, q, say);
      }
    }
  },

  seekNewHome(p, q, say) {
    const vacant = World.buildings.find(b => CAT[b.type].res === 'family' && !b.ruined && !b.construction &&
      b.connected && b.residents.length === 0);
    if (vacant) {
      this.moveHomes(p, vacant); this.moveHomes(q, vacant);
      vacant.funds = Math.max(20, (p.savings || 0) * 0.5 + (q.savings || 0) * 0.5);
      p.savings *= 0.5; q.savings *= 0.5;
      say(`🏠 The newlyweds ${p.surname}s moved into a place of their own`);
    } else if ((p.savings || 0) + (q.savings || 0) > 160) {
      const spot = World.findPlannedSpot('house');
      if (spot) {
        const nb = World.placeBuilding('house', spot.x, spot.y);
        if (nb) {
          nb.newlywedIds = [p.id, q.id];
          p.savings = Math.max(0, (p.savings || 0) - 80);
          q.savings = Math.max(0, (q.savings || 0) - 80);
          say(`🏗️ ${this.fullName(p)} and ${this.fullName(q)} are building their first house together`);
          World.refreshConnections();
        }
      }
    }
  },

  tickBirths(say) {
    for (const p of this.people) {
      if (p.kind !== 'woman' || !p.married || !p.partnerId) continue;
      if (p.age < 20 || p.age > 42) continue;
      const homeCap = CAT[p.home.type].res === 'block' ? 14 : 5;
      if (p.home.residents.length >= homeCap || p.home.ruined) continue;
      if (p.pregnantUntil) {
        if (this.day >= p.pregnantUntil) {
          p.pregnantUntil = 0;
          const baby = this.makePerson('kid', p.surname, p.home, 0);
          baby.mood = 80;
          say(`👶 A baby! ${this.fullName(p)} and family welcomed little ${baby.name} ${baby.surname}`);
          for (const r of p.home.residents) r.mood = Math.min(98, (r.mood === undefined ? 60 : r.mood) + 10);
        }
      } else if (Math.random() < 0.06) {
        p.pregnantUntil = this.day + 3;
        say(`🤰 Happy news at the ${p.surname} home — a baby is on the way`);
      }
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
      // more cars as the family prospers (a third for the truly comfortable)
      const adults = b.residents.filter(r => r.kind !== 'kid').length;
      const carCap = b.level >= 3 ? 3 : Math.min(2, adults);
      if (b.cars.length < carCap && b.funds >= (b.cars.length >= 2 ? 550 : 350)) {
        b.funds -= b.cars.length >= 2 ? 420 : 250;
        b.cars.push({ free: true, seed: (Math.random() * 8) | 0 });
        say(b.cars.length >= 3 ? `🚗 The ${name}s added a third car to the driveway — living large!` : `🚗 The ${name}s bought a new car`);
      }
      // property investment: build a rental home
      if (b.level >= 2 && b.funds >= 900 && this.day >= (b.nextInvestmentDay || 0) && Math.random() < 0.14) {
        const spot = World.findPlannedSpot('house');
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
    this.sideGigs();
    this.tickLoans();
    this.tickBusinessHealth();
    this.advanceAmbitions();
  },

  /* ---------- side gigs: everyone can hustle a little ---------- */
  sideGigs() {
    const hasType = t => World.buildings.some(b => b.type === t && !b.ruined && !b.construction);
    const season = typeof Weather !== 'undefined' ? Weather.season : 0;
    const options = SIDE_GIGS.filter(g =>
      (!g.winter || season === 3) &&
      (!g.notWinter || season !== 3) &&
      (!g.seasons || g.seasons.includes(season)) &&
      (!g.water || (typeof Life !== 'undefined' && Life.waterTiles.length > 8)) &&
      (!g.need || hasType(g.need)));
    if (!options.length) return;
    for (const p of this.people) {
      if (p.kind === 'kid' || p.heldUntil > this.day || p.home.ruined) continue;
      const retired = p.age !== undefined && p.age >= AGE_RETIRE;
      // the jobless hustle most days; workers and retirees pick up the odd gig
      const chance = !p.work && !retired ? 0.75 : retired ? 0.2 : 0.1;
      if (Math.random() > chance) continue;
      const gig = options[(Math.random() * options.length) | 0];
      const pay = gig.pay[0] + Math.random() * (gig.pay[1] - gig.pay[0]);
      p.savings = (p.savings || 0) + pay * 0.6;
      p.home.funds += pay * 0.4;
      p.lastGig = gig.name;
      if (Math.random() < 0.05 && typeof Life !== 'undefined')
        Life.say(`${gig.emoji} ${this.fullName(p)} earned $${Math.round(pay)} ${gig.name}`);
    }
  },

  /* ---------- bank loans: borrowed dreams, daily repayments ---------- */
  tickLoans() {
    const bank = World.buildings.find(b => b.type === 'bank' && b.connected && !b.ruined && !b.construction);
    for (const p of this.people) {
      if (!p.loan) continue;
      const install = Math.max(4, p.loan.balance * 0.06);
      let paid = 0;
      const fromSavings = Math.min(p.savings || 0, install);
      p.savings -= fromSavings; paid += fromSavings;
      if (paid < install && p.home.funds > 20) {
        const fromHome = Math.min(p.home.funds - 20, install - paid);
        p.home.funds -= fromHome; paid += fromHome;
      }
      if (paid > 0) {
        p.loan.balance -= paid * 0.97; // a sliver of interest stays with the bank
        if (bank) bank.funds += paid * 0.03;
        p.loan.missed = 0;
        if (p.loan.balance <= 1) {
          p.loan = null;
          if (typeof Life !== 'undefined') Life.say(`🏦 ${this.fullName(p)} paid off the business loan — debt-free at last!`);
          p.mood = Math.min(98, (p.mood === undefined ? 60 : p.mood) + 10);
        }
      } else {
        p.loan.missed = (p.loan.missed || 0) + 1;
        p.mood = Math.max(5, (p.mood === undefined ? 60 : p.mood) - 4);
        if (p.loan.missed >= 10) {
          // foreclosure: the bank seizes the business
          const biz = World.buildings.find(b => b.founderId === p.id && !b.ruined);
          p.loan = null;
          p.ownsBusiness = false;
          if (biz) {
            if (typeof Life !== 'undefined')
              Life.say(`💔 The bank foreclosed on ${this.fullName(p)}'s ${CAT[biz.type].name} — the doors are shuttered`);
            World.removeBuilding(biz);
            this.onBuildingRemoved(biz);
            World.refreshConnections();
          } else if (typeof Life !== 'undefined') {
            Life.say(`💸 ${this.fullName(p)} defaulted on a loan; the bank wrote it off`);
          }
          p.mood = Math.max(5, p.mood - 20);
        }
      }
    }
  },

  /* ---------- businesses can thrive... or quietly go under ---------- */
  tickBusinessHealth() {
    for (const b of World.buildings.slice()) {
      if (!b.founderId || b.ruined || b.construction) continue;
      const d = CAT[b.type];
      if (!d.visit) continue;
      const founder = this.people.find(p => p.id === b.founderId);
      if (!founder) { b.founderId = null; continue; }
      if (b.visitors <= 1) {
        b.badDays = (b.badDays || 0) + 1;
        b.funds = Math.max(0, b.funds - 5); // rent and stock still cost money
        if (b.badDays === 5 && typeof Life !== 'undefined')
          Life.say(`📉 ${this.fullName(founder)}'s ${d.name} is struggling — barely a customer all week`);
        if (b.badDays >= 9 && b.funds <= 5) {
          if (typeof Life !== 'undefined')
            Life.say(`🚪 ${this.fullName(founder)}'s ${d.name} went out of business. Risk is real in PixelVille`);
          founder.ownsBusiness = false;
          founder.mood = Math.max(5, (founder.mood === undefined ? 60 : founder.mood) - 18);
          World.removeBuilding(b);
          this.onBuildingRemoved(b);
          World.refreshConnections();
        }
      } else {
        b.badDays = 0;
        if (b.visitors >= 8 && !b.boomSaid) {
          b.boomSaid = true;
          if (typeof Life !== 'undefined')
            Life.say(`📈 ${this.fullName(founder)}'s ${d.name} is booming — ${b.visitors} customers today!`);
          founder.mood = Math.min(98, (founder.mood === undefined ? 60 : founder.mood) + 8);
        }
      }
    }
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
      .filter(p => p.kind !== 'kid' && p.aspiration === 'business' && !p.ownsBusiness && !p.loan &&
        p.businessKind && p.home.connected && p.heldUntil <= this.day &&
        (p.age === undefined || (p.age >= AGE_ADULT && p.age < AGE_RETIRE)))
      .sort((a, b) => {
        const ar = this.startupCapital(a) / (STARTUP_COSTS[a.businessKind] || 300);
        const br = this.startupCapital(b) / (STARTUP_COSTS[b.businessKind] || 300);
        return br - ar;
      });
    if (!founders.length) return;

    const founder = founders[0];
    const kind = founder.businessKind;
    // buying the plot: the government sells land, and prices vary by district
    const spot = World.findPlannedSpot(kind);
    if (!spot) { this.nextEnterpriseDay = this.day + 1; return; }
    const d = CAT[kind];
    const landCost = typeof Gov !== 'undefined' ? Gov.landCostFor(kind, spot.x, spot.y) : 30;
    const total = (STARTUP_COSTS[kind] || 300) + landCost;
    const capital = this.startupCapital(founder);
    const bank = World.buildings.find(b => b.type === 'bank' && b.connected && !b.ruined && !b.construction);
    let loanAmount = 0;
    if (capital < total) {
      // a bank can lend the shortfall — if the founder brings real equity
      if (bank && capital >= total * 0.4) {
        loanAmount = total - capital;
      } else {
        if (founder.fundingPlan === 'risk') this.tryPettyTheft(founder);
        this.nextEnterpriseDay = this.day + 1 + ((Math.random() * 2) | 0);
        return;
      }
    }
    const business = World.placeBuilding(kind, spot.x, spot.y);
    if (!business) { this.nextEnterpriseDay = this.day + 1; return; }

    const ownMoney = total - loanAmount;
    const personalSpend = Math.min(founder.savings || 0, ownMoney);
    founder.savings = Math.max(0, (founder.savings || 0) - personalSpend);
    founder.home.funds = Math.max(0, founder.home.funds - (ownMoney - personalSpend));
    if (loanAmount > 0) founder.loan = { balance: Math.round(loanAmount * 1.08), missed: 0 }; // 8% interest
    if (typeof Gov !== 'undefined') Gov.treasury += landCost; // land is bought from the government
    business.ownerId = founder.home.id;
    business.founderId = founder.id;
    business.landPrice = landCost;
    founder.ownsBusiness = true;
    this.nextEnterpriseDay = this.day + 1 + ((Math.random() * 2) | 0);
    World.refreshConnections();
    if (typeof Life !== 'undefined') {
      const district = typeof Gov !== 'undefined' ? Gov.districtName(spot.x, spot.y) : 'town';
      Life.say(`🏗️ ${this.fullName(founder)} bought a $${landCost} plot in the ${district} for a ${d.name.toLowerCase()}` +
        (loanAmount > 0 ? ` — with a $${Math.round(loanAmount)} bank loan. A real gamble!` : ' with hard-earned savings'));
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
    // families move into vacant homes when there is work to be had
    const s = this.stats();
    const vacantHomes = World.buildings.filter(b => CAT[b.type].res && !b.construction && !b.ruined &&
      b.connected && b.residents.length === 0);
    if (vacantHomes.length && s.jobs - s.employed > 2 && Math.random() < 0.5) {
      const home = vacantHomes[(Math.random() * vacantHomes.length) | 0];
      const fam = this.spawnFamily(home);
      home.funds = Math.max(home.funds, 40 + Math.random() * 60);
      if (CAT[home.type].cars && !home.cars.length) home.cars.push({ free: true, seed: (Math.random() * 8) | 0 });
      if (typeof Life !== 'undefined')
        Life.say(`🚚 The ${fam.surname} family moved to the village, drawn by the job market (${fam.n} newcomers)`);
    }
    if (this.day < this.nextGrowthDay) return;
    const underCon = World.buildings.filter(b => b.construction > 0 && CAT[b.type].res).length;
    if (underCon >= 2) return; // two housing projects can run side by side now
    const vacant = vacantHomes.length;
    const unfilled = s.jobs - s.employed;
    if (unfilled > 3 && vacant === 0 && Math.random() < 0.45) {
      const key = unfilled > 14 && this.people.length > 26 ? 'apartment' :
        (unfilled > 8 && Math.random() < 0.4 ? 'rowhouse' : 'house');
      const spot = World.findPlannedSpot(key);
      if (spot) {
        World.placeBuilding(key, spot.x, spot.y);
        this.nextGrowthDay = this.day + 1 + ((Math.random() * 2) | 0);
        World.refreshConnections();
        if (typeof Life !== 'undefined')
          Life.say(key === 'apartment' ? '🏗️ Demand is booming — an apartment block is going up!' : '🏗️ New settlers are building homes — the town is growing!');
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
      const speed = (t.car || t.taxi) ? CAR_SPEED : WALK_SPEED;
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
            const wage = (WAGES[dest.type] || 15) * (p.wageMult || 1);
            // Each adult keeps a small personal fund for their own ambitions;
            // the rest still supports the household.
            const personal = wage * (p.savingsRate === undefined ? 0.2 : p.savingsRate);
            p.savings = (p.savings || 0) + personal;
            p.home.funds += wage - personal;
            // seniority: steady service earns increments and promotions
            p.jobDays = (p.jobDays || 0) + 1;
            if (p.jobDays % 11 === 0 && (p.wageMult || 1) < 2.1 && Math.random() < 0.55) {
              p.wageMult = (p.wageMult || 1) + 0.16;
              const rank = p.wageMult < 1.4 ? 'a raise' : p.wageMult < 1.8 ? 'a promotion to senior staff' : 'a management post';
              if (typeof Life !== 'undefined')
                Life.say(`🎖️ ${this.fullName(p)} earned ${rank} at the ${CAT[dest.type].name}!`);
              p.mood = Math.min(98, (p.mood === undefined ? 60 : p.mood) + 8);
            }
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
      const off = (t.car || t.taxi) ? 3.5 : 5.5;
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
    // no family car free? hail a cab from the taxi rank (fare goes to the stand)
    let taxi = false;
    if (!car && p.kind !== 'kid' && path.length >= carMin) {
      const stand = World.buildings.find(b => b.type === 'taxistand' && b.connected && !b.ruined && !b.construction);
      if (stand && p.home.funds > 6) {
        taxi = true;
        p.home.funds -= 3;
        stand.funds += 3;
        stand.visitors++;
      }
    }
    p.carHeld = null;
    p.state = 'walk';
    p.dest = dest;
    p.until = until;
    p.trip = { path, prog: 0, car, taxi };
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
