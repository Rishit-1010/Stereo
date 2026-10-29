/* Rishit's Stereo — service worker
   - player shell & assets: network first, cached copy when offline
   - logos / covers / fonts: cached after first visit
   - audio: not intercepted (offline songs are played from the cache by script.js) */
'use strict';

const CACHE = 'stereo-v6';
const AUDIO_CACHE = 'stereo-audio-v1';
const SHELL = [
  './', './index.html', './style.css', './script.js', './songs.js', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './apple-touch-icon.png'
];
const MEDIA_HOSTS = ['raw.githubusercontent.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.all(SHELL.map(u => cache.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== AUDIO_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function handleAudioRequest(req) {
  const cacheHit = (await caches.match(req, { ignoreSearch: true })) || (await caches.open(AUDIO_CACHE).then(c => c.match(req, { ignoreSearch: true })));
  if (!cacheHit) {
    return fetch(req);
  }
  const rangeHeader = req.headers.get('range');
  if (!rangeHeader) {
    return cacheHit;
  }
  try {
    const arrayBuffer = await cacheHit.arrayBuffer();
    const total = arrayBuffer.byteLength;
    const match = /bytes=(\d+)-(\d+)?/.exec(rangeHeader);
    if (!match) return cacheHit;
    const start = parseInt(match[1], 10);
    const end = match[2] ? parseInt(match[2], 10) : total - 1;
    const sliced = arrayBuffer.slice(start, end + 1);
    return new Response(sliced, {
      status: 206,
      statusText: 'Partial Content',
      headers: {
        'Content-Type': cacheHit.headers.get('Content-Type') || 'audio/mpeg',
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Content-Length': String(sliced.byteLength),
        'Accept-Ranges': 'bytes'
      }
    });
  } catch (err) {
    return cacheHit;
  }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  /* audio is never intercepted: the browser streams it natively so playback survives the screen locking */
  if (/\.(mp3|m4a|aac|wav|ogg|opus)$/i.test(url.pathname) || url.pathname.includes('/tracks/') || url.pathname.includes('/releases/download/')) return;

  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true })
          .then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
    );
    return;
  }

  if (MEDIA_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.match(req).then(hit => {
        const refresh = fetch(req).then(res => {
          if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
          return res;
        }).catch(() => hit);
        return hit || refresh;
      })
    );
  }
});
