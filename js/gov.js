/* ============================================================
   PixelVille — village government, elections & community spirit.
   Adults vote once every 28 in-game days. Their vote is based on
   their own quality of life, so a healthy village tends to keep a
   capable leader while hardship makes a change (or a bad gamble)
   more likely. When town hall neglects a genuine need, neighbours
   can still pool their money and solve it themselves.
   ============================================================ */
'use strict';

const ELECTION_PERIOD = 28; // four 7-day seasons = one in-game year

const LEADER_NAMES = ['Arjun Mehta', 'Rosa Alvarez', 'Chen Wei', 'Amara Osei', 'Viktor Hall',
  'Leila Haddad', 'Tom Berg', 'Ines Costa', 'Ravi Iyer', 'Hana Kim', 'Marco Rossi', 'Nadia Petrov'];
const VILLAGER_GIVEN_NAMES = ['Asha', 'Maya', 'Ishan', 'Noor', 'Dev', 'Elena', 'Farah', 'Jonah',
  'Kiran', 'Lina', 'Mateo', 'Nia', 'Omar', 'Priya', 'Sana', 'Tomas'];

const LEADER_TYPES = [
  {
    kind: 'visionary', emoji: '💖', zeal: 1.35, skim: 0,
    label: 'a visionary with a pure heart',
    builds: ['park', 'school', 'library', 'playground', 'hospital', 'pool', 'grandpark', 'plaza', 'zoo',
      'temple', 'museum', 'theater', 'cinema', 'college'],
  },
  {
    kind: 'business', emoji: '📈', zeal: 1.05, skim: 0.08,
    label: 'a sharp business mind',
    builds: ['shop', 'market', 'office', 'factory', 'mall', 'bank', 'deptstore', 'trainstation', 'dock',
      'exchange', 'powerplant', 'skyscraper', 'airport', 'farm'],
  },
  {
    kind: 'steady', emoji: '🧱', zeal: 0.8, skim: 0.03,
    label: 'a careful, dependable planner',
    builds: ['fire', 'police', 'school', 'park', 'library', 'busstop', 'postoffice', 'watertower', 'farm', 'tvstation'],
  },
  {
    kind: 'corrupt', emoji: '🐍', zeal: 0.3, skim: 0.55,
    label: 'a smooth talker with deep pockets',
    builds: ['townhall'],
  },
];

const CIVIC_COSTS = {
  fire: 260, police: 260, school: 320, hospital: 420, park: 140, library: 200,
  playground: 100, pool: 180, townhall: 380, shop: 160, market: 220, office: 300,
  factory: 340, mall: 480, bank: 300, house: 190, apartment: 430,
  busstop: 45, taxistand: 70, trainstation: 420, dock: 340, heliport: 560,
  postoffice: 210, plaza: 170, grandpark: 320, zoo: 720, rowhouse: 300,
  courthouse: 420, powerplant: 780, deptstore: 700,
  watertower: 240, college: 520, temple: 300, museum: 380, cinema: 400, theater: 380,
  stadium: 950, amusement: 820, airport: 1600, tvstation: 450, exchange: 600,
  farm: 260, skyscraper: 1200, gym: 260, cafe: 160,
};

/* how far one station's protection reaches (manhattan tiles); a town that
   outgrows the radius needs a second station in the new district */
const COVERAGE_RADIUS = { police: 32, fire: 30, school: 36 };

const civicClamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

const CAMPAIGN_DAYS = 7;      // a full week of banners, rallies and promises
const CAND_COLORS = ['#e05a5a', '#4f8ede', '#4fae5c', '#d09a3a'];

