/* ==========================================================================
   Rishit's Stereo — player logic
   ========================================================================== */
(() => {
  'use strict';

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const PHONE = window.matchMedia('(max-width: 900px), (hover: none) and (pointer: coarse)');

  /* ----------------------------- tiny storage ----------------------------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('stereo.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('stereo.' + k, JSON.stringify(v)); } catch (e) { /* private mode etc. */ } }
  };

  /* ------------------------------ constants ------------------------------- */
  const COL_TITLES = {
    all: 'All Tracks', phonk: 'Phonk', english: 'English & Other', hindi: 'Hindi/Gujarati',
    instrumental: 'Instrumental', devotional: 'Devotional', recent: 'Recently Played', liked: 'Liked Songs'
  };
  const CAT_GENRE = { phonk: 'Phonk', english: 'English', hindi: 'Hindi/Gujarati', instrumental: 'Instrumental', devotional: 'Devotional' };
  const EMPTY_MSG = {
    recent: 'Nothing played yet — songs you play will show up here.',
    liked: 'No liked songs yet — tap the heart on any song to add it here.',
    search: 'No songs match your search.',
    cat: 'No songs in this collection yet. Use “Add song” to upload one.'
  };

  /* ------------------------------- library -------------------------------- */
  const BASE = window.RELEASE_BASE || '';
  const defaults = (window.SONGS || []).map((s, i) => ({
    id: 'd' + String(i + 1).padStart(2, '0'),
    title: s.t, cat: s.c, genre: s.g,
    src: /^(https?:)?\/\//.test(s.f) || s.f.startsWith('/') ? s.f : BASE + encodeURIComponent(s.f),
    user: false
  }));
  let userSongs = [];
  let lib = defaults.slice();
  let libMap = new Map();
  const byTitle = (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });
  const rebuildLib = () => { lib = defaults.concat(userSongs).sort(byTitle); libMap = new Map(lib.map(s => [s.id, s])); };
  rebuildLib();

  /* -------------------------------- state --------------------------------- */
  const S = {
    col: 'all', query: '', view: 'list',
    queue: [], cur: null,
    liked: new Set(store.get('liked', [])),
    recent: store.get('recent', []),
    repeat: !!store.get('repeat', false),
    vol: Math.min(1, Math.max(0, Number(store.get('vol', 0.9)))),
    muted: false
  };

  const app = $('#app');
  const audio = $('#audio');
  const listEl = $('#list');
  const listScroll = $('#listScroll');
  const emptyEl = $('#empty');

  /* ------------------------------- helpers -------------------------------- */
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = t => {
    if (!isFinite(t) || t < 0) t = 0;
    t = Math.floor(t);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  };
  const pad2 = n => String(n).padStart(2, '0');

  let toastTimer;
  function toast(msg, ms = 3200) {
    const el = $('#toast');
    el.textContent = msg; el.hidden = false;
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  /* ------------------------------- theme ---------------------------------- */
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    const m = $('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'light' ? '#ffffff' : '#000000');
    const btn = $('#themeBtn');
    btn.setAttribute('aria-label', t === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
    btn.title = t === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
    updateMediaSession();
  }
  $('#themeBtn').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(next); store.set('theme', next);
  });

  /* ------------------------------ list view ------------------------------- */
  function visibleSongs() {
    const q = S.query.trim().toLowerCase();
    if (q) return lib.filter(s => s.title.toLowerCase().includes(q) || s.genre.toLowerCase().includes(q));
    switch (S.col) {
      case 'all': return lib;
      case 'recent': return S.recent.map(id => libMap.get(id)).filter(Boolean);
      case 'liked': return lib.filter(s => S.liked.has(s.id));
      default: return lib.filter(s => s.cat === S.col);
    }
  }

  function rowHtml(s, i) {
    const on = S.liked.has(s.id);
    const playing = s.id === S.cur;
    return `<li class="row${playing ? ' playing' : ''}" data-id="${s.id}" tabindex="0" role="button" aria-label="Play ${esc(s.title)}">` +
      `<span class="num">${pad2(i + 1)}</span>` +
      `<span class="thumb" aria-hidden="true"></span>` +
      `<span class="title">${esc(s.title)}</span>` +
      `<span class="genre">${esc(s.genre)}</span>` +
      `<button class="like${on ? ' on' : ''}" type="button" data-like="${s.id}" aria-label="${on ? 'Unlike' : 'Like'}" aria-pressed="${on}"><svg class="ico"><use href="#i-heart"/></svg></button>` +
      `<button class="rplay" type="button" data-play="${s.id}" aria-label="Play / pause"><svg class="ico fill i-pl"><use href="#i-play"/></svg><svg class="ico fill i-pa"><use href="#i-pause"/></svg></button>` +
      `</li>`;
  }

  function renderList(resetScroll) {
    const songs = visibleSongs();
    listEl.innerHTML = songs.map(rowHtml).join('');
    $('#collTitle').textContent = S.query.trim() ? 'Search' : COL_TITLES[S.col];
    if (!songs.length) {
      emptyEl.textContent = S.query.trim() ? EMPTY_MSG.search : (EMPTY_MSG[S.col] || EMPTY_MSG.cat);
      emptyEl.hidden = false;
    } else emptyEl.hidden = true;
    if (resetScroll) listScroll.scrollTop = 0;
    syncNav();
  }

  function syncNav() {
    $$('.nav-item').forEach(b => {
      const key = b.dataset.col;
      const on = S.view === 'np' ? key === 'np' : (key === S.col && key !== 'np');
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  }

  /* ------------------------------- views ---------------------------------- */
  function showView(v, push) {
    S.view = v;
    app.dataset.view = v;
    $('#listView').hidden = v !== 'list';
    $('#npView').hidden = v !== 'np';
    syncNav();
    if (v === 'np' && push !== false) { try { history.pushState({ np: 1 }, ''); } catch (e) {} }
  }
  window.addEventListener('popstate', () => { if (S.view === 'np') showView('list', false); closeSidebar(); });

  function go(col) {
    closeSidebar();
    if (col === 'np') { showView('np'); return; }
    S.col = col; S.query = ''; $('#search').value = '';
    const wasNp = S.view === 'np';
    if (wasNp) { showView('list', false); try { if (history.state && history.state.np) history.back(); } catch (e) {} }
    renderList(true);
  }
  $('#nav').addEventListener('click', e => { const b = e.target.closest('.nav-item'); if (b) go(b.dataset.col); });
  $('#logo').addEventListener('click', e => { e.preventDefault(); go('all'); });

  /* ------------------------------ sidebar --------------------------------- */
  function openSidebar() { document.body.classList.add('sb-open'); }
  function closeSidebar() { document.body.classList.remove('sb-open'); }
  $('#sbOpen').addEventListener('click', openSidebar);
  $('#sbClose').addEventListener('click', closeSidebar);
  $('#backdrop').addEventListener('click', closeSidebar);
  PHONE.addEventListener && PHONE.addEventListener('change', closeSidebar);

  /* ------------------------------- search --------------------------------- */
  let searchTimer;
  $('#search').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      S.query = e.target.value;
      if (S.view === 'np') { showView('list', false); try { if (history.state && history.state.np) history.back(); } catch (err) {} }
      renderList(true);
    }, 90);
  });
  $('#search').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });

  /* ------------------------------ playback -------------------------------- */
  audio.volume = S.vol;
  audio.loop = S.repeat;

  function setQueueFromView() { S.queue = visibleSongs().map(s => s.id); }

  function loadSong(id, autoplay) {
    const s = libMap.get(id);
    if (!s) return;
    const changed = S.cur !== id || !audio.src;
    S.cur = id;
    store.set('last', id);
    if (changed) { audio.src = s.src; audio.load(); }
    syncNow();
    if (autoplay) playAudio();
  }

  function playAudio() {
    const p = audio.play();
    if (p && p.catch) p.catch(err => {
      if (err && err.name === 'NotAllowedError') return;
      if (err && err.name === 'AbortError') return;
      failed();
    });
  }
  function failed() {
    const s = libMap.get(S.cur);
    toast(`Couldn’t load “${s ? s.title : 'this song'}”. Check its file link in songs.js.`, 4500);
  }

  function togglePlay() {
    if (!S.cur) return;
    if (audio.paused) {
      if (audio.error) { audio.load(); }
      playAudio();
    } else audio.pause();
  }

  function step(dir) {
    let q = S.queue.length ? S.queue : lib.map(s => s.id);
    let i = q.indexOf(S.cur);
    if (i < 0) { q = lib.map(s => s.id); i = q.indexOf(S.cur); }
    if (!q.length) return;
    loadSong(q[(i + dir + q.length) % q.length], true);
  }
  function prev() { if (audio.currentTime > 3) audio.currentTime = 0; else step(-1); }
  function next() { step(1); }
  function skip(sec) {
    const d = audio.duration;
    let t = audio.currentTime + sec;
    t = Math.max(0, isFinite(d) ? Math.min(d - 0.1, t) : t);
    audio.currentTime = t;
  }

  function playFromRow(id) {
    if (id === S.cur) { togglePlay(); return; }
    setQueueFromView();
    loadSong(id, true);
  }

  listEl.addEventListener('click', e => {
    const like = e.target.closest('[data-like]');
    if (like) { e.stopPropagation(); toggleLike(like.dataset.like); return; }
    const row = e.target.closest('.row');
    if (row) playFromRow(row.dataset.id);
  });
  listEl.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('row')) { e.preventDefault(); playFromRow(e.target.dataset.id); }
  });

  /* audio events */
  audio.addEventListener('play', () => {
    app.classList.add('is-playing');
    if (S.cur) {
      if (S.recent[0] !== S.cur) {
        S.recent = [S.cur].concat(S.recent.filter(x => x !== S.cur)).slice(0, 40);
        store.set('recent', S.recent);
        if (S.col === 'recent' && S.view === 'list' && !S.query) { /* keep list stable while browsing it */ }
      }
    }
    startRaf(); updateMediaSession();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
  });
  audio.addEventListener('pause', () => {
    app.classList.remove('is-playing'); stopRaf(); updateProgress();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
  });
  audio.addEventListener('ended', () => { if (!S.repeat) next(); });
  audio.addEventListener('timeupdate', updateProgress);
  audio.addEventListener('durationchange', () => { updateProgress(); updatePosition(); });
  audio.addEventListener('loadedmetadata', updateProgress);
  audio.addEventListener('error', () => { if (audio.src) failed(); });

  /* progress bars */
  let raf = 0;
  const startRaf = () => { if (!raf) raf = requestAnimationFrame(tick); };
  const stopRaf = () => { cancelAnimationFrame(raf); raf = 0; };
  function tick() { updateProgress(); raf = audio.paused ? 0 : requestAnimationFrame(tick); }

  const seeks = $$('[data-seek]');
  const vols = $$('[data-vol]');
  const dragging = new WeakSet();

  function setRange(el, frac) { el.style.setProperty('--p', String(frac)); }

  function updateProgress() {
    const d = audio.duration, t = audio.currentTime;
    const ok = isFinite(d) && d > 0;
    const frac = ok ? Math.min(1, t / d) : 0;
    seeks.forEach(el => {
      el.disabled = !ok;
      if (!dragging.has(el)) el.value = String(Math.round(frac * 1000));
      setRange(el, dragging.has(el) ? el.value / 1000 : frac);
    });
    const tx = fmt(t);
    $('#plTime').textContent = tx; $('#npTime').textContent = tx;
    $$('#plTime, #npTime').forEach(el => el.title = ok ? `${tx} / ${fmt(d)}` : tx);
  }

  seeks.forEach(el => {
    el.addEventListener('pointerdown', () => dragging.add(el));
    const end = () => dragging.delete(el);
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('blur', end);
    el.addEventListener('input', () => {
      const d = audio.duration;
      if (isFinite(d) && d > 0) { audio.currentTime = (el.value / 1000) * d; }
      seeks.forEach(o => { if (o !== el) { o.value = el.value; } setRange(o, el.value / 1000); });
      $('#plTime').textContent = $('#npTime').textContent = fmt(audio.currentTime);
    });
  });

  /* volume */
  function applyVolume() {
    audio.volume = S.vol; audio.muted = S.muted;
    vols.forEach(el => { el.value = String(Math.round(S.vol * 100)); setRange(el, S.vol); });
    app.classList.toggle('muted', S.muted || S.vol === 0);
  }
  vols.forEach(el => el.addEventListener('input', () => {
    S.vol = el.value / 100; S.muted = false; store.set('vol', S.vol); applyVolume();
  }));
  applyVolume();

  /* repeat */
  function applyRepeat() {
    audio.loop = S.repeat;
    $$('[data-act="repeat"]').forEach(b => { b.setAttribute('aria-pressed', String(S.repeat)); b.title = S.repeat ? 'Repeat: this song' : 'Repeat: off'; });
  }
  applyRepeat();

  /* generic transport buttons */
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
      case 'toggle': togglePlay(); break;
      case 'prev': prev(); break;
      case 'next': next(); break;
      case 'rew': skip(-10); break;
      case 'ff': skip(10); break;
      case 'mute': S.muted = !S.muted; applyVolume(); break;
      case 'repeat': S.repeat = !S.repeat; store.set('repeat', S.repeat); applyRepeat(); break;
      case 'timer': openSleep(); break;
      case 'expand': showView('np'); break;
    }
  });
  $('.pl-left').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showView('np'); } });

  $('#npBack').addEventListener('click', () => {
    if (history.state && history.state.np) history.back(); else showView('list', false);
  });

  /* ------------------------------- liking --------------------------------- */
  function toggleLike(id) {
    if (S.liked.has(id)) S.liked.delete(id); else S.liked.add(id);
    store.set('liked', Array.from(S.liked));
    const on = S.liked.has(id);
    $$(`[data-like="${id}"]`).forEach(b => { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-label', on ? 'Unlike' : 'Like'); });
    if (id === S.cur) syncLike();
    if (S.col === 'liked' && !S.query && S.view === 'list' && !on) {
      const row = listEl.querySelector(`.row[data-id="${id}"]`);
      if (row) row.remove();
      if (!listEl.children.length) { emptyEl.textContent = EMPTY_MSG.liked; emptyEl.hidden = false; }
      else $$('.row .num', listEl).forEach((n, i) => { n.textContent = pad2(i + 1); });
    }
    toast(on ? 'Added to Liked Songs' : 'Removed from Liked Songs', 1600);
  }
  function syncLike() {
    const b = $('#npLike'); const on = S.liked.has(S.cur);
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? 'Unlike' : 'Like');
  }
  $('#npLike').addEventListener('click', () => { if (S.cur) toggleLike(S.cur); });

  /* -------------------------------- share --------------------------------- */
  $('#npShare').addEventListener('click', async () => {
    const s = libMap.get(S.cur); if (!s) return;
    const data = { title: s.title, text: `Listening to “${s.title}” on Rishit’s Stereo`, url: location.href.split('#')[0] };
    try {
      if (navigator.share) { await navigator.share(data); return; }
      await navigator.clipboard.writeText(`${data.text} — ${data.url}`);
      toast('Link copied to clipboard');
    } catch (e) { if (e && e.name !== 'AbortError') toast('Sharing isn’t available here.'); }
  });

  /* --------------------------- now-playing sync --------------------------- */
  function syncNow() {
    const s = libMap.get(S.cur); if (!s) return;
    $('#plTitle').textContent = $('#npTitle').textContent = s.title;
    $('#plGenre').textContent = $('#npGenre').textContent = s.genre;
    document.title = `${s.title} · Rishit’s Stereo`;
    $('#npDelete').hidden = !s.user;
    syncLike();
    $$('.row.playing', listEl).forEach(r => r.classList.remove('playing'));
    const row = listEl.querySelector(`.row[data-id="${s.id}"]`);
    if (row) row.classList.add('playing');
    updateProgress(); updateMediaSession();
  }

  /* ---------------------------- media session ----------------------------- */
  function updateMediaSession() {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    const s = libMap.get(S.cur); if (!s) return;
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    const art = new URL(light ? 'assets/cover-light.png' : 'assets/cover-dark.png', location.href).href;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: s.title, artist: s.genre, album: 'Rishit’s Stereo', artwork: [{ src: art, sizes: '700x700', type: 'image/png' }] });
    } catch (e) {}
  }
  function updatePosition() {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    try { if (isFinite(audio.duration)) navigator.mediaSession.setPositionState({ duration: audio.duration, position: audio.currentTime, playbackRate: audio.playbackRate }); } catch (e) {}
  }
  if ('mediaSession' in navigator) {
    const h = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) {} };
    h('play', togglePlay); h('pause', () => audio.pause());
    h('previoustrack', prev); h('nexttrack', next);
    h('seekbackward', () => skip(-10)); h('seekforward', () => skip(10));
    h('seekto', d => { if (d && isFinite(d.seekTime)) audio.currentTime = d.seekTime; });
  }

  /* ------------------------------- modals --------------------------------- */
  let lastFocus = null;
  function openModal(el) { lastFocus = document.activeElement; $('#toast').hidden = true; el.hidden = false; }
  function closeModal(el) { el.hidden = true; if (lastFocus && lastFocus.focus) { try { lastFocus.focus({ preventScroll: true }); } catch (e) {} } }
  $$('.modal').forEach(m => {
    m.addEventListener('mousedown', e => { if (e.target === m) closeModal(m); });
    $$('[data-close]', m).forEach(b => b.addEventListener('click', () => closeModal(m)));
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const open = $$('.modal').find(m => !m.hidden);
      if (open) closeModal(open); else closeSidebar();
    }
  });

  /* ----------------------------- sleep timer ------------------------------ */
  let sleepEnd = 0, sleepInt = 0, fadeInt = 0;

  function sleepLeftMs() { return Math.max(0, sleepEnd - Date.now()); }
  function fmtLeft(ms) { const s = Math.ceil(ms / 1000); return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`; }

  function renderSleep() {
    const active = sleepEnd > 0;
    $('#sleepActive').hidden = !active;
    if (active) $('#sleepLeft').textContent = fmtLeft(sleepLeftMs());
    $$('[data-act="timer"]').forEach(b => { b.classList.toggle('active', active); b.title = active ? `Sleep timer — ${fmtLeft(sleepLeftMs())} left` : 'Sleep timer'; });
  }
  function startSleep(minutes) {
    clearInterval(sleepInt); clearInterval(fadeInt);
    sleepEnd = Date.now() + minutes * 60000;
    sleepInt = setInterval(() => {
      const left = sleepLeftMs();
      if (left <= 0) { finishSleep(); return; }
      if (left <= 4000 && !fadeInt && !audio.paused) startFade();
      renderSleep();
    }, 500);
    renderSleep();
    const h = Math.floor(minutes / 60), m = minutes % 60;
    toast(`Sleep timer set for ${h ? h + ' hr ' : ''}${m ? m + ' min' : ''}`.trim());
  }
  function startFade() {
    const start = audio.volume; const t0 = Date.now();
    fadeInt = setInterval(() => {
      const k = 1 - (Date.now() - t0) / 3500;
      audio.volume = Math.max(0, start * k);
      if (k <= 0) { clearInterval(fadeInt); fadeInt = 0; }
    }, 80);
  }
  function finishSleep() {
    clearInterval(sleepInt); clearInterval(fadeInt); fadeInt = 0; sleepEnd = 0;
    audio.pause(); audio.volume = S.vol;
    renderSleep(); toast('Sleep timer finished — good night 🌙', 4500);
  }
  function cancelSleep() {
    clearInterval(sleepInt); clearInterval(fadeInt); fadeInt = 0; sleepEnd = 0; audio.volume = S.vol; renderSleep();
    toast('Sleep timer cancelled', 1800);
  }
  function openSleep() { renderSleep(); $('#sleepNote').hidden = true; openModal($('#sleepModal')); }
  $('#sleepChips').addEventListener('click', e => {
    const c = e.target.closest('.chip'); if (!c) return;
    startSleep(Number(c.dataset.h) * 60); closeModal($('#sleepModal'));
  });
  $('#sleepCancel').addEventListener('click', () => { cancelSleep(); closeModal($('#sleepModal')); });
  $('#sleepForm').addEventListener('submit', e => {
    e.preventDefault();
    const h = Math.max(0, parseInt($('#cHr').value, 10) || 0);
    const m = Math.max(0, parseInt($('#cMin').value, 10) || 0);
    const total = h * 60 + m;
    const note = $('#sleepNote');
    if (total < 1) { note.textContent = 'Enter at least 1 minute.'; note.hidden = false; return; }
    if (total > 24 * 60) { note.textContent = 'Please keep it within 24 hours.'; note.hidden = false; return; }
    note.hidden = true; startSleep(total); closeModal($('#sleepModal'));
    $('#cHr').value = ''; $('#cMin').value = '';
  });

  /* ------------------------------ add a song ------------------------------ */
  const fileInput = $('#fileInput');
  let pending = [];
  let pickedCat = 'phonk';

  $('#addBtn').addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });

  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files || []).filter(f => /^audio\//.test(f.type) || /\.(mp3|m4a|aac|wav|ogg|oga|flac|opus|webm)$/i.test(f.name));
    if (!files.length) { if (fileInput.files && fileInput.files.length) toast('Please choose an audio file (mp3).'); return; }
    pending = files;
    closeSidebar();
    const total = files.reduce((n, f) => n + f.size, 0);
    $('#fileName').textContent = files.length === 1 ? files[0].name : `${files.length} songs selected`;
    $('#fileMeta').textContent = (total / 1048576).toFixed(1) + ' MB';
    const single = files.length === 1;
    $('#nameField').hidden = !single;
    if (single) $('#songName').value = cleanName(files[0].name);
    pickCat(CAT_GENRE[S.col] ? S.col : 'phonk');
    openModal($('#addModal'));
  });
  const cleanName = n => n.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();

  function pickCat(c) {
    pickedCat = c;
    $$('#catChips .cat').forEach(b => b.setAttribute('aria-checked', String(b.dataset.cat === c)));
  }
  $('#catChips').addEventListener('click', e => { const b = e.target.closest('.cat'); if (b) pickCat(b.dataset.cat); });

  /* IndexedDB (keeps added songs in this browser) */
  const DB = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((res, rej) => {
        if (!window.indexedDB) return rej(new Error('no idb'));
        const r = indexedDB.open('rishit-stereo', 1);
        r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('songs')) r.result.createObjectStore('songs', { keyPath: 'id' }); };
        r.onsuccess = () => { this.db = r.result; res(r.result); };
        r.onerror = () => rej(r.error);
      });
    },
    async tx(mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const t = db.transaction('songs', mode); const st = t.objectStore('songs');
        const req = fn(st);
        t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
      });
    },
    all() { return this.tx('readonly', st => st.getAll()); },
    put(rec) { return this.tx('readwrite', st => st.put(rec)); },
    del(id) { return this.tx('readwrite', st => st.delete(id)); }
  };

  const toSong = rec => ({ id: rec.id, title: rec.title, cat: rec.cat, genre: CAT_GENRE[rec.cat] || 'Other', src: URL.createObjectURL(rec.blob), user: true });

  $('#addConfirm').addEventListener('click', async () => {
    if (!pending.length) return;
    const files = pending; pending = [];
    closeModal($('#addModal'));
    const added = []; let savedOk = true;
    for (const f of files) {
      const title = (files.length === 1 ? $('#songName').value.trim() : '') || cleanName(f.name) || 'Untitled';
      const rec = { id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title, cat: pickedCat, blob: f, mime: f.type || 'audio/mpeg', added: Date.now() };
      try { await DB.put(rec); } catch (e) { savedOk = false; }
      const song = toSong(rec); userSongs.push(song); added.push(song);
    }
    rebuildLib();
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
    S.col = pickedCat; S.query = ''; $('#search').value = '';
    showView('list', false);
    renderList(false);
    setQueueFromView();
    loadSong(added[0].id, true);
    const row = listEl.querySelector(`.row[data-id="${added[0].id}"]`);
    if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    toast(savedOk
      ? (added.length === 1 ? `Added “${added[0].title}” to ${COL_TITLES[pickedCat]}` : `Added ${added.length} songs to ${COL_TITLES[pickedCat]}`)
      : 'Added for this visit only — your browser blocked saving.', 3800);
  });

  $('#npDelete').addEventListener('click', async () => {
    const s = libMap.get(S.cur); if (!s || !s.user) return;
    if (!confirm(`Remove “${s.title}” from your library on this device?`)) return;
    audio.pause();
    try { await DB.del(s.id); } catch (e) {}
    URL.revokeObjectURL(s.src);
    userSongs = userSongs.filter(x => x.id !== s.id); rebuildLib();
    S.liked.delete(s.id); store.set('liked', Array.from(S.liked));
    S.recent = S.recent.filter(x => x !== s.id); store.set('recent', S.recent);
    audio.removeAttribute('src'); audio.load();
    S.cur = null;
    const fallback = lib[0]; if (fallback) { S.cur = fallback.id; audio.src = fallback.src; }
    showView('list', false); renderList(false); syncNow();
    toast('Song removed');
  });

  /* ---------------------------- keyboard shortcuts ------------------------- */
  document.addEventListener('keydown', e => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if ($$('.modal').some(m => !m.hidden)) return;
    const t = e.target;
    const typing = t.matches && t.matches('input:not([type="range"]), textarea, select, [contenteditable]');
    if (typing) return;
    if (e.code === 'Space' && !(t.matches && t.matches('button, [role="button"], a, input[type="range"]'))) { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowRight' && !(t.matches && t.matches('input[type="range"]'))) skip(5);
    else if (e.key === 'ArrowLeft' && !(t.matches && t.matches('input[type="range"]'))) skip(-5);
    else if (e.key === 'MediaTrackNext') next();
    else if (e.key === 'MediaTrackPrevious') prev();
  });

  /* ---------------------------------- boot -------------------------------- */
  async function boot() {
    applyTheme(document.documentElement.getAttribute('data-theme') || 'dark');

    // restore the songs the visitor added on this device
    try {
      const recs = await DB.all();
      recs.sort((a, b) => a.added - b.added);
      userSongs = recs.filter(r => r && r.blob).map(toSong);
      rebuildLib();
    } catch (e) { /* no IndexedDB (private mode) — defaults only */ }

    const last = store.get('last', null);
    S.cur = libMap.has(last) ? last : (lib[0] && lib[0].id);
    S.queue = lib.map(s => s.id);
    showView('list', false);
    renderList(true);
    if (S.cur) { audio.src = libMap.get(S.cur).src; syncNow(); }
    updateProgress();
  }
  boot();
})();
