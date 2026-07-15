/* ============================================================
   PixelVille — the village Task Book (journal).
   Every project, emergency and civic effort becomes a task that
   is crossed off when it completes, and every news line is kept
   in a scrollable log — nothing disappears with a toast anymore.
   ============================================================ */
'use strict';

const Tasks = {
  items: [],   // {id, icon, text, day, done, ok, doneDay}
  news: [],    // {day, time, text}
  open: false,
  unread: 0,
  _dirty: true,

  reset() { this.items = []; this.news = []; this.unread = 0; this._dirty = true; },

  add(id, icon, text) {
    if (id && this.items.some(t => t.id === id && !t.done)) return;
    this.items.push({
      id: id || ('t' + Math.random().toString(36).slice(2)),
      icon: icon || '📌', text,
      day: typeof Sim !== 'undefined' ? Sim.day : 1,
      done: false, ok: true, doneDay: 0,
    });
    if (this.items.length > 120) {
      // drop the oldest finished entries first
      const doneIdx = this.items.findIndex(t => t.done);
      this.items.splice(doneIdx >= 0 ? doneIdx : 0, 1);
    }
    if (!this.open) this.unread++;
    this._dirty = true;
  },

  /* mark a task finished; ok=false crosses it off as failed (✗) */
  done(id, ok, note) {
    const t = this.items.find(t => t.id === id && !t.done);
    if (!t) return;
    t.done = true; t.ok = ok !== false;
    t.doneDay = typeof Sim !== 'undefined' ? Sim.day : t.day;
    if (note) t.text = note;
    this._dirty = true;
  },

  log(text) {
    this.news.push({
      day: typeof Sim !== 'undefined' ? Sim.day : 1,
      time: typeof Sim !== 'undefined' ? Sim.timeStr() : '',
      text,
    });
    if (this.news.length > 250) this.news.shift();
    this._dirty = true;
  },

  activeCount() { return this.items.filter(t => !t.done).length; },

  /* ---------- DOM ---------- */
  toggle() {
    this.open = !this.open;
    const el = document.getElementById('journal');
    el.style.display = this.open ? 'flex' : 'none';
    if (this.open) { this.unread = 0; this._dirty = true; this.render(); }
    this.badge();
  },

  setTab(tab) {
    this.tab = tab;
    document.querySelectorAll('#journal-tabs button').forEach(b =>
      b.classList.toggle('active', b.dataset.tab === tab));
    this._dirty = true;
    this.render();
  },
  tab: 'tasks',

  badge() {
    const b = document.getElementById('journal-badge');
    if (!b) return;
    const n = this.open ? 0 : this.unread;
    b.style.display = n > 0 ? 'flex' : 'none';
    b.textContent = n > 9 ? '9+' : n;
  },

  render() {
    if (!this.open || !this._dirty) return;
    this._dirty = false;
    const list = document.getElementById('journal-list');
    if (!list) return;
    let html = '';
    if (this.tab === 'tasks') {
      const active = this.items.filter(t => !t.done).slice().reverse();
      const finished = this.items.filter(t => t.done).slice().reverse().slice(0, 40);
      if (!active.length && !finished.length)
        html = '<div class="j-empty">No village projects yet — drop a building or wait for the town to act.</div>';
      for (const t of active)
        html += `<div class="j-item"><span class="j-ico">${t.icon}</span><span class="j-text">${t.text}</span><span class="j-day">d${t.day}</span></div>`;
      if (finished.length) html += '<div class="j-sep">Completed</div>';
      for (const t of finished)
        html += `<div class="j-item done ${t.ok ? 'ok' : 'fail'}"><span class="j-ico">${t.ok ? '✅' : '❌'}</span><span class="j-text">${t.text}</span><span class="j-day">d${t.doneDay}</span></div>`;
    } else {
      const news = this.news.slice().reverse();
      if (!news.length) html = '<div class="j-empty">Nothing has happened yet. It will.</div>';
      for (const n of news)
        html += `<div class="j-item news"><span class="j-day">d${n.day} ${n.time}</span><span class="j-text">${n.text}</span></div>`;
    }
    list.innerHTML = html;
    this.badge();
  },
};
