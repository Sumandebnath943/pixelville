/* ============================================================
   PixelVille — seasons & weather.
   Seasons rotate every SEASON_LEN days and recolor the world.
   Weather is a seasonal-weighted state machine; rain and snow
   are screen-space particles, puddles live in world space.
   ============================================================ */
'use strict';

const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
const SEASON_EMOJI = ['🌸', '☀️', '🍂', '❄️'];
const SEASON_LEN = 7; // days per season

const Weather = {
  season: 0,
  kind: 'clear',        // clear | clouds | rain | heavy | snow
  intensity: 0, target: 0,
  nextChange: 120,      // game-minutes until the weather turns
  drops: [], flakes: [], leaves: [], splashes: [],
  puddles: [],          // world px: {x, y, r, max, v}
  clouds: [],
  cloudBlob: null,
  flash: 0,             // lightning
  _seasonToastDay: 0,

  init() {
    this.clouds = [];
    for (let i = 0; i < 5; i++)
      this.clouds.push({
        x: Math.random() * GW * T, y: Math.random() * GH * T,
        s: 130 + Math.random() * 170, vx: 2.2 + Math.random() * 2.6, vy: 0.5,
      });
    // soft irregular cloud-shadow blob
    const S = 160;
    const [c, g] = mkCanvas(S, S);
    for (const [ox, oy, r] of [[62, 80, 55], [95, 70, 48], [80, 95, 40]]) {
      const grad = g.createRadialGradient(ox, oy, 4, ox, oy, r);
      grad.addColorStop(0, 'rgba(10,14,26,0.55)');
      grad.addColorStop(1, 'rgba(10,14,26,0)');
      g.fillStyle = grad; g.fillRect(0, 0, S, S);
    }
    this.cloudBlob = c;
    this.season = this.seasonOf(Sim.day);
    this.roll();
    this.intensity = this.target;
  },

  seasonOf(day) { return Math.floor(((day - 1) % (SEASON_LEN * 4)) / SEASON_LEN); },
  isRaining() { return (this.kind === 'rain' || this.kind === 'heavy') && this.intensity > 0.25; },
  isSnowing() { return this.kind === 'snow' && this.intensity > 0.2; },
  label() { return `${SEASON_EMOJI[this.season]} ${SEASONS[this.season]}`; },
  weatherLabel() {
    return { clear: '☀️ Clear', clouds: '⛅ Cloudy', rain: '🌧️ Rain', heavy: '⛈️ Heavy rain', snow: '🌨️ Snow' }[this.kind];
  },
  /* extra darkness added to daylight by bad weather */
  gloom() {
    if (this.kind === 'heavy') return 0.20 * this.intensity;
    if (this.kind === 'rain') return 0.11 * this.intensity;
    if (this.kind === 'snow') return 0.08 * this.intensity;
    if (this.kind === 'clouds') return 0.05;
    return 0;
  },

  roll() {
    const tables = [
      [['clear', 30], ['clouds', 28], ['rain', 30], ['heavy', 12]],   // spring
      [['clear', 56], ['clouds', 24], ['rain', 14], ['heavy', 6]],    // summer
      [['clear', 22], ['clouds', 32], ['rain', 30], ['heavy', 16]],   // autumn
      [['clear', 26], ['clouds', 30], ['snow', 44]],                  // winter
    ];
    const table = tables[this.season];
    let sum = 0; for (const [, w] of table) sum += w;
    let r = Math.random() * sum;
    for (const [k, w] of table) { r -= w; if (r <= 0) { this.kind = k; break; } }
    this.target = { clear: 0, clouds: 0.15, rain: 0.55, heavy: 1, snow: 0.75 }[this.kind];
    this.nextChange = 100 + Math.random() * 260; // game-minutes
  },

  tick(dtSim, dtReal, onSeasonChange) {
    const s = this.seasonOf(Sim.day);
    if (s !== this.season) {
      this.season = s;
      World.dirty = true;                        // recolor the whole map
      if (this.kind === 'snow' && s !== 3) this.roll();
      if (onSeasonChange) onSeasonChange(s);
    }
    this.nextChange -= dtSim * 10;
    if (this.nextChange <= 0) this.roll();
    if (this.season === 3 && (this.kind === 'rain' || this.kind === 'heavy')) { this.kind = 'snow'; this.target = 0.8; }

    const wasRaining = this._wasRain;
    this._wasRain = this.isRaining();
    if (wasRaining && !this._wasRain && Sim.clock > 380 && Sim.clock < 1080) this.rainbowT = 38; // sun after rain
    if (this.rainbowT > 0) this.rainbowT -= dtReal;

    this.intensity += (this.target - this.intensity) * Math.min(1, dtReal * 0.35);

    // lightning during storms
    if (this.kind === 'heavy' && this.intensity > 0.7 && Math.random() < dtReal * 0.10) this.flash = 0.55;
    this.flash = Math.max(0, this.flash - dtReal * 2.4);

    // drifting cloud shadows
    const cs = this.kind === 'clear' ? 0.5 : 1.5;
    for (const c of this.clouds) {
      c.x += c.vx * dtReal * cs * (UI ? UI.speeds[UI.speedIdx] || 0.4 : 1);
      c.y += c.vy * dtReal * cs;
      if (c.x > GW * T + 220) { c.x = -220; c.y = Math.random() * GH * T; }
      if (c.y > GH * T + 220) c.y = -220;
    }

    // puddles: born in heavy rain, evaporate in dry weather
    const raining = this.isRaining();
    if (this.kind === 'heavy' && this.intensity > 0.55 && this.puddles.length < 140 && Math.random() < dtReal * 7) {
      for (let tries = 0; tries < 10; tries++) {
        const x = (Math.random() * GW) | 0, y = (Math.random() * GH) | 0;
        const i = World.idx(x, y);
        if (World.ground[i] !== G_WATER && !World.bmap[i]) {
          this.puddles.push({
            x: x * T + 2 + Math.random() * 7, y: y * T + 3 + Math.random() * 8,
            r: 0.05, max: 0.6 + Math.random() * 0.7, v: (Math.random() * 3) | 0,
          });
          break;
        }
      }
    }
    for (const p of this.puddles) {
      const goal = (this.kind === 'heavy' && this.intensity > 0.5) ? p.max : (raining ? p.r : 0);
      p.r += (goal - p.r) * Math.min(1, dtReal * (raining ? 0.5 : 0.06));
    }
    if (!raining) this.puddles = this.puddles.filter(p => p.r > 0.06);
  },

  /* world-space puddles — call between ground and entities */
  renderPuddles(ctx, vx0, vy0, vx1, vy1) {
    for (const p of this.puddles) {
      const tx = p.x / T, ty = p.y / T;
      if (tx < vx0 || tx > vx1 || ty < vy0 || ty > vy1) continue;
      const img = SPR.puddles[p.v];
      const w = img.width * (0.4 + p.r), h = img.height * (0.4 + p.r);
      ctx.globalAlpha = Math.min(0.85, p.r + 0.25);
      ctx.drawImage(img, p.x - w / 2, p.y - h / 2, w, h);
    }
    ctx.globalAlpha = 1;
  },

  /* world-space drifting cloud shadows */
  renderClouds(ctx) {
    const a = { clear: 0.35, clouds: 0.8, rain: 1, heavy: 1.1, snow: 0.7 }[this.kind];
    ctx.globalAlpha = 0.5 * a;
    for (const c of this.clouds)
      ctx.drawImage(this.cloudBlob, c.x - c.s, c.y - c.s * 0.7, c.s * 2, c.s * 1.4);
    ctx.globalAlpha = 1;
  },

  /* screen-space precipitation — call after the night overlay */
  renderPrecip(ctx, w, h, dt) {
    const I = this.intensity;
    if (this.kind === 'rain' || this.kind === 'heavy') {
      const want = Math.floor(w * h * I / (this.kind === 'heavy' ? 3800 : 7500));
      while (this.drops.length < want)
        this.drops.push({ x: Math.random() * w, y: Math.random() * h, s: 300 + Math.random() * 200, l: 7 + Math.random() * 7 });
      if (this.drops.length > want) this.drops.length = want;
      ctx.strokeStyle = `rgba(172,196,226,${0.30 + I * 0.16})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const d of this.drops) {
        d.y += d.s * dt; d.x += d.s * dt * 0.16;
        if (d.y > h + 10) { d.y = -12; d.x = Math.random() * (w + 60) - 30; }
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - d.l * 0.16, d.y - d.l);
      }
      ctx.stroke();
      // ground splashes in heavy rain
      if (this.kind === 'heavy') {
        if (this.splashes.length < 26 && Math.random() < I)
          this.splashes.push({ x: Math.random() * w, y: h * 0.25 + Math.random() * h * 0.75, t: 0 });
        ctx.strokeStyle = 'rgba(200,220,242,0.5)';
        for (const sp of this.splashes) {
          sp.t += dt * 4;
          ctx.beginPath(); ctx.arc(sp.x, sp.y, 1 + sp.t * 3, 0, 7); ctx.stroke();
        }
        this.splashes = this.splashes.filter(sp => sp.t < 1);
      }
    } else { this.drops.length = 0; this.splashes.length = 0; }

    if (this.kind === 'snow') {
      const want = Math.floor(w * h * I / 9000);
      while (this.flakes.length < want)
        this.flakes.push({ x: Math.random() * w, y: Math.random() * h, s: 24 + Math.random() * 26, ph: Math.random() * 7, sz: Math.random() < 0.3 ? 2 : 1 });
      if (this.flakes.length > want) this.flakes.length = want;
      ctx.fillStyle = 'rgba(244,248,255,0.85)';
      for (const f of this.flakes) {
        f.y += f.s * dt; f.ph += dt * 1.6; f.x += Math.sin(f.ph) * 14 * dt;
        if (f.y > h + 4) { f.y = -6; f.x = Math.random() * w; }
        ctx.fillRect(f.x, f.y, f.sz, f.sz);
      }
    } else this.flakes.length = 0;

    // drifting autumn leaves
    if (this.season === 2 && this.kind !== 'heavy') {
      const want = 18;
      while (this.leaves.length < want)
        this.leaves.push({ x: Math.random() * w, y: Math.random() * h, s: 18 + Math.random() * 22, ph: Math.random() * 7, c: Math.random() < 0.5 ? '#c07830' : '#b05a2c' });
      for (const l of this.leaves) {
        l.y += l.s * dt; l.ph += dt * 2.2; l.x += (Math.sin(l.ph) * 26 + 8) * dt;
        if (l.y > h + 4) { l.y = -6; l.x = Math.random() * w; }
        ctx.fillStyle = l.c;
        ctx.fillRect(l.x, l.y, 2, Math.sin(l.ph) > 0 ? 1 : 2);
      }
    } else this.leaves.length = 0;

    // lightning flash
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(235,240,255,${this.flash * 0.55})`;
      ctx.fillRect(0, 0, w, h);
    }
  },
};
