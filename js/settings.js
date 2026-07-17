/* ============================================================
   PixelVille — player settings.
   Persisted globally in localStorage (not per save): how fast the
   town grows, whether Christmas locks fast-forward, sound volume,
   and the autosave cadence. The village NAME lives on World and
   travels with each save instead.
   ============================================================ */
'use strict';

const Settings = {
  data: {
    growthPace: 'cozy',   // cozy | normal | bustling
    xmasLock: 'eve',      // eve (lock only Dec 24-25) | season (whole week) | off
    volume: 0.5,          // master loudness 0..1
    autosaveMin: 2,       // minutes between autosaves; 0 = off
  },

  load() {
    try {
      const raw = localStorage.getItem('pixelville-settings');
      if (raw) Object.assign(this.data, JSON.parse(raw));
    } catch (e) { /* corrupted settings fall back to defaults */ }
  },
  save() {
    try { localStorage.setItem('pixelville-settings', JSON.stringify(this.data)); } catch (e) {}
  },
  get(k) { return this.data[k]; },
  set(k, v) { this.data[k] = v; this.save(); },

  /* how eagerly the town grows: scales move-ins, speculative housing and
     pioneer treks. Cozy is the intended pace — lively while the village is
     small, then ever gentler as it fills out, so a town takes seasons to
     become a city instead of days. */
  growthMult() {
    const pop = typeof Sim !== 'undefined' ? Sim.people.length : 0;
    switch (this.data.growthPace) {
      case 'bustling': return 1.4;
      case 'normal': return 1;
      default: return 0.9 * 34 / (34 + pop); // cozy
    }
  },
};
Settings.load();
