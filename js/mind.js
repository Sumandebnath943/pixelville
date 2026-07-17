/* ============================================================
   PixelVille — the villager mind: knowledge, memory, decisions.

   KNOWLEDGE  — a villager only knows the places they've been,
                heard about from a friend in the street, or seen
                on PVTV. New shops spread by word of mouth.
   MEMORY     — an episodic diary per person: fires, jackpots,
                weddings, failures, promotions. Memories fade,
                but strong ones linger — and change behaviour.
   DECISIONS  — venues are CHOSEN, not rolled: taste, price,
                distance, curiosity, friends and old scars all
                weigh in. Ambitious workers hunt better jobs,
                the burned avoid the place that burned them, and
                friends bring each other along for the evening.
   ============================================================ */
'use strict';

const Mind = {
  /* every villager gets a personality (from their seed) and an empty head */
  init(p) {
    const R = mulberry32(p.seed * 7 + 11);
    p.mind = {
      knows: new Set(),      // building ids this person has heard of
      memories: [],          // {day, kind, text, feel(-2..2), venueId}
      friends: new Map(),    // personId -> bond 0..1
      favorites: new Map(),  // buildingId -> affinity 0..6
      flags: {},             // one-time story flags
      traits: {
        social: 0.25 + R() * 0.7,     // seeks company, makes friends fast
        caution: 0.2 + R() * 0.7,     // remembers danger, avoids risk
        ambition: 0.2 + R() * 0.75,   // hunts promotions & better jobs
        thrift: 0.2 + R() * 0.7,      // weighs every price tag
        curiosity: 0.25 + R() * 0.7,  // tries new places unprompted
      },
    };
    // you grow up knowing your own neighbourhood
    for (const b of World.buildings)
      if (Math.abs(b.x - p.home.x) + Math.abs(b.y - p.home.y) < 18) p.mind.knows.add(b.id);
  },
  ensure(p) { if (!p.mind) this.init(p); return p.mind; },

  /* ---------- memory ---------- */
  remember(p, kind, text, feel, venueId) {
    const m = this.ensure(p);
    m.memories.push({ day: Sim.day, kind, text, feel, venueId: venueId || 0 });
    if (m.memories.length > 14) m.memories.shift();
  },
  /* net feeling of the last few days' memories — colours the mood */
  recentFeel(p, days) {
    const m = this.ensure(p);
    let s = 0;
    for (const mem of m.memories) if (Sim.day - mem.day <= (days || 5)) s += mem.feel;
    return s;
  },
  /* a fresh bad memory tied to a place keeps a cautious soul away */
  fears(p, venueId) {
    const m = this.ensure(p);
    if (!m.memories.length) return false;
    return m.memories.some(mem => mem.venueId === venueId && mem.feel < 0 &&
      Sim.day - mem.day < 6 + m.traits.caution * 10);
  },
  /* memories fade overnight; only the strong ones stay for good */
  reflect(p) {
    const m = this.ensure(p);
    if (m.memories.length) m.memories = m.memories.filter(mm => Sim.day - mm.day < 20 || Math.abs(mm.feel) >= 2);
    for (const [id, v] of m.friends) { // friendships cool without contact
      const nv = v - 0.008;
      if (nv <= 0) m.friends.delete(id); else m.friends.set(id, nv);
    }
  },

  /* ---------- knowledge ---------- */
  learnPlace(p, b) { this.ensure(p).knows.add(b.id); },
  knowsPlace(p, b) { return this.ensure(p).knows.has(b.id); },
  /* a new building opens: neighbours learn of it; PVTV tells the whole town */
  announcePlace(b) {
    const tv = World.buildings.some(q => q.type === 'tvstation' && q.connected && !q.construction && !q.ruined);
    for (const p of Sim.people) {
      if (tv || Math.abs(p.home.x - b.x) + Math.abs(p.home.y - b.y) < 24 || Math.random() < 0.15)
        this.ensure(p).knows.add(b.id);
    }
  },

  /* ---------- taste & friendship ---------- */
  enjoy(p, b, amt) {
    const m = this.ensure(p);
    m.favorites.set(b.id, Math.min(6, (m.favorites.get(b.id) || 0) + amt));
    if ((m.favorites.get(b.id) || 0) >= 4 && !m.flags['fav' + b.id]) {
      m.flags['fav' + b.id] = true;
      if (Math.random() < 0.25 && typeof Life !== 'undefined')
        Life.say(`💚 ${Sim.fullName(p)} has become a regular at the ${CAT[b.type].name} — "my usual spot"`);
    }
  },
  bond(a, b, amt) {
    const ma = this.ensure(a), mb = this.ensure(b);
    const na = Math.min(1, (ma.friends.get(b.id) || 0) + amt);
    ma.friends.set(b.id, na);
    mb.friends.set(a.id, Math.min(1, (mb.friends.get(a.id) || 0) + amt));
    if (na >= 0.5 && !ma.flags['bff' + b.id]) {
      ma.flags['bff' + b.id] = mb.flags['bff' + a.id] = true;
      if (Math.random() < 0.35 && typeof Life !== 'undefined')
        Life.say(`🤝 ${Sim.fullName(a)} and ${Sim.fullName(b)} have become firm friends`);
    }
  },
  friendCount(p) {
    let n = 0;
    for (const v of this.ensure(p).friends.values()) if (v >= 0.5) n++;
    return n;
  },
  friendsOf(p) {
    const out = [];
    for (const [id, v] of this.ensure(p).friends) {
      if (v < 0.5) continue;
      const q = Sim.people.find(o => o.id === id);
      if (q) out.push(q);
    }
    return out;
  },

  /* two villagers meet in the street: bonds deepen, tips and news change hands */
  gossip(a, b) {
    this.bond(a, b, a.kind === 'kid' || b.kind === 'kid' ? 0.05 : 0.12);
    if (a.kind === 'kid' || b.kind === 'kid') return;
    const share = (from, to) => {
      const mf = this.ensure(from), mt = this.ensure(to);
      for (const id of mf.knows) { // "have you tried the new place?"
        if (mt.knows.has(id) || Math.random() < 0.5) continue;
        mt.knows.add(id);
        const bld = World.buildings.find(q => q.id === id);
        if (bld && Math.random() < 0.03 && typeof Life !== 'undefined')
          Life.say(`🗣️ ${Sim.fullName(from)} told ${Sim.fullName(to)} about the ${CAT[bld.type].name}`);
        break;
      }
      // strong recent stories travel as hearsay and colour the listener's day
      const strong = mf.memories.find(mm => Math.abs(mm.feel) >= 2 && Sim.day - mm.day <= 3);
      if (strong && Math.random() < 0.4)
        to.mood = Math.max(5, Math.min(98, (to.mood === undefined ? 60 : to.mood) + strong.feel));
    };
    share(a, b); share(b, a);
  },

  /* ---------- careers: the ambitious don't wait to be assigned ---------- */
  tickCareers() {
    for (const p of Sim.people) {
      if (p.kind === 'kid' || !p.work || p.heldUntil > Sim.day) continue;
      if (p.age !== undefined && p.age >= AGE_RETIRE) continue;
      const m = this.ensure(p);
      if (m.traits.ambition < 0.55 || Math.random() > 0.05) continue;
      const cur = (WAGES[p.work.type] || 15) * (p.wageMult || 1);
      let best = null, bw = cur * 1.25; // a move has to be clearly worth it
      for (const w of Sim.workplaces()) {
        if (w === p.work || w.workers.length >= w.jobs) continue;
        if (!m.knows.has(w.id)) continue; // can't apply to a job you've never heard of
        const eff = (WAGES[w.type] || 15) - (Math.abs(w.x - p.home.x) + Math.abs(w.y - p.home.y)) * 0.06;
        if (eff > bw) { bw = eff; best = w; }
      }
      if (best) {
        const oldName = CAT[p.work.type].name;
        p.work.workers = p.work.workers.filter(q => q !== p);
        p.work = best; best.workers.push(p);
        p.wageMult = 1; p.jobDays = 0;
        p.mood = Math.min(98, (p.mood === undefined ? 60 : p.mood) + 6);
        this.remember(p, 'career', `left the ${oldName.toLowerCase()} for better pay`, 1, best.id);
        if (Math.random() < 0.4 && typeof Life !== 'undefined')
          Life.say(`💼 ${Sim.fullName(p)} left the ${oldName} for better pay at the ${CAT[best.type].name} — ambition pays`);
      }
    }
  },

  /* ---------- save / load: a mind travels with its owner ---------- */
  pack(p) {
    const m = this.ensure(p);
    return {
      t: m.traits,
      k: [...m.knows],
      f: [...m.friends],
      v: [...m.favorites],
      m: m.memories,
      g: m.flags,
    };
  },
  unpack(p, s) {
    p.mind = {
      knows: new Set(s.k || []),
      memories: s.m || [],
      friends: new Map(s.f || []),
      favorites: new Map(s.v || []),
      flags: s.g || {},
      traits: s.t || { social: 0.5, caution: 0.5, ambition: 0.5, thrift: 0.5, curiosity: 0.5 },
    };
  },

  /* the single most vivid recent memory in a household — for the inspector */
  householdStory(b) {
    let latest = null, who = null;
    for (const r of b.residents) {
      if (!r.mind || !r.mind.memories.length) continue;
      const mm = r.mind.memories[r.mind.memories.length - 1];
      if (!latest || mm.day > latest.day || (mm.day === latest.day && Math.abs(mm.feel) > Math.abs(latest.feel))) {
        latest = mm; who = r;
      }
    }
    return latest ? { who, memory: latest } : null;
  },
};
