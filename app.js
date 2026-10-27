// The page: picks the game, runs worker.js and hands its zip stream to sw.js as a download.

const $ = (id) => document.getElementById(id);
const startButton = $('start');
const logBox = $('log');
let downloadFrame = null;

function log(text, error = false) {
  const line = document.createElement('div');
  line.textContent = text;
  if (error) {
    line.className = 'error';
  }
  logBox.appendChild(line);
  logBox.scrollTop = logBox.scrollHeight;
}

function formatSize(bytes) {
  return bytes >= 1 << 30 ? `${(bytes / (1 << 30)).toFixed(2)} GB` : `${(bytes / (1 << 20)).toFixed(0)} MB`;
}

function kind() {
  return document.querySelector('input[name="kind"]:checked').value;
}

function source() {
  if (kind() === 'iso') {
    const file = $('iso').files[0];
    return file ? { kind: 'iso', file } : null;
  }
  const all = [...$('folder').files];
  if (!all.length) {
    return null;
  }
  // The common top folder goes, so paths start at default.xex / media.
  const first = (all[0].webkitRelativePath || all[0].name).split('/');
  const strip = first.length > 1 ? `${first[0]}/` : '';
  return {
    kind: 'folder',
    entries: all.map((file) => {
      const relative = file.webkitRelativePath || file.name;
      return { path: strip && relative.startsWith(strip) ? relative.slice(strip.length) : relative, file };
    }),
  };
}

function refresh() {
  $('iso').hidden = kind() !== 'iso';
  $('folder').hidden = kind() !== 'folder';
  startButton.disabled = !source();
}
for (const input of document.querySelectorAll('input')) {
  input.addEventListener('change', refresh);
}

// sw.js serves the zip as a normal download, streamed while it is made.
async function downloadHelper() {
  if (!('serviceWorker' in navigator)) {
    throw new Error('This browser cannot stream downloads (no service workers). Try Chrome, Edge or Firefox.');
  }
  await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
  const registration = await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    const claimed = new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    registration.active.postMessage({ type: 'claim' });
    await claimed;
  }
  return navigator.serviceWorker.controller;
}
const helper = downloadHelper();
helper.catch((error) => log(error.message, true));

startButton.addEventListener('click', async () => {
  const picked = source();
  if (!picked) {
    return;
  }
  try {
    await helper;
  } catch {
    return;
  }
  // The helper that controls the page now: a new sw.js installed after the page loaded replaces the one there was
  // then, and a message to the replaced one is never answered.
  const current = () => navigator.serviceWorker.controller;
  startButton.disabled = true;
  logBox.textContent = '';
  $('progress').hidden = false;
  $('progress').value = 0;
  $('status').textContent = 'Working…';

  const worker = new Worker('./worker.js', { type: 'module' });
  const channel = new MessageChannel();
  const keepAlive = setInterval(() => current()?.postMessage({ type: 'ping' }), 10000);
  const finish = (text, error = false) => {
    clearInterval(keepAlive);
    worker.terminate();
    $('status').textContent = text;
    $('status').className = error ? 'error' : 'muted';
    startButton.disabled = false;
  };
  worker.onmessage = async ({ data }) => {
    if (data.type === 'log') {
      log(data.text);
    } else if (data.type === 'progress') {
      $('progress').value = data.fraction;
    } else if (data.type === 'size') {
      const id = crypto.randomUUID();
      const filename = 'fh1-nx.zip';
      const ack = new MessageChannel();
      const registered = new Promise((resolve) => (ack.port1.onmessage = resolve));
      const controller = current();
      if (!controller) {
        log('The download helper is not running. Reload the page (F5) and try again.', true);
        finish('Something went wrong (see above).', true);
        return;
      }
      controller.postMessage({ type: 'download', id, filename, size: data.size }, [channel.port2, ack.port2]);
      const answered = await Promise.race([registered.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 10000))]);
      if (!answered) {
        log('The download helper did not answer. Reload the page (F5) and try again.', true);
        finish('Something went wrong (see above).', true);
        return;
      }
      // A hidden frame opens the download: a navigation always reaches the service worker.
      downloadFrame?.remove();
      downloadFrame = document.createElement('iframe');
      downloadFrame.hidden = true;
      downloadFrame.src = `./download/${id}/${filename}`;
      document.body.appendChild(downloadFrame);
      log(`Download started (${formatSize(data.size)})`);
    } else if (data.type === 'done') {
      finish('Done. Extract fh1-nx.zip into sdmc:/switch/.');
    } else if (data.type === 'error') {
      log(data.message, true);
      finish('Something went wrong (see above).', true);
    }
  };
  worker.onerror = (event) => {
    log(event.message || 'The worker stopped', true);
    finish('Something went wrong (see above).', true);
  };
  worker.postMessage({ ...picked, update: $('update').checked, port: channel.port1 }, [channel.port1]);
});

refresh();
