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
    builds: ['park', 'school', 'library', 'playground', 'hospital', 'pool'],
  },
  {
    kind: 'business', emoji: '📈', zeal: 1.05, skim: 0.08,
    label: 'a sharp business mind',
    builds: ['shop', 'market', 'office', 'factory', 'mall', 'bank'],
  },
  {
    kind: 'steady', emoji: '🧱', zeal: 0.8, skim: 0.03,
    label: 'a careful, dependable planner',
    builds: ['fire', 'police', 'school', 'park', 'library'],
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
  factory: 340, mall: 480, bank: 300,
};

const civicClamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

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
  },

  say(message) { if (typeof Life !== 'undefined') Life.say(message); },

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
    if (!this.leader && this.voters().length >= 6) {
      this.elect({ reason: 'first election', includeIncumbent: false });
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
    const candidates = this.makeCandidates(options.includeIncumbent !== false);
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
    };
    this.lastElection = Sim.day;
    this.scandals = reelected ? Math.max(0, this.scandals - 1) : 0;
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
    // Communities still help each other before a formal government exists.
    this.communityTick();
    if (!this.leader) return;
    if (!this.leaderStillLivesHere()) {
      this.forceResign('after leaving the village');
      return;
    }
    this.collectTaxes();
    this.updateApproval();

    const L = this.leader;
    if (Math.random() < 0.36 * L.type.zeal) this.spend();

    if (Sim.day - this.lastElection >= ELECTION_PERIOD) this.runElection();
    if (this.riotCd > 0) this.riotCd--;
  },

  assessNeeds() {
    const pop = Sim.people.length;
    const kids = Sim.people.filter(p => p.kind === 'kid').length;
    const parks = World.buildings.filter(b => (b.type === 'park' || b.type === 'playground') && !b.ruined).length;
    if (typeof Life !== 'undefined' && Life.firesRecent >= 2 && !this.hasPlanned('fire')) return 'fire';
    if (typeof Life !== 'undefined' && Life.crimes >= 2 && !this.hasPlanned('police')) return 'police';
    if (kids >= 4 && !this.hasPlanned('school')) return 'school';
    if (pop >= 45 && !this.hasPlanned('hospital')) return 'hospital';
    if (parks < Math.floor(pop / 22)) return 'park';
    return null;
  },

  spend() {
    if (!this.leader) return false;
    const L = this.leader;
    const urgent = this.assessNeeds();
    let key = urgent;
    const ignoresNeed = L.type.kind === 'corrupt' ? Math.random() < 0.74 :
      L.type.kind === 'business' ? Math.random() < 0.25 : false;
    if (!key || ignoresNeed) {
      const choices = L.type.builds.filter(k => !(CAT[k].jobs && this.countOf(k) >= 2));
      key = choices.length ? choices[(Math.random() * choices.length) | 0] : null;
    }
    if (!key) return false;
    const cost = CIVIC_COSTS[key] || 220;
    if (this.treasury < cost) return false;
    const spot = World.findBuildSpot(key);
    if (!spot) return false;
    const b = World.placeBuilding(key, spot.x, spot.y);
    if (!b) return false;
    this.treasury -= cost;
    this.recentBuilds += urgent === key ? 1.5 : 0.8;
    this.unmetNeeds[key] = 0;
    World.refreshConnections();
    this.say(`🏛️ Mayor ${L.name} approved a new ${CAT[key].name}.`);
    return true;
  },

  countOf(type) { return World.buildings.filter(b => b.type === type && !b.ruined).length; },

  /* Villagers pool savings after giving town hall several days to act. */
  communityTick() {
    const need = this.assessNeeds();
    for (const key of Object.keys(this.needTimers)) if (key !== need) this.needTimers[key] = 0;
    for (const key of Object.keys(this.unmetNeeds)) if (key !== need) this.unmetNeeds[key] = 0;
    if (!need) return false;
    if (World.buildings.some(b => b.type === need && b.construction > 0)) {
      this.needTimers[need] = 0;
      this.unmetNeeds[need] = 0;
      return false;
    }
    this.needTimers[need] = (this.needTimers[need] || 0) + 1;
    this.unmetNeeds[need] = (this.unmetNeeds[need] || 0) + 1;
    // Emergencies (fires, crime waves) exhaust patience with town hall faster
    // than quality-of-life wishes do.
    const urgent = need === 'fire' || need === 'police';
    if (this.needTimers[need] < (urgent ? 2 : 3)) return false; // first, wait for elected government
    const cost = CIVIC_COSTS[need] || 220;
    const homes = World.buildings.filter(b => CAT[b.type].res && b.residents.length && b.funds > 8 && !b.ruined);
    const pool = homes.reduce((sum, b) => sum + b.funds, 0);
    if (pool < cost * (urgent ? 1.0 : 1.2)) return false; // a poor village needs time to save
    const spot = World.findBuildSpot(need);
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
    if (this.leader) this.approval = Math.max(5, this.approval - 6); // public embarrassment has a cost
    this.say(`🤝 Tired of waiting, villagers pooled their savings to build a ${CAT[need].name} themselves!`);
    return true;
  },

  runElection() {
    return this.elect({ reason: 'annual election', includeIncumbent: true });
  },

  forceResign(reason) {
    if (!this.leader) return;
    const former = this.leader;
    this.leader = null;
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
      };
    }
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