const Gov = {
  leader: null,
  treasury: 0,
  approval: 60,
  lastElection: 1,
  scandals: 0,
  recentBuilds: 0,
  needTimers: {},
  unmetNeeds: {},
  riotCd: 0,
  election: null,
  campaign: null,

  reset() {
    this.leader = null;
    this.treasury = 0;
    this.approval = 60;
    this.lastElection = 1;
    this.scandals = 0;
    this.recentBuilds = 0;
    this.needTimers = {};
    this.unmetNeeds = {};
    this.riotCd = 0;
    this.election = null;
    this.campaign = null;
    this.officeTimer = 0;
    this.nextRailDay = 0;
  },

  say(message) { if (typeof Life !== 'undefined') Life.say(message); },

  /* ---------- government land office ----------
     All undeveloped land belongs to the village. Prices per tile follow
     the market: central plots near the town hall cost several times what
     an edge-of-map field does, and waterfront carries a premium. */
  townCenter() {
    const hall = World.buildings.find(b => b.type === 'townhall' && !b.ruined);
    if (hall) return { x: hall.x + (hall.w >> 1), y: hall.y + (hall.h >> 1) };
    // otherwise: the centroid of the built village
    const built = World.buildings.filter(b => !b.ruined);
    if (!built.length) return { x: GW >> 1, y: GH >> 1 };
    let sx = 0, sy = 0;
    for (const b of built) { sx += b.x; sy += b.y; }
    return { x: Math.round(sx / built.length), y: Math.round(sy / built.length) };
  },

  landPrice(x, y) {
    const c = this.townCenter();
    const dist = Math.abs(x - c.x) + Math.abs(y - c.y);
    const centrality = Math.max(0, 1 - dist / 70);
    let price = 4 + 24 * centrality * centrality;
    // waterfront premium
    for (const [dx, dy] of [[0, -2], [2, 0], [0, 2], [-2, 0]])
      if (World.inB(x + dx, y + dy) && World.ground[World.idx(x + dx, y + dy)] === G_WATER) { price *= 1.3; break; }
    return Math.round(price);
  },

  landCostFor(key, x, y) {
    const d = CAT[key];
    return this.landPrice(x + (d.w >> 1), y + (d.h >> 1)) * d.w * d.h;
  },

  districtName(x, y) {
    const c = this.townCenter();
    const dist = Math.abs(x - c.x) + Math.abs(y - c.y);
    if (dist < 14) return 'town centre';
    if (dist < 30) return 'inner district';
    if (dist < 48) return 'outskirts';
    return 'far countryside';
  },

  /* ---------- service coverage: one station cannot police a whole city ----------
     Returns {x, y, count} for the centre of the largest cluster of buildings
     that no active station of this type reaches, or null if covered. */
  coverageGap(type) {
    const radius = COVERAGE_RADIUS[type];
    if (!radius) return null;
    const stations = World.buildings.filter(b => b.type === type && !b.ruined);
    if (!stations.length) return null; // "no station at all" is handled separately
    const uncovered = [];
    for (const b of World.buildings) {
      if (b.ruined || !b.connected || b.type === type) continue;
      let near = false;
      for (const s of stations)
        if (Math.abs(s.x - b.x) + Math.abs(s.y - b.y) <= radius) { near = true; break; }
      if (!near) uncovered.push(b);
    }
    if (uncovered.length < 7) return null;
    // aim at the densest uncovered cluster, not the global centroid — a town
    // with two far-apart gaps used to get stations dropped uselessly between
    // them, forever "needing" another one
    let best = null, bestN = -1;
    for (const b of uncovered) {
      let n = 0;
      for (const o of uncovered) if (Math.abs(o.x - b.x) + Math.abs(o.y - b.y) <= 20) n++;
      if (n > bestN) { bestN = n; best = b; }
    }
    return { x: best.x, y: best.y, count: uncovered.length };
  },

  activeBuildings(type) {
    return World.buildings.filter(b => (!type || b.type === type) && b.connected && !b.construction && !b.ruined);
  },

  has(type) { return this.activeBuildings(type).length > 0; },

  hasPlanned(type) {
    return World.buildings.some(b => b.type === type && !b.ruined);
  },

  voters() {
    return Sim.people.filter(p => p.kind !== 'kid' && p.home && !p.home.ruined);
  },

  candidateName(person, index) {
    if (person) return `${VILLAGER_GIVEN_NAMES[person.seed % VILLAGER_GIVEN_NAMES.length]} ${person.surname}`;
    return LEADER_NAMES[index % LEADER_NAMES.length];
  },

  /* A personal, lightweight quality-of-life score. It makes voting feel
     local: an unemployed resident without services does not vote like a
     secure, well-connected neighbour. */
  voterQuality(person) {
    const home = person.home;
    const active = type => this.has(type);
    let score = 11;
    score += person.work ? 27 : 3;
    score += civicClamp((home && home.funds ? home.funds : 0) / 12, 0, 18);
    score += Sim.safety * 0.19;
    if (active('shop') || active('market') || active('mall')) score += 8;
    if (this.activeBuildings().some(b => CAT[b.type].visit === 'leisure')) score += 7;
    if (person.kind === 'kid' || Sim.people.some(p => p.home === home && p.kind === 'kid'))
      score += active('school') ? 6 : -5;
    if (Sim.people.length >= 42) score += active('hospital') ? 4 : -5;
    if (typeof Life !== 'undefined') {
      if (Life.firesRecent >= 1 && !active('fire')) score -= 13;
      if (Life.crimes >= 2 && !active('police')) score -= 10;
    }
    if (home && (home.ruined || home.fire)) score -= 24;
    score += ((person.mood === undefined ? 60 : person.mood) - 55) * 0.22; // feelings colour the ballot
    return civicClamp(score, 2, 98);
  },

  civicQuality() {
    const voters = this.voters();
    if (!voters.length) return 100;
    return Math.round(voters.reduce((sum, p) => sum + this.voterQuality(p), 0) / voters.length);
  },

  /* The major, concrete reasons people are entitled to be angry. Life.js
     asks this before creating a protest, so a riot is never random flavour. */
  grievanceReport() {
    const stats = Sim.stats();
    const quality = this.civicQuality();
    const issues = [];
    let severity = 0;
    const unemployed = Math.max(0, stats.adults - stats.employed);
    if (quality < 46) { severity += (46 - quality) * 1.35; issues.push('poor living conditions'); }
    if (stats.adults && unemployed / stats.adults > 0.32) { severity += 18; issues.push('too few jobs'); }
    if (stats.safety < 58) { severity += (58 - stats.safety) * 0.55; issues.push('unsafe streets'); }
    if (typeof Life !== 'undefined' && Life.firesRecent >= 2 && !this.has('fire')) {
      severity += 22; issues.push('repeated fires without a fire brigade');
    }
    if (typeof Life !== 'undefined' && Life.crimes >= 2 && !this.has('police')) {
      severity += 14; issues.push('crime without police protection');
    }
    if (this.scandals >= 2) { severity += this.scandals * 8; issues.push('missing public money'); }
    if (this.leader && this.approval < 30) { severity += (30 - this.approval) * 0.55; issues.push('lost trust in town hall'); }
    for (const days of Object.values(this.unmetNeeds)) {
      if (days >= 5) severity += Math.min(12, days * 1.4);
    }
    if (this.leader && this.leader.type.kind === 'corrupt') severity += 8;
    return {
      severity: Math.round(civicClamp(severity, 0, 100)),
      quality,
      issues,
      reason: issues[0] || 'unanswered civic needs',
    };
  },

  maybeFirstElection() {
    if (!this.leader && !this.campaign && this.voters().length >= 6)
      this.startCampaign(Sim.day + 4, false, 'first election');
  },

  /* ---------- the campaign: a visible week of banners, rallies & promises ---------- */
  promiseFor(c) {
    const needs = this.assessNeedsList().filter(n => n !== 'townhall');
    const concrete = needs.length ? `a new ${CAT[needs[0]].name.toLowerCase()}` : null;
    switch (c.type.kind) {
      case 'visionary': return (concrete ? concrete + ' and ' : '') + 'a better life for every family';
      case 'business': return (concrete ? concrete + ', ' : '') + 'jobs and a booming main street';
      case 'steady': return (concrete ? concrete + ' and ' : '') + 'safe, quiet streets that just work';
      default: return 'lower taxes, free everything, and gold-paved roads (somehow)';
    }
  },

  startCampaign(electionDay, includeIncumbent, reason) {
    const candidates = this.makeCandidates(includeIncumbent);
    candidates.forEach((c, i) => {
      c.color = CAND_COLORS[i % CAND_COLORS.length];
      c.promise = this.promiseFor(c);
    });
    // banners strung along busy streets — election season should be IMPOSSIBLE to miss
    const roads = [];
    for (let i = 0; i < World.roadMap.length; i++) if (World.roadMap[i]) roads.push(i);
    const banners = [];
    for (let k = 0; k < 90 && banners.length < 22 && roads.length; k++) {
      const r = roads[(Math.random() * roads.length) | 0];
      const x = r % GW, y = (r / GW) | 0;
      if (banners.some(bn => Math.abs(bn.x - x) + Math.abs(bn.y - y) < 4)) continue;
      banners.push({ x, y, ci: banners.length % candidates.length });
    }
    // each candidate pitches a campaign camp — a tent with volunteers beside a road
    const camps = [];
    for (let ci = 0; ci < candidates.length; ci++) {
      for (let k = 0; k < 60; k++) {
        const r = roads[(Math.random() * roads.length) | 0];
        const rx = r % GW, ry = (r / GW) | 0;
        const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
        const [dx, dy] = dirs[(Math.random() * 4) | 0];
        const x = rx + dx, y = ry + dy;
        if (!World.inB(x, y)) continue;
        const i = World.idx(x, y);
        if (World.ground[i] !== G_GRASS || World.bmap[i] || World.roadMap[i] || World.railMap[i]) continue;
        if (camps.some(cp => Math.abs(cp.x - x) + Math.abs(cp.y - y) < 9)) continue;
        camps.push({ x, y, ci });
        break;
      }
    }
    this.campaign = { candidates, electionDay, banners, camps, nextRally: 0, reason, votingDay: false };
    this.say(`🗳️ Election season! ${candidates.map(c => `${c.name} ${c.type.emoji}`).join(' vs ')} — voting in ${electionDay - Sim.day} days. Banners, camps and campaign cars are everywhere.`);
    if (typeof Tasks !== 'undefined')
      Tasks.add('election' + electionDay, '🗳️', `Hold the ${reason || 'election'} — polls open day ${electionDay}`);
  },

  campaignTick() {
    const c = this.campaign;
    if (!c) return;
    if (Sim.day > c.electionDay) {
      // the votes were cast yesterday; results are in
      this.elect({ reason: c.reason || 'annual election', candidates: c.candidates });
      if (typeof Tasks !== 'undefined')
        Tasks.done('election' + c.electionDay, true, `${c.reason || 'Election'} held — ${this.leader ? this.leader.name + ' won' : 'votes counted'}`);
      this.campaign = null;
      if (typeof Life !== 'undefined') { Life.rally = null; Life.votingBooths = null; }
      return;
    }
    if (Sim.day === c.electionDay) {
      // VOTING DAY: booths go up outside the town hall, queues form all day
      if (!c.votingDay) {
        c.votingDay = true;
        this.say('🗳️ POLLS ARE OPEN! Villagers are queueing at the voting booths — results tonight.');
        if (typeof Life !== 'undefined') Life.setupVotingBooths(c);
      }
      return;
    }
    // today's rally, rotating through the candidates
    const cand = c.candidates[c.nextRally % c.candidates.length];
    c.nextRally++;
    if (typeof Life !== 'undefined') Life.startRally(cand);
    if (cand.incumbent) {
      const rec = (this.leader && this.leader.built || []).slice(-3);
      this.say(rec.length
        ? `📣 Rally: Mayor ${cand.name} points at the new ${rec.join(', ')} — "four more seasons!"`
        : `📣 Rally: Mayor ${cand.name} asks the village for more time to deliver.`);
    } else {
      this.say(`📣 Rally: ${cand.name} ${cand.type.emoji} promises ${cand.promise}.`);
    }
  },

  shuffledTypes() {
    const types = LEADER_TYPES.slice();
    for (let i = types.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [types[i], types[j]] = [types[j], types[i]];
    }
    return types;
  },

  makeCandidates(includeIncumbent) {
    const voters = this.voters();
    const candidates = [];
    const used = new Set();
    if (includeIncumbent && this.leader) {
      candidates.push({
        name: this.leader.name, type: this.leader.type, personId: this.leader.personId || null,
        incumbent: true,
      });
      if (this.leader.personId) used.add(this.leader.personId);
    }
    const types = this.shuffledTypes();
    const wanted = Math.min(4, Math.max(3, voters.length));
    let cursor = 0;
    while (candidates.length < wanted && cursor < voters.length * 3) {
      const person = voters[(Math.random() * voters.length) | 0];
      const type = types[candidates.length % types.length];
      cursor++;
      if (person && used.has(person.id)) continue;
      if (person) used.add(person.id);
      candidates.push({
        name: this.candidateName(person, candidates.length), type, personId: person ? person.id : null,
        incumbent: false,
      });
    }
    // A small village may have too few distinct adults, but it should still
    // have a genuine choice of platforms.
    while (candidates.length < Math.min(3, LEADER_TYPES.length)) {
      const i = candidates.length;
      candidates.push({ name: LEADER_NAMES[i], type: types[i], personId: null, incumbent: false });
    }
    return candidates;
  },

  candidateScore(voter, candidate, candidateIndex) {
    const quality = this.voterQuality(voter);
    const struggling = civicClamp((55 - quality) / 45, 0, 1);
    const secure = civicClamp((quality - 45) / 45, 0, 1);
    const unemployed = !voter.work;
    // Stable personal leanings derived from a resident's seed.
    const care = 0.65 + ((voter.seed >>> 3) % 37) / 100;
    const enterprise = 0.65 + ((voter.seed >>> 9) % 37) / 100;
    const order = 0.65 + ((voter.seed >>> 15) % 37) / 100;
    const grievance = this.grievanceReport().severity / 100;
    let score = 0;
    switch (candidate.type.kind) {
      case 'visionary':
        score = care * 1.35 + struggling * 1.35 + (unemployed ? 0.4 : 0) + (1 - Sim.safety / 100) * 0.35;
        break;
      case 'business':
        score = enterprise * 1.15 + (unemployed ? 0.85 : 0.25) + secure * 0.35;
        break;
      case 'steady':
        score = order * 1.2 + (1 - Sim.safety / 100) * 0.8 + (this.scandals ? 0.35 : 0);
        break;
      case 'corrupt':
        // Desperate citizens sometimes choose a dangerous shortcut; residents
        // with a good life strongly reject it.
        score = struggling * 1.85 + grievance * 1.1 + enterprise * 0.25 - secure * 1.2 - this.scandals * 0.24;
        break;
      default: score = 0;
    }
    if (candidate.incumbent) {
      // Keeping a leader is earned through daily approval and quality of life.
      score += (this.approval - 48) / 18 + (quality - 50) / 75;
    }
    // A tiny deterministic tie-breaker avoids every similarly situated voter
    // casting the same ballot while keeping outcomes driven by wellbeing.
    score += (((voter.seed + candidateIndex * 7919) % 17) - 8) / 100;
    return score;
  },

  elect(options = {}) {
    const voters = this.voters();
    if (voters.length < 3) return null;
    const former = this.leader;
    const candidates = options.candidates || this.makeCandidates(options.includeIncumbent !== false);
    const votes = new Array(candidates.length).fill(0);
    for (const voter of voters) {
      let choice = 0;
      let best = -Infinity;
      for (let i = 0; i < candidates.length; i++) {
        const score = this.candidateScore(voter, candidates[i], i);
        if (score > best) { best = score; choice = i; }
      }
      votes[choice]++;
    }
    let winnerIndex = 0;
    for (let i = 1; i < votes.length; i++) if (votes[i] > votes[winnerIndex]) winnerIndex = i;
    const winner = candidates[winnerIndex];
    const share = voters.length ? Math.round(votes[winnerIndex] / voters.length * 100) : 0;
    const reelected = !!former && winner.incumbent;
    this.leader = {
      name: winner.name,
      type: winner.type,
      personId: winner.personId,
      electedDay: Sim.day,
      term: reelected ? (former.term || 1) + 1 : 1,
      voteShare: share,
      promise: winner.promise || null,
      built: reelected ? (former.built || []) : [],
    };
    this.lastElection = Sim.day;
    this.scandals = reelected ? Math.max(0, this.scandals - 1) : 0;
    // a voted-out mayor clears their desk at the town hall
    if (former && former.personId && former.personId !== winner.personId) {
      const oldP = Sim.people.find(q => q.id === former.personId);
      if (oldP && oldP.work && oldP.work.type === 'townhall') {
        oldP.work.workers = oldP.work.workers.filter(w => w !== oldP);
        oldP.work = null;
        Sim.assignJobs();
      }
    }
    this.approval = civicClamp(Math.round(this.civicQuality() * 0.68 + share * 0.22), 18, 88);
    this.election = {
      day: Sim.day,
      reason: options.reason || 'annual election',
      total: voters.length,
      winner: winner.name,
      share,
      candidates: candidates.map((c, i) => ({ name: c.name, kind: c.type.kind, votes: votes[i] })),
    };
    if (!former) this.say(`🗳️ ${winner.name} was elected mayor with ${share}% of the village vote — ${winner.type.label} ${winner.type.emoji}`);
    else if (reelected) this.say(`🗳️ Election day: Mayor ${winner.name} kept the trust of the village (${share}% of votes).`);
    else this.say(`🗳️ Election day: ${former.name} was voted out. ${winner.name} won with ${share}% of votes.`);
    // victory celebration outside the town hall
    if (typeof Life !== 'undefined') {
      const hall = World.buildings.find(b => b.type === 'townhall' && !b.ruined) ||
                   World.buildings.find(b => b.connected && !b.ruined);
      if (hall) Life.celebrate(hall.x * T + hall.w * 8, hall.y * T + hall.h * 16, winner.color);
    }
    return { winner, share, reelected, candidates, votes };
  },

  leaderStillLivesHere() {
    if (!this.leader || !this.leader.personId) return true;
    return this.voters().some(p => p.id === this.leader.personId);
  },

  collectTaxes() {
    let tax = 0;
    for (const b of World.buildings) {
      if (!CAT[b.type].res || b.ruined || !b.residents.length || b.funds <= 12) continue;
      const contribution = Math.min(2, Math.max(0, b.funds - 10));
      b.funds -= contribution;
      tax += contribution;
    }
    const skimmed = tax * this.leader.type.skim;
    this.treasury += tax - skimmed;
    if (this.leader.type.kind === 'corrupt' && (skimmed > 0 || Math.random() < 0.12) && Math.random() < 0.32) {
      this.scandals++;
      this.say('🧾 Auditors report town funds missing… again.');
    }
  },

  updateApproval() {
    const quality = this.civicQuality();
    const grievances = this.grievanceReport();
    const target = quality + Math.min(12, this.recentBuilds * 4) - this.scandals * 7 - grievances.severity * 0.13;
    this.approval += (target - this.approval) * 0.32;
    this.approval = civicClamp(this.approval, 5, 95);
    this.recentBuilds = Math.max(0, this.recentBuilds - 0.35);
  },

  /* Called once at the beginning of every in-game day. */
  dayTick() {
    this.maybeFirstElection();
    this.campaignTick(); // rallies during the campaign week; the vote on election day
    // Communities still help each other before a formal government exists.
    this.communityTick();
    if (!this.leader) return;
    if (!this.leaderStillLivesHere()) {
      this.forceResign('after leaving the village');
      return;
    }
    // one week before the term ends, campaign season opens
    if (!this.campaign && Sim.day - this.lastElection >= ELECTION_PERIOD - CAMPAIGN_DAYS)
      this.startCampaign(this.lastElection + ELECTION_PERIOD, true, 'annual election');
    this.collectTaxes();
    this.updateApproval();
    this.ensureOffice();

    const L = this.leader;
    // an emergency (fire, crime wave) forces an emergency session; otherwise
    // how often the mayor acts depends on their personality
    const urgentNow = this.assessNeedsList().some(n => n === 'fire' || n === 'police');
    // once the town is big enough for a railway, the treasury saves up for it
    const savingForRail = Sim.people.length >= 45 && this.countOf('trainstation') === 0 && this.treasury < 1300;
    if (Math.random() < (urgentNow ? 0.85 : 0.36 * L.type.zeal) && !(savingForRail && !urgentNow && Math.random() < 0.65))
      this.spend();
    this.planRailways();
    this.consolidateServices();

    if (this.riotCd > 0) this.riotCd--;
  },

  /* ---------- the railway programme ----------
     A growing town's government plans real infrastructure: it places
     stations by the districts that need them and lays the track itself,
     bridging rivers on trestles and crossing roads on the way. */
  planRailways() {
    const pop = Sim.people.length;
    if (pop < 40 || Sim.day < (this.nextRailDay || 0)) return;
    this.nextRailDay = Sim.day + 3;
    const cost = CIVIC_COSTS.trainstation;
    const stations = World.buildings.filter(b => b.type === 'trainstation' && !b.ruined);
    const anchor = st => { // a free (or already-railed) tile beside the station
      for (let j = -1; j <= st.h; j++) for (let i = -1; i <= st.w; i++) {
        if (i >= 0 && i < st.w && j >= 0 && j < st.h) continue;
        const x = st.x + i, y = st.y + j;
        if (World.inB(x, y) && World.railEnterCost(x, y) !== Infinity) return { x, y };
      }
      return null;
    };
    // phase 1: the first line — a central station and one for the far district
    // (also rescues a lone station left stranded by an earlier failed attempt)
    if (stations.length < 2) {
      if (this.treasury < cost * (2 - stations.length) + 300) return;
      const c = this.townCenter();
      const far = World.buildings.reduce((best, b) => {
        if (b.ruined || !b.connected || b.type === 'trainstation') return best;
        const d = Math.abs(b.x - c.x) + Math.abs(b.y - c.y);
        return (!best || d > best.d) ? { b, d } : best;
      }, null);
      if (!far || far.d < 34) return; // town still too compact for a railway
      let bA = stations[0] || null;
      if (!bA) {
        const sA = World.findPlannedSpot('trainstation', c);
        if (!sA) return;
        bA = World.placeBuilding('trainstation', sA.x, sA.y);
        if (!bA) return;
        this.treasury -= cost;
      }
      const sB = World.findPlannedSpot('trainstation', { x: far.b.x, y: far.b.y });
      const bB = sB ? World.placeBuilding('trainstation', sB.x, sB.y) : null;
      if (!bB) { World.refreshConnections(); return; }
      this.treasury -= cost;
      const aA = anchor(bA), aB = anchor(bB);
      if (aA && aB) {
        const laid = World.connectRail(aA.x, aA.y, aB.x, aB.y);
        if (laid >= 0) {
          this.treasury = Math.max(0, this.treasury - laid * 2);
          this.recentBuilds += 2;
          this.say(`🛤️ Railway programme! Mayor ${this.leader.name} is building two stations and laying track out to the ${this.districtName(sB.x, sB.y)}.`);
          if (typeof Tasks !== 'undefined') Tasks.add('railway1', '🛤️', 'Open the first railway line');
          if (typeof Life !== 'undefined') Life.trainT = 0;
        }
      }
      World.refreshConnections();
      return;
    }
    // phase 2: any station standing without track gets connected to the line
    const hasRail = st => {
      for (let j = -1; j <= st.h; j++) for (let i = -1; i <= st.w; i++) {
        if (i >= 0 && i < st.w && j >= 0 && j < st.h) continue;
        if (World.isRail(st.x + i, st.y + j)) return true;
      }
      return false;
    };
    const railless = stations.filter(st => !hasRail(st));
    const railed = stations.filter(st => hasRail(st));
    if (railless.length && railed.length) {
      const st = railless[0], other = railed[0];
      const aA = anchor(st), aB = anchor(other);
      if (aA && aB) {
        const laid = World.connectRail(aA.x, aA.y, aB.x, aB.y);
        if (laid >= 0) {
          this.treasury = Math.max(0, this.treasury - laid * 2);
          this.say(`🛤️ Track crews connected the ${this.districtName(st.x, st.y)} station to the main line.`);
          if (typeof Life !== 'undefined') Life.trainT = 0;
        }
      }
      return;
    }
    // phase 3: a busy district far from every station earns a stop of its own
    if (this.treasury < cost + 250 || stations.length >= 4) return;
    const remote = [];
    for (const b of World.buildings) {
      if (b.ruined || !b.connected) continue;
      let near = 99;
      for (const st of stations) near = Math.min(near, Math.abs(b.x - st.x) + Math.abs(b.y - st.y));
      if (near > 40) remote.push(b);
    }
    if (remote.length < 8) return;
    let sx = 0, sy = 0;
    for (const b of remote) { sx += b.x; sy += b.y; }
    const target = { x: Math.round(sx / remote.length), y: Math.round(sy / remote.length) };
    const spot = World.findPlannedSpot('trainstation', target);
    if (!spot) return;
    const nb = World.placeBuilding('trainstation', spot.x, spot.y);
    if (!nb) return;
    this.treasury -= cost;
    const aA = anchor(nb);
    let best = null, bd = 1e9;
    for (let i = 0; i < World.railMap.length; i++) {
      if (!World.railMap[i]) continue;
      const x = i % GW, y = (i / GW) | 0;
      const d = Math.abs(x - spot.x) + Math.abs(y - spot.y);
      if (d < bd) { bd = d; best = { x, y }; }
    }
    if (aA && best) {
      const laid = World.connectRail(aA.x, aA.y, best.x, best.y);
      if (laid >= 0) {
        this.treasury = Math.max(0, this.treasury - laid * 2);
        this.say(`🚉 New rail link! The ${this.districtName(spot.x, spot.y)} is joining the railway network — far places, connected.`);
        if (typeof Life !== 'undefined') Life.trainT = 0;
      }
    }
    World.refreshConnections();
  },

  /* Everything the village currently lacks, most pressing first. Tracking a
     LIST (not just the top item) lets patience build up about several things
     at once, the way real neighbours grumble about more than one problem. */
  assessNeedsList() {
    const stats = Sim.stats();
    const pop = Sim.people.length;
    const kids = Sim.people.filter(p => p.kind === 'kid').length;
    const parks = World.buildings.filter(b => ['park', 'playground', 'grandpark', 'plaza'].includes(b.type) && !b.ruined).length;
    const needs = [];
    const underCon = t => World.buildings.some(b => b.type === t && b.construction > 0 && !b.ruined);
    // a single fire is remembered long enough for the village to act on it
    if (typeof Life !== 'undefined' && Life.firesRecent >= 0.5 && !this.hasPlanned('fire')) needs.push('fire');
    if (typeof Life !== 'undefined' && Life.crimes >= 2 && !this.hasPlanned('police')) needs.push('police');
    // a growing city needs a station in EVERY district, not just one downtown
    // — but never more stations than a town this size can staff
    for (const svc of ['police', 'fire']) {
      const cap = 1 + Math.floor(pop / 90);
      if (this.hasPlanned(svc) && !underCon(svc) && this.countOf(svc) < cap && this.coverageGap(svc)) needs.push(svc);
    }
    if (this.leader && !this.hasPlanned('townhall')) needs.push('townhall');
    if (kids >= 4 && !this.hasPlanned('school')) needs.push('school');
    // crowded classrooms → a second school across town
    const schools = World.buildings.filter(b => b.type === 'school' && !b.ruined).length;
    if (schools >= 1 && kids > schools * 14 && !underCon('school')) needs.push('school');
    // serious crime demands a courthouse
    if (typeof Life !== 'undefined' && (Life.arrests >= 3 || Life.graveCases > 0) && !this.hasPlanned('courthouse'))
      needs.push('courthouse');
    // housing pressure: no vacancies while jobs go begging → build homes
    const resUnderCon = World.buildings.some(b => CAT[b.type].res && b.construction > 0 && !b.ruined);
    if (!resUnderCon && stats.vacant === 0 && stats.demand.r > 0.4)
      needs.push(pop >= 30 ? 'apartment' : 'house');
    if (pop >= 8 && !['shop', 'market', 'mall', 'deptstore'].some(t => this.hasPlanned(t))) needs.push('shop');
    if (pop >= 45 && !this.hasPlanned('hospital')) needs.push('hospital');
    if (pop >= 55 && !this.hasPlanned('market')) needs.push('market');
    if (pop >= 70 && !this.hasPlanned('deptstore')) needs.push('deptstore');
    // public transport grows with the town
    const stops = World.buildings.filter(b => b.type === 'busstop' && !b.ruined).length;
    if (pop >= 16 && stops < Math.min(6, Math.floor(pop / 18)) && !underCon('busstop')) needs.push('busstop');
    if (pop >= 32 && !this.hasPlanned('taxistand')) needs.push('taxistand');
    if (pop >= 28 && !this.hasPlanned('postoffice')) needs.push('postoffice');
    if (pop >= 45 && typeof Life !== 'undefined' && Life.waterTiles.length > 45 && !this.hasPlanned('dock')) needs.push('dock');
    if (pop >= 85 && !this.hasPlanned('heliport')) needs.push('heliport');
    // green space: parks first, then a proper grand park and a plaza
    if (parks < Math.floor(pop / 20)) needs.push('park');
    if (pop >= 40 && !this.hasPlanned('plaza')) needs.push('plaza');
    if (pop >= 55 && !this.hasPlanned('grandpark')) needs.push('grandpark');
    // food security: the village must grow what it eats
    const farms = World.buildings.filter(b => b.type === 'farm' && !b.ruined).length;
    if (pop >= 18 && farms < Math.max(1, Math.ceil(pop / 40)) && !underCon('farm')) needs.push('farm');
    // utilities: running water, then electric light
    if (pop >= 26 && !this.hasPlanned('watertower')) needs.push('watertower');
    if (pop >= 38 && !this.hasPlanned('powerplant')) needs.push('powerplant');
    // learning, faith & culture as the town matures
    if (pop >= 35 && !this.hasPlanned('temple')) needs.push('temple');
    if (pop >= 58 && !this.hasPlanned('college')) needs.push('college');
    if (pop >= 48 && !this.hasPlanned('cinema')) needs.push('cinema');
    if (pop >= 64 && !this.hasPlanned('museum')) needs.push('museum');
    if (pop >= 70 && !this.hasPlanned('theater')) needs.push('theater');
    // big-ticket dreams for a real town
    if (pop >= 75 && !this.hasPlanned('amusement')) needs.push('amusement');
    if (pop >= 90 && !this.hasPlanned('stadium')) needs.push('stadium');
    if (pop >= 120 && !this.hasPlanned('airport')) needs.push('airport');
    // media & finance
    if (pop >= 40 && !this.hasPlanned('tvstation')) needs.push('tvstation');
    if (pop >= 78 && !this.hasPlanned('exchange')) needs.push('exchange');
    // a JOBS PROGRAMME: idle hands demand industry — and always a KIND the
    // town doesn't have yet, so work & industry fills out over time
    const jobless = Math.max(0, stats.adults - stats.employed);
    if (jobless > 8) {
      const industry = ['factory', 'sawmill', 'warehouse', 'brickworks', 'textilemill', 'cannery', 'glassworks', 'steelworks'];
      const freshInd = industry.filter(k => !this.hasPlanned(k));
      if (freshInd.length) needs.push(freshInd[Sim.day % freshInd.length]);
      else if (!underCon('factory') && this.countOf('factory') < 1 + Math.floor(pop / 120)) needs.push('factory');
    }
    // main street should carry every trade — fill the gaps one by one
    if (pop >= 30) {
      const trades = ['bakery', 'cafe', 'pharmacy', 'butcher', 'barber', 'bookshop', 'hardware',
        'florist', 'restaurant', 'gas', 'furniture', 'electronics', 'laundry', 'autoshop'];
      const missing = trades.filter(k => !this.hasPlanned(k));
      if (missing.length && Math.random() < 0.5) needs.push(missing[Sim.day % missing.length]);
    }
    return needs;
  },

  assessNeeds() { return this.assessNeedsList()[0] || null; },

  spend() {
    if (!this.leader) return false;
    const L = this.leader;
    const urgent = this.assessNeeds();
    let key = urgent;
    const ignoresNeed = L.type.kind === 'corrupt' ? Math.random() < 0.74 :
      L.type.kind === 'business' ? Math.random() < 0.25 : false;
    if (!key || ignoresNeed) {
      const choices = L.type.builds.filter(k =>
        this.countOf(k) < Math.min(this.civicCap(k), CAT[k].jobs ? 2 : 99));
      // variety IS strategy: strongly prefer giving the town something it has none of
      const fresh = choices.filter(k => this.countOf(k) === 0);
      const pool = fresh.length && Math.random() < 0.7 ? fresh : choices;
      key = pool.length ? pool[(Math.random() * pool.length) | 0] : null;
    }
    if (!key) return false;
    if (this.countOf(key) >= this.civicCap(key)) return false; // the hard rule
    const cost = CIVIC_COSTS[key] || STARTUP_COSTS[key] || 220;
    if (this.treasury < cost) return false;
    // a station built to close a coverage gap goes INTO the underserved district
    const target = COVERAGE_RADIUS[key] && this.hasPlanned(key) ? this.coverageGap(key) : null;
    const spot = World.findPlannedSpot(key, target);
    if (!spot) return false;
    const b = World.placeBuilding(key, spot.x, spot.y);
    if (!b) return false;
    this.treasury -= cost;
    this.recentBuilds += urgent === key ? 1.5 : 0.8;
    this.unmetNeeds[key] = 0;
    L.built = (L.built || []).concat(CAT[key].name).slice(-8); // the record they run on
    World.refreshConnections();
    this.say(target
      ? `🏛️ Mayor ${L.name} approved a second ${CAT[key].name} for the underserved ${this.districtName(spot.x, spot.y)}.`
      : `🏛️ Mayor ${L.name} approved a new ${CAT[key].name}.`);
    return true;
  },

  countOf(type) { return World.buildings.filter(b => b.type === type && !b.ruined).length; },

  /* HARD RULE: how many of each civic building this town may ever run.
     Landmarks stay unique, services scale with population, private
     commerce may multiply freely. Every public build path checks this. */
  civicCap(key) {
    const pop = Sim.people.length;
    const UNIQUE = ['townhall', 'courthouse', 'airport', 'stadium', 'amusement', 'zoo', 'grandpark',
      'college', 'exchange', 'tvstation', 'museum', 'theater', 'powerplant', 'heliport', 'casino', 'mall'];
    if (UNIQUE.includes(key)) return 1;
    switch (key) {
      case 'police': case 'fire': return 1 + Math.floor(pop / 90);
      case 'school': return 1 + Math.floor(pop / 80);
      case 'hospital': return 1 + Math.floor(pop / 150);
      case 'watertower': return 1 + Math.floor(pop / 200);
      case 'temple': case 'cinema': case 'library': case 'postoffice': return 1 + Math.floor(pop / 160);
      case 'park': return Math.max(2, Math.floor(pop / 20));
      case 'plaza': case 'playground': case 'pool': case 'gym': return 1 + Math.floor(pop / 120);
      case 'busstop': return Math.min(8, 1 + Math.floor(pop / 40));
      case 'taxistand': return 1 + Math.floor(pop / 120);
      case 'trainstation': return 4;
      case 'dock': return 2;
      case 'farm': return Math.max(1, Math.ceil(pop / 40));
      default: return 99;
    }
  },

  /* the hard rule applied retroactively: a town that somehow over-built a
     service closes the surplus, one review per day, and recovers funds */
  consolidateServices() {
    for (const key of ['police', 'fire', 'school', 'hospital', 'watertower']) {
      const cap = this.civicCap(key) + 1;
      const list = World.buildings.filter(b => b.type === key && !b.ruined);
      if (list.length <= cap) continue;
      const surplus = list.sort((a, b) => b.id - a.id)[0]; // the newest closes first
      World.removeBuilding(surplus);
      Sim.onBuildingRemoved(surplus);
      World.refreshConnections();
      this.treasury += Math.round((CIVIC_COSTS[key] || 200) * 0.4);
      this.say(`🏛️ Budget review: a surplus ${CAT[key].name} was decommissioned — one per district is plenty. Funds recovered.`);
      return;
    }
  },

  /* ---------- the mayor's office ----------
     An elected mayor needs a town hall: the treasury pays if it can, the
     village pools funds if it can't, and the mayor then works there daily. */
  ensureOffice() {
    const hall = this.activeBuildings('townhall')[0];
    if (hall) { this.assignLeaderOffice(hall); return; }
    if (this.hasPlanned('townhall')) return; // already under construction
    this.officeTimer = (this.officeTimer || 0) + 1;
    if (this.officeTimer < 2) return;
    const cost = CIVIC_COSTS.townhall;
    if (this.treasury >= cost) {
      const spot = World.findPlannedSpot('townhall');
      if (!spot) return;
      const b = World.placeBuilding('townhall', spot.x, spot.y);
      if (!b) return;
      this.treasury -= cost;
      this.recentBuilds += 0.5;
      World.refreshConnections();
      this.say(`🏛️ Work starts on the mayor's office — Mayor ${this.leader.name} needs a desk.`);
    } else {
      this.communityBuild('townhall', false); // neighbours chip in for their town hall
    }
  },

  assignLeaderOffice(hall) {
    if (!this.leader || !this.leader.personId) return;
    const p = Sim.people.find(q => q.id === this.leader.personId);
    if (!p || p.work === hall) return;
    if (p.work) p.work.workers = p.work.workers.filter(w => w !== p);
    p.work = hall;
    hall.workers.push(p);
    this.say(`🎩 Mayor ${this.leader.name} moved into the office at the Town Hall.`);
  },

  /* Villagers pool savings after giving town hall several days to act.
     Needs age in parallel, so a new emergency no longer resets the village's
     patience about everything else (that bug froze all self-building). */
  communityTick() {
    const needs = this.assessNeedsList();
    for (const key of Object.keys(this.needTimers))
      if (!needs.includes(key)) {
        if (this.needTimers[key] >= 2 && typeof Tasks !== 'undefined')
          Tasks.done('need-' + key, true, `Village need met: ${CAT[key] ? CAT[key].name : key}`);
        this.needTimers[key] = 0; this.unmetNeeds[key] = 0;
      }
    for (const need of needs) {
      if (World.buildings.some(b => b.type === need && b.construction > 0)) {
        if (this.needTimers[need] >= 2 && typeof Tasks !== 'undefined')
          Tasks.done('need-' + need, true, `Village need met: ${CAT[need].name} under construction`);
        this.needTimers[need] = 0; this.unmetNeeds[need] = 0;
        continue;
      }
      this.needTimers[need] = (this.needTimers[need] || 0) + 1;
      this.unmetNeeds[need] = (this.unmetNeeds[need] || 0) + 1;
      if (this.needTimers[need] === 2 && typeof Tasks !== 'undefined')
        Tasks.add('need-' + need, '🏛️', `The village needs a ${CAT[need].name.toLowerCase()}`);
    }
    // one community project a day, most pressing ripe need first — emergencies
    // (fires, crime waves) exhaust patience with town hall fastest
    for (const need of needs) {
      const urgent = need === 'fire' || need === 'police';
      if ((this.needTimers[need] || 0) < (urgent ? 2 : 3)) continue;
      if (this.communityBuild(need, urgent)) return true;
    }
    return false;
  },

  communityBuild(need, urgent) {
    if (this.countOf(need) >= this.civicCap(need)) return false; // the hard rule
    const cost = CIVIC_COSTS[need] || STARTUP_COSTS[need] || 220;
    const homes = World.buildings.filter(b => CAT[b.type].res && b.residents.length && b.funds > 8 && !b.ruined);
    const pool = homes.reduce((sum, b) => sum + b.funds, 0);
    if (pool < cost * (urgent ? 1.0 : 1.15)) return false; // a poor village needs time to save
    const target = COVERAGE_RADIUS[need] && this.hasPlanned(need) ? this.coverageGap(need) : null;
    const spot = World.findPlannedSpot(need, target);
    if (!spot) return false;
    const b = World.placeBuilding(need, spot.x, spot.y);
    if (!b) return false;
    let due = cost;
    for (const home of homes) {
      const share = Math.min(home.funds * 0.4, due / homes.length + 6);
      home.funds -= share;
      due -= share;
      if (due <= 0) break;
    }
    World.refreshConnections();
    this.needTimers[need] = 0;
    this.unmetNeeds[need] = 0;
    if (this.leader && need !== 'townhall') this.approval = Math.max(5, this.approval - 6); // public embarrassment has a cost
    const lead = homes[0] && homes[0].residents[0] ? `, led by the ${homes[0].residents[0].surname}s` : '';
    this.say(`🤝 Tired of waiting, villagers pooled their savings to build a ${CAT[need].name} themselves${lead}!`);
    return true;
  },

  forceResign(reason) {
    if (!this.leader) return;
    const former = this.leader;
    this.leader = null;
    this.campaign = null; // any running campaign is overtaken by events
    this.say(`📜 Mayor ${former.name} resigned ${reason} — snap election!`);
    this.elect({ reason: 'snap election', includeIncumbent: false });
  },

  serialize() {
    return {
      leader: this.leader ? {
        name: this.leader.name,
        kind: this.leader.type.kind,
        personId: this.leader.personId || null,
        electedDay: this.leader.electedDay || this.lastElection,
        term: this.leader.term || 1,
        voteShare: this.leader.voteShare || 0,
        promise: this.leader.promise || null,
        built: this.leader.built || [],
      } : null,
      treasury: Math.round(this.treasury),
      approval: Math.round(this.approval),
      lastElection: this.lastElection,
      scandals: this.scandals,
      needTimers: this.needTimers,
      unmetNeeds: this.unmetNeeds,
      riotCd: this.riotCd,
      election: this.election,
    };
  },

  restore(saved) {
    if (!saved) return;
    // Accept the short-lived pre-integration save shape as well.
    const g = saved.leader === undefined && saved.kind ? { leader: saved, ...saved } : saved;
    const leader = g.leader;
    if (leader) {
      const type = LEADER_TYPES.find(t => t.kind === leader.kind) || LEADER_TYPES[0];
      this.leader = {
        name: leader.name,
        type,
        personId: leader.personId || null,
        electedDay: leader.electedDay || g.lastElection || Sim.day,
        term: leader.term || 1,
        voteShare: leader.voteShare || 0,
        promise: leader.promise || null,
        built: leader.built || [],
      };
    }
    this.campaign = null; // campaigns restart on their own if the window is still open
    this.treasury = g.treasury || 0;
    this.approval = g.approval || 55;
    this.lastElection = g.lastElection || Sim.day;
    this.scandals = g.scandals || 0;
    this.needTimers = g.needTimers || {};
    this.unmetNeeds = g.unmetNeeds || {};
    this.riotCd = g.riotCd || 0;
    this.election = g.election || null;
  },
};
