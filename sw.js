// Serves the zip the page makes as a normal browser download, streamed while it is written (one chunk per "pull", so
// memory stays bounded at any size), and keeps the page and the program for use without a connection.
// Based on nfsmw-nx-installer's sw.js (GPL-3.0).

const PAGE_CACHE = 'fh1-nx-page-v1';
const PROGRAM_CACHE = 'fh1-nx-programs';
const NETWORK_WAIT = 4000;

const jobs = new Map();

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name !== PAGE_CACHE && name !== PROGRAM_CACHE) {
        await caches.delete(name);
      }
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'download') {
    const [port, ack] = event.ports;
    jobs.set(data.id, { port, size: data.size, filename: data.filename });
    ack.postMessage('registered');
  } else if (data.type === 'claim') {
    event.waitUntil(self.clients.claim());
  }
  // "ping" only keeps this worker alive while a download runs.
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const match = /\/download\/([\w-]+)\/[^/]+$/.exec(url.pathname);
  if (match) {
    const job = jobs.get(match[1]);
    if (job) {
      jobs.delete(match[1]);
      event.respondWith(serveDownload(job));
    }
    return;
  }
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }
  // The program's address names its SHA-256: a kept copy is always the right one.
  event.respondWith(url.searchParams.has('sha256') ? fromCache(PROGRAM_CACHE, request, true) : fromCache(PAGE_CACHE, request, false));
});

function serveDownload({ port, size, filename }) {
  const stream = new ReadableStream({
    start(controller) {
      port.onmessage = ({ data }) => {
        if (data.type === 'chunk') {
          controller.enqueue(new Uint8Array(data.buffer));
        } else if (data.type === 'end') {
          controller.close();
        } else if (data.type === 'error') {
          controller.error(new Error(data.message));
        }
      };
    },
    pull() {
      port.postMessage({ type: 'pull' });
    },
    cancel() {
      port.postMessage({ type: 'cancel' });
    },
  }, { highWaterMark: 4 });
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(size),
    },
  });
}

// Page files: the network first (checked with the server, GitHub Pages caches for ten minutes), the kept copy when
// the network fails or is slow. The program: the kept copy first.
async function fromCache(name, request, keptFirst) {
  const cache = await caches.open(name);
  const key = new URL(request.url);
  if (!keptFirst) {
    key.search = '';
  }
  const kept = await cache.match(key.href);
  if (kept && keptFirst) {
    return kept;
  }
  const network = fetch(request.url, { cache: 'no-cache' }).then(async (fresh) => {
    if (fresh.ok && fresh.type === 'basic') {
      try {
        await cache.put(key.href, fresh.clone());
      } catch {
        // no room: the page keeps working from the network
      }
    }
    return fresh;
  });
  if (!kept) {
    return network;
  }
  return Promise.race([
    network.then((fresh) => (fresh.status >= 500 ? kept : fresh), () => kept),
    new Promise((resolve) => setTimeout(() => resolve(kept), NETWORK_WAIT)),
  ]);
}
