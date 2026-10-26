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
  const REPO_RAW = 'https://raw.githubusercontent.com/Rishit-1010/Stereo/main/';
  /* songs.js uses paths like tracks/X.mp3; inside the Android/desktop apps they are loaded from the website */
  const SITE = 'https://rishit-1010.github.io/Stereo/';
  const toUrl = u => (/^(https?:)?\/\//.test(u) || !(window.StereoAndroid || window.stereoDesktop)) ? u : SITE + u;
  const defaults = (window.SONGS || []).map((s, i) => ({
    id: 'd' + String(i + 1).padStart(2, '0'),
    title: s.t, cat: s.c, genre: s.g,
    duration: s.d || 0,
    src: toUrl(s.f),
    alt: s.r ? toUrl(s.r) : null, /* fallback link, tried once if the main file fails to load */
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
    originalQueue: [],
    liked: new Set(store.get('liked', [])),
    playlists: store.get('playlists', []),
    recent: store.get('recent', []),
    repeatMode: store.get('repeatMode', store.get('repeat', false) ? 'one' : 'off'),
    shuffle: !!store.get('shuffle', false),
    offline: new Set(store.get('offline', [])),
    crossfade: store.get('crossfade', true),
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
  /* twelve themes: the original Dark (lime) + Light (navy), plus five extra dark and five extra light colours.
     Their colours live in style.css; the logo + cover images of the extra ones are in the themes/ folder. */
  const DARK_FILES = ['Logo.png', 'Cover.png', 'CoverBig.png'];
  const THEMES = [
    { id: 'dark',         label: 'Dark (Lime)',     mode: 'dark',  accent: '#abff00', files: DARK_FILES },
    { id: 'dark-red',     label: 'Dark (Red)',      mode: 'dark',  accent: '#ff5252' },
    { id: 'dark-yellow',  label: 'Dark (Yellow)',   mode: 'dark',  accent: '#f4ff00' },
    { id: 'dark-blue',    label: 'Dark (Blue)',     mode: 'dark',  accent: '#5ccfff' },
    { id: 'dark-violet',  label: 'Dark (Violet)',   mode: 'dark',  accent: '#c8a2ff' },
    { id: 'dark-white',   label: 'Dark (White)',    mode: 'dark',  accent: '#ffffff' },
    { id: 'light',        label: 'Light (Navy)',    mode: 'light', accent: '#000455', files: ['Logo1.png', 'Cover2.png', 'CoverBig1.png'] },
    { id: 'light-maroon', label: 'Light (Maroon)',  mode: 'light', accent: '#620817' },
    { id: 'light-green',  label: 'Light (Green)',   mode: 'light', accent: '#07482b' },
    { id: 'light-yellow', label: 'Light (Yellow)',  mode: 'light', accent: '#6e4c00' },
    { id: 'light-purple', label: 'Light (Purple)',  mode: 'light', accent: '#3b1074' },
    { id: 'light-black',  label: 'Light (Black)',   mode: 'light', accent: '#000000' }
  ];
  THEMES.forEach(t => { if (!t.files) t.files = DARK_FILES.map(f => 'themes/' + t.id + '/' + f); });
  const THEME_BY_ID = new Map(THEMES.map(t => [t.id, t]));
  const themeBg = t => (t.mode === 'light' ? '#ffffff' : '#000000');
  const curTheme = () => THEME_BY_ID.get(document.documentElement.getAttribute('data-theme')) || THEMES[0];

  /* start loading a theme's images the moment it is picked (or hovered), kept on window so they stay decoded */
  const themePre = new Map();
  function preloadTheme(t) {
    if (themePre.has(t.id)) return;
    themePre.set(t.id, t.files.map(f => { const img = new Image(); img.decoding = 'async'; img.src = REPO_RAW + f; return img; }));
  }

  const themeBtn = $('#themeBtn'), themePop = $('#themeList'), themeScrim = $('#themeScrim');
  const phoneLayout = () => window.matchMedia('(max-width: 900px), (hover: none) and (pointer: coarse)').matches;

  function buildThemeMenu() {
    const group = (name, mode) =>
      `<div class="tm-group" role="group" aria-label="${name} themes"><p class="tm-head">${name.toUpperCase()}</p>` +
      THEMES.filter(t => t.mode === mode).map(t =>
        `<button type="button" class="tm-opt" role="option" aria-selected="false" data-theme-id="${t.id}">` +
        `<span class="sw" style="--sw-bg:${themeBg(t)};--sw-ac:${t.accent}"></span>` +
        `<span class="tm-label">${esc(t.label)}</span><svg class="ico tm-check" aria-hidden="true"><use href="#i-check"/></svg></button>`
      ).join('') + '</div>';
    themePop.innerHTML = '<p class="tm-title">Choose a theme</p>' + group('Dark', 'dark') + group('Light', 'light');
  }
  buildThemeMenu();

  function applyTheme(id) {
    const t = THEME_BY_ID.get(id) || THEMES[0];
    document.documentElement.setAttribute('data-theme', t.id);
    const m = $('meta[name="theme-color"]');
    if (m) m.setAttribute('content', themeBg(t));
    preloadTheme(t);
    /* trigger button shows the current theme */
    $('#themeSw').style.cssText = `--sw-bg:${themeBg(t)};--sw-ac:${t.accent}`;
    $('#themeName').textContent = t.label;
    themeBtn.title = 'Theme: ' + t.label;
    themeBtn.setAttribute('aria-label', 'Choose theme. Current theme: ' + t.label);
    $$('.tm-opt', themePop).forEach(o => o.setAttribute('aria-selected', String(o.dataset.themeId === t.id)));
    updateMediaSession();
  }

  function placeThemePop() {
    if (phoneLayout()) { themePop.style.top = themePop.style.right = ''; return; } /* bottom sheet: CSS places it */
    const r = themeBtn.getBoundingClientRect();
    themePop.style.top = Math.round(r.bottom + 8) + 'px';
    themePop.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + 'px';
  }
  function setThemeMenu(open) {
    if (open === !themePop.hidden) return;
    themePop.hidden = !open;
    themeScrim.hidden = !open;
    themeBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      placeThemePop();
      const sel = themePop.querySelector('.tm-opt[aria-selected="true"]') || themePop.querySelector('.tm-opt');
      if (sel) sel.focus({ preventScroll: true });
    }
  }
  themeBtn.addEventListener('click', () => setThemeMenu(themePop.hidden));
  themePop.addEventListener('click', e => {
    const b = e.target.closest('.tm-opt'); if (!b) return;
    applyTheme(b.dataset.themeId); store.set('theme', b.dataset.themeId);
    setThemeMenu(false); themeBtn.focus({ preventScroll: true });
  });
  const warmTheme = e => { const b = e.target.closest && e.target.closest('.tm-opt'); if (b) preloadTheme(THEME_BY_ID.get(b.dataset.themeId)); };
  themePop.addEventListener('pointerover', warmTheme);
  themePop.addEventListener('focusin', warmTheme);
  document.addEventListener('pointerdown', e => {
    if (!themePop.hidden && !themePop.contains(e.target) && !themeBtn.contains(e.target)) setThemeMenu(false);
  });
  document.addEventListener('keydown', e => {
    if (themePop.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); setThemeMenu(false); themeBtn.focus({ preventScroll: true }); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const opts = $$('.tm-opt', themePop); if (!opts.length) return;
      e.preventDefault();
      const i = opts.indexOf(document.activeElement);
      const next = e.key === 'ArrowDown' ? (i + 1) % opts.length : (i <= 0 ? opts.length - 1 : i - 1);
      opts[next].focus();
    }
  });
  window.addEventListener('resize', () => { if (!themePop.hidden) placeThemePop(); });

  /* ------------------------------ list view ------------------------------- */
  function visibleSongs() {
    let list;
    if (String(S.col).startsWith('pl:')) {
      const pl = S.playlists.find(p => p.id === S.col.slice(3));
      list = pl ? pl.songs.map(id => libMap.get(id)).filter(Boolean) : [];
    } else {
      switch (S.col) {
        case 'all': list = lib; break;
        case 'recent': list = S.recent.map(id => libMap.get(id)).filter(Boolean); break;
        case 'liked': list = lib.filter(s => S.liked.has(s.id)); break;
        default: list = lib.filter(s => s.cat === S.col);
      }
    }
    const q = S.query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(s => s.title.toLowerCase().includes(q) || s.genre.toLowerCase().includes(q));
  }

  function isPlaylistReorderable() {
    return String(S.col).startsWith('pl:') && !S.query.trim();
  }

  function rowHtml(s, i) {
    const on = S.liked.has(s.id);
    const playing = s.id === S.cur;
    const canDrag = isPlaylistReorderable();
    const durStr = s.duration ? fmt(s.duration) : '';
    const isOffline = S.offline.has(s.id);
    return `<li class="row${playing ? ' playing' : ''}${canDrag ? ' can-drag' : ''}" data-id="${s.id}" tabindex="0" role="button" aria-label="Play ${esc(s.title)}">` +
      (canDrag ? `<span class="grip" aria-hidden="true" title="Drag to reorder"><svg class="ico"><use href="#i-grip"/></svg></span>` : '') +
      `<span class="num">${pad2(i + 1)}</span>` +
      `<span class="thumb" aria-hidden="true"></span>` +
      `<span class="meta"><span class="title">${esc(s.title)}</span><span class="genre">${esc(s.genre)}</span></span>` +
      `<span class="dur">${durStr}</span>` +
      `<span class="offline-tag${isOffline ? '' : ' empty'}"${isOffline ? ' title="Saved for offline"' : ' aria-hidden="true"'}>${isOffline ? '<svg class="ico"><use href="#i-cloud-check"/></svg>' : ''}</span>` +
      `<button class="like${on ? ' on' : ''}" type="button" data-like="${s.id}" aria-label="${on ? 'Unlike' : 'Like'}" aria-pressed="${on}"><svg class="ico"><use href="#i-heart"/></svg></button>` +
      `<button class="rplay" type="button" data-play="${s.id}" aria-label="Play / pause"><svg class="ico fill i-pl"><use href="#i-play"/></svg><svg class="ico fill i-pa"><use href="#i-pause"/></svg></button>` +
      `</li>`;
  }

  let reorder = null;
  let scrollRaf = 0;

  function placePlaceholder(clientY) {
    const ph = reorder.placeholder;
    const rows = [...listEl.children].filter(el => el.classList.contains('row') && !el.classList.contains('row-placeholder') && el !== reorder.row);
    let before = null;
    for (const sib of rows) {
      const r = sib.getBoundingClientRect();
      if (clientY < r.top + r.height / 2) { before = sib; break; }
    }
    if (before) {
      if (ph.nextElementSibling !== before) listEl.insertBefore(ph, before);
    } else if (listEl.lastElementChild !== ph) {
      listEl.appendChild(ph);
    }
  }

  function commitPlaylistOrder() {
    const pl = S.playlists.find(p => 'pl:' + p.id === S.col);
    if (!pl) return;
    pl.songs = [...listEl.querySelectorAll('.row:not(.row-placeholder)')].map(r => r.dataset.id).filter(Boolean);
    savePlaylists();
    $$('.row:not(.row-placeholder) .num', listEl).forEach((el, i) => { el.textContent = pad2(i + 1); });
    if (S.queue.length) setQueueFromView();
  }

  function endReorder(commit) {
    if (!reorder) return;
    const { row, placeholder, moved } = reorder;
    cancelAnimationFrame(scrollRaf);
    scrollRaf = 0;
    document.removeEventListener('pointermove', onReorderMove);
    document.removeEventListener('pointerup', onReorderEnd);
    document.removeEventListener('pointercancel', onReorderEnd);
    if (placeholder.parentNode) placeholder.parentNode.insertBefore(row, placeholder);
    placeholder.remove();
    row.classList.remove('row-float');
    row.style.cssText = '';
    listEl.classList.remove('is-sorting');
    document.body.classList.remove('is-sorting');
    reorder = null;
    if (commit && moved) {
      commitPlaylistOrder();
      const stopClick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        document.removeEventListener('click', stopClick, true);
      };
      document.addEventListener('click', stopClick, true);
    }
  }

  function onReorderMove(e) {
    if (!reorder || e.pointerId !== reorder.pointerId) return;
    e.preventDefault();
    reorder.moved = true;
    reorder.lastY = e.clientY;
    reorder.row.style.top = (e.clientY - reorder.offsetY) + 'px';
    placePlaceholder(e.clientY);
  }

  function onReorderEnd(e) {
    if (!reorder || e.pointerId !== reorder.pointerId) return;
    endReorder(true);
  }

  function scrollWhileReordering() {
    if (!reorder) return;
    const y = reorder.lastY;
    if (y != null) {
      const box = listScroll.getBoundingClientRect();
      const edge = 64;
      if (y < box.top + edge) listScroll.scrollTop -= Math.max(4, Math.ceil((box.top + edge - y) / 3));
      else if (y > box.bottom - edge) listScroll.scrollTop += Math.max(4, Math.ceil((y - (box.bottom - edge)) / 3));
      placePlaceholder(y);
    }
    scrollRaf = requestAnimationFrame(scrollWhileReordering);
  }

  listEl.addEventListener('pointerdown', e => {
    const grip = e.target.closest('.grip');
    if (!grip || !isPlaylistReorderable() || reorder) return;
    if (e.button != null && e.button !== 0) return;
    const row = grip.closest('.row');
    if (!row) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = row.getBoundingClientRect();
    const placeholder = document.createElement('li');
    placeholder.className = 'row row-placeholder';
    placeholder.style.height = rect.height + 'px';
    placeholder.setAttribute('aria-hidden', 'true');
    row.parentNode.insertBefore(placeholder, row);
    row.classList.add('row-float');
    row.style.position = 'fixed';
    row.style.left = rect.left + 'px';
    row.style.top = rect.top + 'px';
    row.style.width = rect.width + 'px';
    row.style.height = rect.height + 'px';
    row.style.margin = '0';
    row.style.zIndex = '80';
    reorder = { pointerId: e.pointerId, row, placeholder, offsetY: e.clientY - rect.top, lastY: e.clientY, moved: false };
    listEl.classList.add('is-sorting');
    document.body.classList.add('is-sorting');
    document.addEventListener('pointermove', onReorderMove, { passive: false });
    document.addEventListener('pointerup', onReorderEnd);
    document.addEventListener('pointercancel', onReorderEnd);
    scrollRaf = requestAnimationFrame(scrollWhileReordering);
  });

  function renderList(resetScroll) {
    const songs = visibleSongs();
    listEl.innerHTML = songs.map(rowHtml).join('');
    (() => {
      let title = COL_TITLES[S.col] || 'Collection';
      if (String(S.col).startsWith('pl:')) {
        const pl = S.playlists.find(p => p.id === S.col.slice(3));
        title = pl ? pl.name : 'Playlist';
      }
      $('#collTitle').textContent = S.query.trim() ? 'Search' : title;
    })();
    if (!songs.length) {
      emptyEl.textContent = S.query.trim() ? EMPTY_MSG.search : (EMPTY_MSG[S.col] || EMPTY_MSG.cat);
      emptyEl.hidden = false;
    } else emptyEl.hidden = true;
    if (resetScroll) listScroll.scrollTop = 0;
    /* "Add songs" and "Delete playlist" appear only on playlists a visitor created (pl:…), never on built-in collections */
    const onPlaylist = String(S.col).startsWith('pl:') && !S.query.trim();
    $('#plAddSongs').hidden = !onPlaylist;
    $('#plDelete').hidden = !onPlaylist;
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
  audio.loop = (S.repeatMode === 'one');

  function setQueueFromView() {
    const list = visibleSongs().map(s => s.id);
    S.originalQueue = list.slice();
    if (S.shuffle) {
      const rest = list.filter(id => id !== S.cur);
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      S.queue = S.cur ? [S.cur, ...rest] : rest;
    } else {
      S.queue = list;
    }
  }

  function fadeTransition(fn) {
    if (!S.crossfade || audio.paused) { fn(); return; }
    const startVol = audio.volume;
    const steps = 6;
    const interval = 25;
    let s = 0;
    const down = setInterval(() => {
      s++;
      audio.volume = Math.max(0, startVol * (1 - s / steps));
      if (s >= steps) {
        clearInterval(down);
        fn();
        let u = 0;
        const up = setInterval(() => {
          u++;
          audio.volume = Math.min(S.vol, S.vol * (u / steps));
          if (u >= steps) {
            clearInterval(up);
            audio.volume = S.vol;
          }
        }, interval);
      }
    }, interval);
  }

  function loadSong(id, autoplay) {
    const s = libMap.get(id);
    if (!s) return;
    const changed = S.cur !== id || !audio.src;
    S.cur = id;
    S.wantPlay = !!autoplay;
    store.set('last', id);
    if (changed) {
      /* Prefer a fuller buffer so playback survives the screen turning off. */
      try { audio.preload = 'auto'; } catch (e) {}
      audio.src = s.src;
      audio.load();
    }
    syncNow();
    updateMediaSession();
    if (autoplay) playAudio();
  }

  function playAudio() {
    S.wantPlay = true;
    initVisualizer();
    updateMediaSession();
    const p = audio.play();
    if (p && p.catch) p.catch(err => {
      if (err && err.name === 'NotAllowedError') return;
      if (err && err.name === 'AbortError') return;
      failed();
    });
  }
  function failed() {
    const s = libMap.get(S.cur);
    toast(`Couldn’t load “${s ? s.title : 'this song'}”. Check that its file is in the tracks folder.`, 4500);
  }

  function togglePlay() {
    if (!S.cur) return;
    if (audio.paused) {
      if (audio.error) { audio.load(); }
      playAudio();
    } else {
      S.wantPlay = false;
      audio.pause();
    }
  }

  function step(dir, manual = true) {
    let q = S.queue.length ? S.queue : lib.map(s => s.id);
    let i = q.indexOf(S.cur);
    if (i < 0) { q = lib.map(s => s.id); i = q.indexOf(S.cur); }
    if (!q.length) return;
    if (!manual && dir > 0 && S.repeatMode === 'off' && i >= q.length - 1) {
      S.wantPlay = false;
      audio.pause();
      audio.currentTime = 0;
      updateProgress();
      return;
    }
    const nextId = q[(i + dir + q.length) % q.length];
    fadeTransition(() => loadSong(nextId, true));
  }
  function prev() { if (audio.currentTime > 3) audio.currentTime = 0; else step(-1, true); }
  function next(manual = true) { step(1, manual); }

  /* phones / tablets: swipe left on Now Playing = next song, swipe right = previous song */
  function swipeSong(dir) {
    step(dir);
    const body = $('#npView .np-body');
    if (!body) return;
    body.classList.remove('swipe-next', 'swipe-prev');
    void body.offsetWidth; /* restart the animation if swiped twice quickly */
    body.classList.add(dir > 0 ? 'swipe-next' : 'swipe-prev');
    body.addEventListener('animationend', () => body.classList.remove('swipe-next', 'swipe-prev'), { once: true });
  }
  (function () {
    const npEl = $('#npView');
    const scroller = npEl.querySelector('.np-scroll');
    let sx = 0, sy = 0, st = 0, track = false, mode = '', closing = false;
    const reset = () => { npEl.style.transition = ''; npEl.style.transform = ''; npEl.style.opacity = ''; };
    npEl.addEventListener('touchstart', e => {
      track = false; mode = '';
      if (closing || !PHONE.matches || e.touches.length !== 1) return;
      if (e.target.closest('input, button')) return; /* sliders and buttons keep their own touch behaviour */
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now(); track = true;
    }, { passive: true });
    npEl.addEventListener('touchmove', e => {
      if (!track) return;
      const t = e.touches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (!mode) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        mode = (dy > 0 && dy > Math.abs(dx) * 1.2 && (!scroller || scroller.scrollTop <= 0)) ? 'down' : 'other';
      }
      if (mode !== 'down') return;
      if (e.cancelable) e.preventDefault();
      const y = Math.max(0, dy);
      npEl.style.transition = 'none';
      npEl.style.transform = `translateY(${y}px)`;
      npEl.style.opacity = String(Math.max(.35, 1 - y / 520));
    }, { passive: false });
    npEl.addEventListener('touchend', e => {
      if (!track) return;
      track = false;
      const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy, dt = Date.now() - st;
      if (mode === 'down') {
        mode = '';
        if (dy > 110 || (dy > 50 && dy / Math.max(dt, 1) > 0.5)) {
          closing = true;
          npEl.style.transition = 'transform .26s cubic-bezier(.4,0,.2,1), opacity .26s';
          npEl.style.transform = 'translateY(100%)';
          npEl.style.opacity = '0';
          setTimeout(() => { $('#npBack').click(); setTimeout(() => { reset(); closing = false; }, 60); }, 250);
        } else {
          npEl.style.transition = 'transform .25s cubic-bezier(.2,.8,.2,1), opacity .25s';
          npEl.style.transform = ''; npEl.style.opacity = '';
          setTimeout(reset, 270);
        }
        return;
      }
      /* a quick, mostly-horizontal flick of at least 60px */
      if (dt > 800 || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      swipeSong(dx < 0 ? 1 : -1);
    }, { passive: true });
    npEl.addEventListener('touchcancel', () => { track = false; if (mode === 'down') { mode = ''; reset(); } }, { passive: true });
  })();
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
    if (e.target.closest('.grip')) { e.preventDefault(); e.stopPropagation(); return; }
    const like = e.target.closest('[data-like]');
    if (like) { e.stopPropagation(); toggleLike(like.dataset.like); return; }
    const row = e.target.closest('.row');
    if (row) playFromRow(row.dataset.id);
  });
  listEl.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('row')) { e.preventDefault(); playFromRow(e.target.dataset.id); }
  });

  /* Now Playing cover: spins as a circle while playing; on pause it eases back upright and morphs to the square */
  const npArt = $('#npArt');
  const SPIN_SECONDS = 14; /* keep in sync with np-vinyl-spin in style.css */
  let settleTimer = 0;
  function coverAngle() {
    const m = getComputedStyle(npArt).transform;
    if (!m || m === 'none') return 0;
    const v = m.slice(m.indexOf('(') + 1, -1).split(',').map(parseFloat);
    let deg = Math.atan2(v[1], v[0]) * 180 / Math.PI;
    if (deg < 0) deg += 360;
    return deg;
  }
  function coverSpinStart() {
    clearTimeout(settleTimer);
    const deg = coverAngle(); /* read before the animation takes over, so a quick resume continues from here */
    npArt.classList.remove('is-settling');
    npArt.style.transform = '';
    npArt.style.animationDelay = '-' + (deg / 360 * SPIN_SECONDS).toFixed(3) + 's';
  }
  function coverSettle() {
    const deg = coverAngle(); /* read while still spinning */
    npArt.style.animationDelay = '';
    app.classList.remove('is-playing'); /* stops the spin so the frozen angle below takes over */
    if (deg < 0.5 || deg > 359.5) return;
    npArt.classList.remove('is-settling');
    npArt.style.transform = 'rotate(' + deg + 'deg)'; /* freeze at the current angle... */
    void npArt.offsetWidth;
    npArt.classList.add('is-settling');
    npArt.style.transform = 'rotate(' + (deg > 180 ? 360 : 0) + 'deg)'; /* ...then turn the short way to upright */
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => { npArt.classList.remove('is-settling'); npArt.style.transform = ''; }, 900);
  }

  /* Web Audio API visualizer */
  let audioCtx = null, analyser = null, audioSrcNode = null, freqData = null;
  function initVisualizer() {
    if (audioCtx) {
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      return;
    }
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      audioCtx = new AudioCtx();
      audioSrcNode = audioCtx.createMediaElementSource(audio);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.8;
      audioSrcNode.connect(analyser);
      analyser.connect(audioCtx.destination);
      freqData = new Uint8Array(analyser.frequencyBinCount);
    } catch (e) {
      // AudioContext fallback for environments where createMediaElementSource is restricted
    }
  }

  function updateVisualizer() {
    if (!analyser || audio.paused || !freqData) return;
    analyser.getByteFrequencyData(freqData);
    const spans = $$('.np-eq span');
    if (!spans.length) return;
    const indices = [1, 3, 5, 8, 12];
    spans.forEach((sp, i) => {
      const val = freqData[indices[i]] || 0;
      const h = Math.max(4, Math.round((val / 255) * 26));
      sp.style.height = h + 'px';
      sp.style.animation = 'none';
    });
  }

  function resetVisualizer() {
    $$('.np-eq span').forEach(sp => { sp.style.height = ''; sp.style.animation = ''; });
  }

  /* audio events */
  audio.addEventListener('play', () => {
    coverSpinStart();
    initVisualizer();
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
    coverSettle();
    resetVisualizer();
    app.classList.remove('is-playing'); stopRaf(); updateProgress();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
  });
  audio.addEventListener('ended', () => {
    if (S.repeatMode === 'one') {
      audio.currentTime = 0;
      playAudio();
    } else {
      next(false);
    }
  });
  audio.addEventListener('timeupdate', updateProgress);
  audio.addEventListener('durationchange', () => { updateProgress(); updatePosition(); });
  audio.addEventListener('loadedmetadata', updateProgress);
  audio.addEventListener('error', () => {
    if (!audio.src) return;
    const s = libMap.get(S.cur);
    if (s && s.alt && !s.triedAlt) {
      /* main file missing: try the fallback link once */
      s.triedAlt = true; s.src = s.alt;
      audio.src = s.alt; audio.load();
      if (S.wantPlay) playAudio();
      return;
    }
    failed();
  });

  /* progress bars */
  let raf = 0;
  const startRaf = () => { if (!raf) raf = requestAnimationFrame(tick); };
  const stopRaf = () => { cancelAnimationFrame(raf); raf = 0; };
  function tick() {
    updateProgress();
    updateVisualizer();
    raf = audio.paused ? 0 : requestAnimationFrame(tick);
  }

  const seeks = $$('[data-seek]');
  const vols = $$('[data-vol]');
  const dragging = new WeakSet();

  function setRange(el, frac) {
    el.style.setProperty('--p', String(frac));
    const wrap = el.closest('.np-seek'); /* the wavy Now Playing bar reads --p from its wrapper */
    if (wrap) wrap.style.setProperty('--p', String(frac));
  }

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
    $('#npDur').textContent = fmt(ok ? d : 0); /* total length, shown at the end of the bar */
    $$('#plTime, #npTime').forEach(el => el.title = ok ? `${tx} / ${fmt(d)}` : tx);
    if (ok) updatePosition();
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

  /* repeat modes (off -> all -> one) */
  function cycleRepeat() {
    const modes = ['off', 'all', 'one'];
    const nextIdx = (modes.indexOf(S.repeatMode) + 1) % modes.length;
    applyRepeatMode(modes[nextIdx]);
    const labels = { off: 'Repeat off', all: 'Repeat all songs', one: 'Repeat current song' };
    toast(labels[S.repeatMode], 1800);
  }

  function applyRepeatMode(mode) {
    S.repeatMode = mode;
    store.set('repeatMode', mode);
    audio.loop = (mode === 'one');
    $$('[data-act="repeat"]').forEach(b => {
      b.dataset.repeatMode = mode;
      b.setAttribute('aria-label', 'Repeat mode: ' + mode);
      b.title = 'Repeat: ' + (mode === 'one' ? 'current song' : mode === 'all' ? 'all songs' : 'off');
    });
  }
  applyRepeatMode(S.repeatMode);

  /* shuffle */
  function toggleShuffle() {
    S.shuffle = !S.shuffle;
    store.set('shuffle', S.shuffle);
    if (S.shuffle) {
      if (!S.originalQueue.length) S.originalQueue = S.queue.slice();
      const rest = S.queue.filter(id => id !== S.cur);
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      S.queue = S.cur ? [S.cur, ...rest] : rest;
    } else {
      if (S.originalQueue.length) S.queue = S.originalQueue.slice();
      else setQueueFromView();
    }
    syncShuffle();
    if (!$('#queueModal').hidden) renderQueue();
    toast(S.shuffle ? 'Shuffle on' : 'Shuffle off', 1600);
  }

  function syncShuffle() {
    $$('[data-act="shuffle"]').forEach(b => {
      b.setAttribute('aria-pressed', String(S.shuffle));
      b.classList.toggle('active', S.shuffle);
      b.title = S.shuffle ? 'Shuffle: on' : 'Shuffle: off';
    });
  }
  syncShuffle();

  /* generic transport buttons */
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
      case 'toggle': togglePlay(); break;
      case 'prev': prev(); break;
      case 'next': next(true); break;
      case 'rew': skip(-10); break;
      case 'ff': skip(10); break;
      case 'mute': S.muted = !S.muted; applyVolume(); break;
      case 'repeat': cycleRepeat(); break;
      case 'shuffle': toggleShuffle(); break;
      case 'queue': openQueue(); break;
      case 'timer': openSleep(); break;
      case 'speed': openSpeed(); break;
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

  /* ------------------------------ download -------------------------------- */
  $('#npDownload').addEventListener('click', async () => {
    const s = libMap.get(S.cur);
    if (!s) { toast('Nothing is playing'); return; }
    const name = (s.title || 'song').replace(/[^\w\s\-\.]+/g, '').trim() + '.mp3';
    const save = href => {
      const a = document.createElement('a');
      a.href = href; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
    };
    try {
      if (s.user && window.StereoAndroid) {
        toast('Songs you added are already stored on this phone', 2600);
        return;
      } else if (s.user) {
        save(s.src); /* blob: URL from this device — saves directly */
      } else if (window.StereoAndroid) {
        /* Android app: saves to the phone's Downloads folder */
        window.StereoAndroid.download(s.src, name);
      } else if (window.stereoDesktop) {
        /* desktop app: native "Save as" dialog, no cross-origin limits */
        const r = await window.stereoDesktop.download(s.src, name);
        if (!r || !r.ok) {
          if (r && r.state === 'cancelled') { toast('Download cancelled', 1800); return; }
          throw new Error('desktop download failed');
        }
      } else {
        /* the download attribute is ignored on cross-origin links, so fetch the file and save it as a blob */
        toast('Preparing download…', 2000);
        const res = await fetch(s.src);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const url = URL.createObjectURL(await res.blob());
        save(url);
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
      toast('Download started');
    } catch (e) {
      /* e.g. the host blocks cross-origin reads — fall back to opening the file */
      try { window.open(s.src, '_blank', 'noopener'); } catch (e2) {}
      toast('Opening song file…');
    }
  });

  /* --------------------------- offline caching ---------------------------- */
  async function toggleOffline(id) {
    const s = libMap.get(id);
    if (!s) return;
    if (S.offline.has(id)) {
      S.offline.delete(id);
      store.set('offline', Array.from(S.offline));
      try {
        const c = await caches.open('stereo-audio-v1');
        await c.delete(s.src, { ignoreSearch: true });
      } catch (e) {}
      syncOffline();
      renderList(false);
      toast(`Removed “${s.title}” from offline storage`, 2000);
    } else {
      toast(`Saving “${s.title}” for offline…`, 2200);
      try {
        const res = await fetch(s.src);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const c = await caches.open('stereo-audio-v1');
        await c.put(s.src, res);
        S.offline.add(id);
        store.set('offline', Array.from(S.offline));
        syncOffline();
        renderList(false);
        toast(`“${s.title}” is now saved offline! 🎉`, 2500);
      } catch (e) {
        toast(`Couldn't save “${s.title}” offline`, 3000);
      }
    }
  }

  function syncOffline() {
    const b = $('#npOffline');
    if (!b) return;
    const isSaved = S.cur && S.offline.has(S.cur);
    b.classList.toggle('is-saved', isSaved);
    b.setAttribute('aria-pressed', String(isSaved));
    b.title = isSaved ? 'Saved offline (tap to remove)' : 'Save for offline';
  }
  const npOffline = $('#npOffline');
  if (npOffline) npOffline.addEventListener('click', () => { if (S.cur) toggleOffline(S.cur); });

  /* --------------------------- now-playing sync --------------------------- */
  function syncNow() {
    const s = libMap.get(S.cur); if (!s) return;
    $('#plTitle').textContent = $('#npTitle').textContent = s.title;
    $('#plGenre').textContent = $('#npGenre').textContent = s.genre;
    document.title = `${s.title} · Rishit’s Stereo`;
    $('#npDelete').hidden = !s.user;
    syncLike();
    syncOffline();
    if ($('#queueModal') && !$('#queueModal').hidden) renderQueue();
    $$('.row.playing', listEl).forEach(r => r.classList.remove('playing'));
    const row = listEl.querySelector(`.row[data-id="${s.id}"]`);
    if (row) row.classList.add('playing');
    updateProgress(); updateMediaSession();
  }

  /* ---------------------------- media session ----------------------------- */
  /* Lock-screen / notification controls + keep audio alive when the phone
     screen is off. Media Session is what Android / iOS use for that UI. */
  function absUrl(path) {
    try { return new URL(path, location.href).href; } catch (e) { return path; }
  }
  function updateMediaSession() {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    const s = libMap.get(S.cur); if (!s) return;
    const cover = absUrl(REPO_RAW + curTheme().files[2]); /* this theme's big cover */
    const icon = absUrl('icon-512.png');
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: s.title,
        artist: s.genre || 'Rishit’s Stereo',
        album: 'Rishit’s Stereo',
        artwork: [
          { src: icon, sizes: '96x96', type: 'image/png' },
          { src: icon, sizes: '128x128', type: 'image/png' },
          { src: icon, sizes: '192x192', type: 'image/png' },
          { src: icon, sizes: '256x256', type: 'image/png' },
          { src: icon, sizes: '384x384', type: 'image/png' },
          { src: icon, sizes: '512x512', type: 'image/png' },
          { src: cover, sizes: '350x350', type: 'image/png' }
        ]
      });
      navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
    } catch (e) {}
    updatePosition();
  }
  function updatePosition() {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    try {
      if (isFinite(audio.duration) && audio.duration > 0) {
        const pos = Math.min(Math.max(0, audio.currentTime || 0), audio.duration);
        navigator.mediaSession.setPositionState({
          duration: audio.duration,
          position: pos,
          playbackRate: audio.playbackRate || 1
        });
      }
    } catch (e) {}
  }
  if ('mediaSession' in navigator) {
    const h = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) {} };
    h('play', () => { S.wantPlay = true; playAudio(); });
    h('pause', () => { S.wantPlay = false; audio.pause(); });
    h('previoustrack', prev); h('nexttrack', next);
    h('seekbackward', d => skip(-((d && d.seekOffset) || 10)));
    h('seekforward', d => skip((d && d.seekOffset) || 10));
    h('seekto', d => {
      if (d && isFinite(d.seekTime)) {
        audio.currentTime = d.seekTime;
        updatePosition();
      }
    });
  }

  /* Keep playing when the screen locks / the tab is backgrounded. Phones may
     briefly pause the element; we resume if the user still wanted playback. */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      updateMediaSession();
      if (S.wantPlay && S.cur && audio.paused) playAudio();
    } else {
      updateProgress();
      updateMediaSession();
      if (S.wantPlay && S.cur && audio.paused) playAudio();
    }
  });
  window.addEventListener('pagehide', () => { updateMediaSession(); });
  window.addEventListener('pageshow', () => {
    updateProgress();
    updateMediaSession();
    if (S.wantPlay && S.cur && audio.paused) playAudio();
  });

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
    S.wantPlay = false;
    audio.pause(); audio.volume = S.vol;
    renderSleep(); toast('Sleep timer finished — music stopped', 4500);
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

  /* ---------------------------- playback speed ---------------------------- */
  const SPEED_MIN = 0.1, SPEED_MAX = 2;
  const speedRange = $('#speedRange');
  const clampSpeed = v => {
    v = Number(v);
    if (!isFinite(v)) return 1;
    return Math.round(Math.min(SPEED_MAX, Math.max(SPEED_MIN, v)) * 100) / 100;
  };
  const fmtSpeed = v => Number(v.toFixed(2)) + 'x';
  let speed = clampSpeed(store.get('speed', 1));

  function renderSpeed() {
    const label = fmtSpeed(speed);
    $('#speedVal').textContent = label;
    $('#speedReset').hidden = speed === 1;
    speedRange.value = String(speed);
    speedRange.setAttribute('aria-valuetext', label);
    setRange(speedRange, (speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN));
    $$('#speedChips .chip').forEach(c => c.classList.toggle('on', Math.abs(Number(c.dataset.s) - speed) < 0.001));
    $$('[data-act="speed"]').forEach(b => {
      b.classList.toggle('active', speed !== 1);
      b.title = 'Playback speed — ' + label;
      b.setAttribute('aria-label', 'Playback speed, ' + label);
    });
  }
  function applySpeed(v, save) {
    speed = clampSpeed(v);
    /* defaultPlaybackRate matters: loading a new song resets playbackRate to it */
    audio.defaultPlaybackRate = speed;
    audio.playbackRate = speed;
    audio.preservesPitch = true; audio.mozPreservesPitch = true; audio.webkitPreservesPitch = true; /* slower / faster, same pitch */
    if (save !== false) store.set('speed', speed);
    renderSpeed();
    updatePosition();
  }
  audio.addEventListener('loadstart', () => { audio.playbackRate = speed; });

  function openSpeed() { renderSpeed(); openModal($('#speedModal')); }
  $('#speedChips').addEventListener('click', e => {
    const c = e.target.closest('.chip'); if (!c) return;
    applySpeed(c.dataset.s);
  });
  speedRange.addEventListener('input', () => applySpeed(speedRange.value));
  $('#speedReset').addEventListener('click', () => applySpeed(1));
  applySpeed(speed, false);

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

  const toSong = rec => ({ id: rec.id, title: rec.title, cat: rec.cat, genre: CAT_GENRE[rec.cat] || 'Other', duration: rec.duration || 0, src: URL.createObjectURL(rec.blob), user: true });

  const getAudioDuration = file => new Promise(res => {
    try {
      const a = new Audio(URL.createObjectURL(file));
      a.onloadedmetadata = () => { res(Math.round(a.duration) || 0); URL.revokeObjectURL(a.src); };
      a.onerror = () => { res(0); URL.revokeObjectURL(a.src); };
      setTimeout(() => res(0), 2000);
    } catch (e) { res(0); }
  });

  $('#addConfirm').addEventListener('click', async () => {
    if (!pending.length) return;
    const files = pending; pending = [];
    closeModal($('#addModal'));
    const added = []; let savedOk = true;
    for (const f of files) {
      const title = (files.length === 1 ? $('#songName').value.trim() : '') || cleanName(f.name) || 'Untitled';
      const dur = await getAudioDuration(f);
      const rec = { id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title, cat: pickedCat, duration: dur, blob: f, mime: f.type || 'audio/mpeg', added: Date.now() };
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
    S.wantPlay = false;
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
    const t = e.target;
    const typing = t.matches && t.matches('input:not([type="range"]), textarea, select, [contenteditable]');
    if (typing) return;
    const openModals = $$('.modal').filter(m => !m.hidden);
    if (openModals.length) {
      if (e.key === 'Escape') closeModal(openModals[0]);
      return;
    }
    if (e.code === 'Space' && !(t.matches && t.matches('button, [role="button"], a, input[type="range"]'))) {
      e.preventDefault(); togglePlay();
    }
    else if (e.key === 'ArrowRight' && !(t.matches && t.matches('input[type="range"]'))) {
      e.preventDefault();
      if (e.shiftKey) next(true); else skip(5);
    }
    else if (e.key === 'ArrowLeft' && !(t.matches && t.matches('input[type="range"]'))) {
      e.preventDefault();
      if (e.shiftKey) prev(); else skip(-5);
    }
    else if (e.key === 'n' || e.key === 'N' || e.key === ']' || e.key === 'k' || e.key === 'K') {
      e.preventDefault();
      next(true);
    }
    else if (e.key === 'p' || e.key === 'P' || e.key === '[' || e.key === 'j' || e.key === 'J') {
      e.preventDefault();
      prev();
    }
    else if (e.key === 'ArrowUp' && !(t.matches && t.matches('input[type="range"]'))) {
      e.preventDefault();
      S.vol = Math.min(1, Math.round((S.vol + 0.05) * 100) / 100);
      S.muted = false;
      store.set('vol', S.vol);
      applyVolume();
      toast(`Volume ${Math.round(S.vol * 100)}%`, 1000);
    }
    else if (e.key === 'ArrowDown' && !(t.matches && t.matches('input[type="range"]'))) {
      e.preventDefault();
      S.vol = Math.max(0, Math.round((S.vol - 0.05) * 100) / 100);
      S.muted = false;
      store.set('vol', S.vol);
      applyVolume();
      toast(`Volume ${Math.round(S.vol * 100)}%`, 1000);
    }
    else if (e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      S.muted = !S.muted;
      applyVolume();
      toast(S.muted ? 'Muted' : 'Unmuted', 1200);
    }
    else if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      toggleShuffle();
    }
    else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      cycleRepeat();
    }
    else if (e.key === 'l' || e.key === 'L') {
      e.preventDefault();
      if (S.cur) toggleLike(S.cur);
    }
    else if (e.key === '/') {
      e.preventDefault();
      const sInput = $('#search');
      if (sInput) { sInput.focus(); sInput.select(); }
    }
    else if (e.key === 'q' || e.key === 'Q') {
      e.preventDefault();
      const qModal = $('#queueModal');
      if (qModal && !qModal.hidden) closeModal(qModal); else openQueue();
    }
    else if (e.key === 'MediaTrackNext') next(true);
    else if (e.key === 'MediaTrackPrevious') prev();
  });


  /* ----------------------------- playlists -------------------------------- */
  function savePlaylists() { store.set('playlists', S.playlists); }

  function renderPlaylistNav() {
    $$('.nav-item[data-col^="pl:"]').forEach(el => {
      const li = el.closest('li');
      if (li) li.remove();
    });
    const slot = $('#playlistNavSlot');
    if (!slot || !S.playlists.length) return;
    const frag = document.createDocumentFragment();
    S.playlists.forEach(pl => {
      const li = document.createElement('li');
      li.innerHTML = '<button type="button" class="nav-item" data-col="pl:' + pl.id + '"><svg class="ico i-s"><use href="#i-circleplay"/></svg><span>' + esc(pl.name) + '</span></button>';
      frag.appendChild(li);
    });
    slot.parentNode.insertBefore(frag, slot.nextSibling);
    syncNav();
  }

  let plPickOrder = [];
  let plEditId = null; /* null = creating a new playlist; otherwise the id of the playlist songs are being added to */
  const PL_HINT_CREATE = 'Select songs in the order you want them to play. The numbers show that order.';

  const pickRowsHtml = songs => songs.map(s =>
    '<button type="button" class="pl-song-opt" data-sid="' + s.id + '" aria-pressed="false">' +
    '<span class="check" aria-hidden="true"></span><span>' + esc(s.title) + '</span></button>'
  ).join('');

  function syncPlPickMarks() {
    $$('#plSongList .pl-song-opt').forEach(b => {
      const chk = b.querySelector('.check');
      const i = plPickOrder.indexOf(b.dataset.sid);
      if (i >= 0) {
        b.classList.add('on');
        b.setAttribute('aria-pressed', 'true');
        if (chk) chk.textContent = String(i + 1);
      } else {
        b.classList.remove('on');
        b.setAttribute('aria-pressed', 'false');
        if (chk) chk.textContent = '';
      }
    });
  }

  function openCreatePlaylist() {
    const box = $('#plSongList');
    if (!box) return;
    plPickOrder = [];
    plEditId = null;
    box.innerHTML = pickRowsHtml(lib);
    $('#plEyebrow').textContent = 'NEW PLAYLIST';
    $('#plModalTitle').textContent = 'Create playlist';
    $('#plNameField').hidden = false;
    $('#plPickHint').textContent = PL_HINT_CREATE;
    $('#plConfirm').textContent = 'Create';
    $('#plName').value = '';
    openModal($('#plModal'));
    setTimeout(() => { try { $('#plName').focus(); } catch (e) {} }, 40);
  }

  /* same song picker, opened on an existing playlist: only songs that aren't in it yet are offered */
  function openAddSongsToPlaylist(plId) {
    const pl = S.playlists.find(p => p.id === plId);
    const box = $('#plSongList');
    if (!pl || !box) return;
    const have = new Set(pl.songs);
    const options = lib.filter(s => !have.has(s.id));
    if (!options.length) { toast('Every song is already in “' + pl.name + '”'); return; }
    plPickOrder = [];
    plEditId = plId;
    box.innerHTML = pickRowsHtml(options);
    box.scrollTop = 0;
    $('#plEyebrow').textContent = 'ADD SONGS';
    $('#plModalTitle').textContent = 'Add to “' + pl.name + '”';
    $('#plNameField').hidden = true;
    $('#plPickHint').textContent = 'Songs already in this playlist aren’t shown. Select songs in the order you want them added.';
    $('#plConfirm').textContent = 'Add';
    openModal($('#plModal'));
  }

  $('#plAddSongs').addEventListener('click', () => {
    const col = String(S.col);
    if (!col.startsWith('pl:')) return; /* only viewer-created playlists */
    openAddSongsToPlaylist(col.slice(3));
  });

  $('#playlistBtn').addEventListener('click', () => { closeSidebar(); openCreatePlaylist(); });

  $('#plSongList').addEventListener('click', e => {
    const b = e.target.closest('.pl-song-opt');
    if (!b) return;
    const sid = b.dataset.sid;
    const i = plPickOrder.indexOf(sid);
    if (i >= 0) plPickOrder.splice(i, 1);
    else plPickOrder.push(sid);
    syncPlPickMarks();
  });

  $('#plConfirm').addEventListener('click', () => {
    if (plEditId) {
      const pl = S.playlists.find(p => p.id === plEditId);
      if (!pl) { closeModal($('#plModal')); return; }
      const fresh = plPickOrder.filter(id => libMap.has(id) && pl.songs.indexOf(id) < 0);
      if (!fresh.length) { toast('Pick at least one song to add'); return; }
      const before = pl.songs.slice();
      pl.songs = before.concat(fresh);
      savePlaylists();
      closeModal($('#plModal'));
      plEditId = null;
      /* if this playlist is what's currently queued, let "next" reach the new songs too */
      if (S.queue.length === before.length && before.every((id, i) => S.queue[i] === id)) S.queue = pl.songs.slice();
      if (String(S.col) === 'pl:' + pl.id) renderList(false);
      toast(fresh.length === 1 ? 'Added 1 song to “' + pl.name + '”' : 'Added ' + fresh.length + ' songs to “' + pl.name + '”');
      return;
    }
    const name = ($('#plName').value || '').trim() || 'My playlist';
    const ids = plPickOrder.slice();
    const id = 'p' + Date.now().toString(36);
    S.playlists.push({ id: id, name: name, songs: ids });
    savePlaylists();
    renderPlaylistNav();
    closeModal($('#plModal'));
    toast('Playlist “' + name + '” created');
    go('pl:' + id);
  });

  function openAddToPlaylist(songId) {
    const s = libMap.get(songId);
    if (!s) return;
    if (!S.playlists.length) {
      toast('Create a playlist first');
      openCreatePlaylist();
      return;
    }
    $('#atpSong').textContent = s.title;
    $('#plTargets').innerHTML = S.playlists.map(pl => {
      const has = pl.songs.indexOf(songId) >= 0;
      return '<button type="button" class="pl-target" data-pid="' + pl.id + '" data-sid="' + songId + '">' +
        '<span>' + esc(pl.name) + '</span><span class="meta">' +
        (has ? 'In playlist · tap to remove' : (pl.songs.length + ' songs · tap to add')) +
        '</span></button>';
    }).join('');
    openModal($('#addToPlModal'));
  }

  $('#plTargets').addEventListener('click', e => {
    const b = e.target.closest('.pl-target');
    if (!b) return;
    const pl = S.playlists.find(p => p.id === b.dataset.pid);
    if (!pl) return;
    const sid = b.dataset.sid;
    const i = pl.songs.indexOf(sid);
    if (i >= 0) { pl.songs.splice(i, 1); toast('Removed from “' + pl.name + '”'); }
    else { pl.songs.push(sid); toast('Added to “' + pl.name + '”'); }
    savePlaylists();
    openAddToPlaylist(sid);
    if (String(S.col) === 'pl:' + pl.id) renderList(false);
  });

  $('#npPlaylist').addEventListener('click', () => {
    if (!S.cur) { toast('Nothing is playing'); return; }
    openAddToPlaylist(S.cur);
  });

  $('#plDelete').addEventListener('click', () => {
    const col = String(S.col);
    if (!col.startsWith('pl:')) return; /* built-in collections can never be deleted */
    const pl = S.playlists.find(p => p.id === col.slice(3));
    if (!pl) return;
    if (!confirm(`Delete the playlist “${pl.name}”? Your songs stay in the library.`)) return;
    S.playlists = S.playlists.filter(p => p.id !== pl.id);
    savePlaylists();
    renderPlaylistNav();
    go('all');
    toast(`Playlist “${pl.name}” deleted`);
  });

  renderPlaylistNav();

  /* ------------------------------ play queue ------------------------------ */
  const queueModal = $('#queueModal');
  const queueList = $('#queueList');

  function openQueue() {
    renderQueue();
    openModal(queueModal);
  }

  function renderQueue() {
    const curSong = libMap.get(S.cur);
    if (curSong) {
      $('#queueCurrTitle').textContent = curSong.title;
      $('#queueCurrSub').textContent = `${curSong.genre}${curSong.duration ? ' · ' + fmt(curSong.duration) : ''}`;
    } else {
      $('#queueCurrTitle').textContent = '—';
      $('#queueCurrSub').textContent = '—';
    }

    const curIdx = S.queue.indexOf(S.cur);
    const upcoming = curIdx >= 0 ? S.queue.slice(curIdx + 1) : S.queue;
    $('#queueCount').textContent = String(upcoming.length);

    if (!upcoming.length) {
      queueList.innerHTML = '<p class="queue-empty">Queue is empty — songs will play from your current collection.</p>';
      return;
    }

    queueList.innerHTML = upcoming.map((id, idx) => {
      const s = libMap.get(id);
      if (!s) return '';
      const dur = s.duration ? fmt(s.duration) : '';
      return `<div class="queue-item" data-qid="${s.id}" data-idx="${curIdx + 1 + idx}">` +
        `<span class="q-idx">${pad2(idx + 1)}</span>` +
        `<span class="q-thumb" aria-hidden="true"></span>` +
        `<span class="q-title">${esc(s.title)}</span>` +
        (dur ? `<span class="q-dur">${dur}</span>` : '') +
        `<button type="button" class="q-del" data-qdel="${curIdx + 1 + idx}" aria-label="Remove from queue"><svg class="ico"><use href="#i-x"/></svg></button>` +
        `</div>`;
    }).join('');
  }

  queueList.addEventListener('click', e => {
    const del = e.target.closest('[data-qdel]');
    if (del) {
      e.stopPropagation();
      const idx = Number(del.dataset.qdel);
      if (idx >= 0 && idx < S.queue.length) {
        S.queue.splice(idx, 1);
        renderQueue();
      }
      return;
    }
    const item = e.target.closest('.queue-item');
    if (item && item.dataset.qid) {
      fadeTransition(() => loadSong(item.dataset.qid, true));
      renderQueue();
    }
  });

  $('#queueClearBtn').addEventListener('click', () => {
    const curIdx = S.queue.indexOf(S.cur);
    if (curIdx >= 0) S.queue = S.queue.slice(0, curIdx + 1);
    else S.queue = S.cur ? [S.cur] : [];
    renderQueue();
    toast('Upcoming queue cleared', 1600);
  });

  $('#queueShuffleBtn').addEventListener('click', () => {
    const curIdx = S.queue.indexOf(S.cur);
    const before = curIdx >= 0 ? S.queue.slice(0, curIdx + 1) : (S.cur ? [S.cur] : []);
    const after = curIdx >= 0 ? S.queue.slice(curIdx + 1) : S.queue.filter(id => id !== S.cur);
    for (let i = after.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [after[i], after[j]] = [after[j], after[i]];
    }
    S.queue = before.concat(after);
    renderQueue();
    toast('Queue shuffled', 1600);
  });

  const npQueue = $('#npQueue');
  if (npQueue) npQueue.addEventListener('click', openQueue);

  /* --------------------------- export & import ---------------------------- */
  function exportLibrary() {
    closeSidebar();
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      playlists: S.playlists,
      liked: Array.from(S.liked),
      recent: S.recent,
      settings: {
        theme: store.get('theme', 'dark'),
        vol: S.vol,
        shuffle: S.shuffle,
        repeatMode: S.repeatMode,
        speed: speed
      }
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stereo-library-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 20000);
    toast('Library exported successfully! 📁', 2400);
  }

  const exportBtn = $('#exportBtn');
  if (exportBtn) exportBtn.addEventListener('click', exportLibrary);

  const importInput = $('#importInput');
  const importBtn = $('#importBtn');
  if (importBtn && importInput) {
    importBtn.addEventListener('click', () => {
      closeSidebar();
      importInput.value = '';
      importInput.click();
    });

    importInput.addEventListener('change', async () => {
      const file = importInput.files && importInput.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data || typeof data !== 'object') throw new Error('Invalid JSON');
        if (Array.isArray(data.playlists)) {
          S.playlists = data.playlists;
          savePlaylists();
          renderPlaylistNav();
        }
        if (Array.isArray(data.liked)) {
          S.liked = new Set(data.liked);
          store.set('liked', Array.from(S.liked));
        }
        if (Array.isArray(data.recent)) {
          S.recent = data.recent;
          store.set('recent', S.recent);
        }
        if (data.settings) {
          if (data.settings.theme) { applyTheme(data.settings.theme); store.set('theme', data.settings.theme); }
          if (data.settings.vol != null) { S.vol = Number(data.settings.vol); applyVolume(); }
          if (data.settings.repeatMode) { applyRepeatMode(data.settings.repeatMode); }
          if (data.settings.speed != null) { applySpeed(data.settings.speed); }
        }
        renderList(true);
        toast('Library & playlists restored! 🎉', 3200);
      } catch (err) {
        toast('Failed to import backup file. Ensure it is a valid JSON file.', 3500);
      }
    });
  }

  /* Android app: tell the app when music plays so it keeps running with the screen off */
  if (window.StereoAndroid && window.StereoAndroid.setPlaying) {
    const notifyApp = playing => {
      try { const cur = libMap.get(S.cur); window.StereoAndroid.setPlaying(playing, cur ? cur.title : ''); } catch (e) {}
    };
    audio.addEventListener('playing', () => notifyApp(true));
    audio.addEventListener('pause', () => notifyApp(false));
  }

  /* ------------------------------ install app ----------------------------- */
  const installBtn = $('#installBtn');
  const setInstallHidden = h => { installBtn.hidden = h; };
  const inWrapper = !!(window.StereoAndroid || window.stereoDesktop); /* already running as an app */
  const standalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  let installEvent = null;

  function syncInstallBtn() {
    const can = window.isSecureContext && !inWrapper && !standalone();
    setInstallHidden(!can);
  }

  function installSteps() {
    const ua = navigator.userAgent;
    const iOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const android = /android/i.test(ua);
    const edge = /edg/i.test(ua);
    const firefox = /firefox|fxios/i.test(ua);
    const safariMac = !iOS && /Macintosh/.test(ua) && /safari/i.test(ua) && !/chrome|chromium|crios|edg|fxios/i.test(ua);
    if (iOS) return { lead: 'On iPhone and iPad, installing is done from the browser’s Share menu.', steps: [
      'Tap the <b>Share</b> button (the square with an arrow) in Safari’s toolbar.',
      'Scroll down and tap <b>Add to Home Screen</b>.',
      'Tap <b>Add</b>. Stereo now opens like any other app.'] };
    if (safariMac) return { lead: 'On Mac, Safari can add Stereo to your Dock.', steps: [
      'In the menu bar, choose <b>File → Add to Dock…</b>',
      'Click <b>Add</b>. Stereo now opens in its own window from the Dock.'] };
    if (firefox) return { lead: 'Firefox can’t install web apps.', steps: [
      'Open this page in <b>Chrome, Edge or Safari</b>.',
      'Then press <b>Install app</b> again.'] };
    if (android) return { lead: 'Installing is done from your browser’s menu.', steps: [
      'Tap the <b>⋮</b> menu in the top corner.',
      'Tap <b>Install app</b> (or <b>Add to Home screen</b>).',
      'Tap <b>Install</b>.'] };
    return { lead: 'Installing is done from your browser.', steps: [
      'Click the <b>install icon</b> at the right end of the address bar,' + (edge ? ' or open the <b>⋯</b> menu → <b>Apps → Install this site as an app</b>.' : ' or open the <b>⋮</b> menu → <b>Cast, save and share → Install page as app</b>.'),
      'Click <b>Install</b>. Stereo now opens in its own window.'] };
  }

  function showInstallHelp() {
    const h = installSteps();
    $('#installLead').textContent = h.lead;
    $('#installSteps').innerHTML = h.steps.map(t => '<li><span>' + t + '</span></li>').join('');
    openModal($('#installModal'));
  }

  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; syncInstallBtn(); });
  window.addEventListener('appinstalled', () => { installEvent = null; setInstallHidden(true); toast('Stereo installed 🎉', 3000); });
  if (window.matchMedia) {
    const mq = window.matchMedia('(display-mode: standalone)');
    if (mq.addEventListener) mq.addEventListener('change', syncInstallBtn);
  }
  async function onInstallClick() {
    closeSidebar();
    if (installEvent) {
      const ev = installEvent; installEvent = null; /* a saved prompt can only be used once */
      try {
        ev.prompt();
        const choice = await ev.userChoice;
        if (choice && choice.outcome === 'accepted') setInstallHidden(true);
      } catch (err) { showInstallHelp(); }
    } else showInstallHelp();
  }
  installBtn.addEventListener('click', onInstallClick);
  syncInstallBtn();

  /* ------------------------ sidebar: More options ------------------------- */
  const moreModal = $('#moreModal');
  $('#moreBtn').addEventListener('click', () => { closeSidebar(); openModal(moreModal); });
  $('.more-list', moreModal).addEventListener('click', e => {
    if (e.target.closest('button')) closeModal(moreModal); /* the option's own handler has already run */
  });

  /* ----------------------------- share Stereo ----------------------------- */
  const SHARE_URL = 'https://rishit-1010.github.io/Stereo';
  const SHARE_TEXT = "Check out Rishit's Stereo — a personal music player.";
  async function shareStereo() {
    closeSidebar();
    if (navigator.share) {
      try {
        await navigator.share({ title: "Rishit's Stereo", text: SHARE_TEXT, url: SHARE_URL });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(SHARE_URL);
      toast('Link copied — share it with anyone');
    } catch (e) {
      window.prompt('Copy this link to share Stereo:', SHARE_URL);
    }
  }
  const shareBtn = $('#shareBtn');
  if (shareBtn) shareBtn.addEventListener('click', shareStereo);

  /* offline cache + installability (only on the website; the Android / desktop apps bundle their own files) */
  if ('serviceWorker' in navigator && window.isSecureContext && !inWrapper) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  /* ---------------------------------- boot -------------------------------- */
  async function boot() {
    applyTheme(document.documentElement.getAttribute('data-theme') || 'dark');
    applyRepeatMode(S.repeatMode);
    syncShuffle();

    // restore the songs the visitor added on this device
    try {
      const recs = await DB.all();
      recs.sort((a, b) => a.added - b.added);
      userSongs = recs.filter(r => r && r.blob).map(toSong);
      rebuildLib();
    } catch (e) { /* no IndexedDB (private mode) — defaults only */ }

    // check cached offline audio files
    try {
      if ('caches' in window) {
        const c = await caches.open('stereo-audio-v1');
        const keys = await c.keys();
        const urls = new Set(keys.map(k => k.url));
        lib.forEach(s => {
          if (urls.has(s.src) || urls.has(new URL(s.src, location.href).href)) {
            S.offline.add(s.id);
          }
        });
      }
    } catch (e) {}

    const last = store.get('last', null);
    S.cur = libMap.has(last) ? last : (lib[0] && lib[0].id);
    setQueueFromView();
    showView('list', false);
    renderList(true);
    if (S.cur) { audio.src = libMap.get(S.cur).src; syncNow(); }
    updateProgress();
  }
  boot();
})();
