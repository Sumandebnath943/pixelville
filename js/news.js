/* ============================================================
   PixelVille — PVTV, the village news channel.
   A little always-on TV beside the minimap: a pixel anchor reads
   the latest village stories (fed by the task book's news log),
   calamities cut in as BREAKING, and a stock ticker crawls along
   the bottom. Reporters in the streets are handled by Life.
   ============================================================ */
'use strict';

const News = {
  el: null, headEl: null, tickerEl: null, anchorCv: null,
  breakingUntil: 0,
  lastRotate: 0, lastSeen: -1, lastTicker: 0, frame: 0,

  init() {
    this.el = document.getElementById('tv');
    this.headEl = document.getElementById('tv-headline');
    this.tickerEl = document.getElementById('tv-ticker-text');
    this.anchorCv = document.getElementById('tv-anchor');
    this.drawAnchor();
  },

  /* the studio: backdrop, desk, mic and a talking pixel anchor */
  drawAnchor() {
    if (!this.anchorCv || typeof SPR === 'undefined' || !SPR.person) return;
    const g = this.anchorCv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#22304a'; g.fillRect(0, 0, 26, 26);
    g.fillStyle = '#2c3e5e'; g.fillRect(2, 3, 10, 8);   // skyline graphic
    g.fillStyle = '#4a6088'; g.fillRect(3, 6, 2, 5); g.fillRect(6, 4, 2, 7); g.fillRect(9, 7, 2, 4);
    const spr = SPR.person('reporter', 4);
    g.drawImage(spr.f[this.frame % 2], 0, 0, 6, 9, 8, 4, 12, 18);
    g.fillStyle = '#3a2f28'; g.fillRect(0, 19, 26, 7);  // desk
    g.fillStyle = '#c8ccd4'; g.fillRect(20, 12, 1, 7);  // mic stand
    g.fillStyle = '#c0392b'; g.fillRect(19, 10, 3, 2);  // mic
  },

  breaking(text) {
    if (!this.headEl) return;
    this.breakingUntil = performance.now() + 14000;
    this.headEl.textContent = '🔴 BREAKING: ' + text;
    this.headEl.classList.add('breaking');
    if (this.el) this.el.classList.add('breaking');
  },

  tick(now) {
    if (!this.el) return;
    const f = Math.floor(now / 700) % 2; // the anchor talks
    if (f !== this.frame) { this.frame = f; this.drawAnchor(); }
    if (now - this.lastTicker > 12000) {
      this.lastTicker = now;
      let s = `DAY ${Sim.day} · POP ${Sim.people.length} · SAFETY ${Math.round(Sim.safety)}%`;
      if (Sim.stocks) {
        s += ` · 📊 PVX ${Sim.stockIndex()}`;
        for (const q of Sim.stocks) s += ` · ${q.sym} $${q.price.toFixed(1)} ${q.price >= (q.prev || q.price) ? '▲' : '▼'}`;
      }
      if (typeof Gov !== 'undefined' && Gov.leader) s += ` · MAYOR ${Gov.leader.name.toUpperCase()} ${Math.round(Gov.approval)}%`;
      if (typeof Weather !== 'undefined') s += ` · ${Weather.weatherLabel().toUpperCase()}`;
      this.tickerEl.textContent = s + ' ··· ';
    }
    if (now < this.breakingUntil) return; // hold breaking stories on screen
    if (this.headEl.classList.contains('breaking')) {
      this.headEl.classList.remove('breaking');
      this.el.classList.remove('breaking');
    }
    if (now - this.lastRotate > 6000) {
      this.lastRotate = now;
      const news = (typeof Tasks !== 'undefined' && Tasks.news.length) ? Tasks.news : null;
      if (news) {
        const pool = news.slice(-8); // rotate the most recent stories
        this.lastSeen = (this.lastSeen + 1) % pool.length;
        this.headEl.textContent = pool[pool.length - 1 - this.lastSeen].text;
      } else {
        this.headEl.textContent = 'PVTV signs on — a quiet day in PixelVille.';
      }
    }
  },
};
