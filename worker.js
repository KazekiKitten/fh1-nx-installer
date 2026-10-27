// Makes the package off the main thread and streams the zip to the download (sw.js) through a MessagePort.
import { listIsoFiles } from './lib/iso.js';
import { SHADER_FILES, checkFile, createPackage, identifyGame } from './lib/installer.js';

const base = new URL('./', self.location.href).href;
const log = (text) => postMessage({ type: 'log', text });
const progress = (fraction) => postMessage({ type: 'progress', fraction });

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not download ${url} (HTTP ${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

// A gzipped file, decompressed by the browser. The NRO and the shader files are published gzipped: GitHub Pages serves
// files under 100 MB,
// and a GitHub release asset cannot be fetched by a page (its redirect has no CORS header).
async function fetchGzip(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not download ${url} (HTTP ${response.status})`);
  }
  const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Writes one chunk each time the download asks for more.
function portSink(port) {
  let credits = 0;
  let cancelled = false;
  let waiting = null;
  port.onmessage = ({ data }) => {
    if (data.type === 'pull') {
      credits++;
    } else if (data.type === 'cancel') {
      cancelled = true;
    }
    if (waiting) {
      const wake = waiting;
      waiting = null;
      wake();
    }
  };
  return {
    async write(bytes) {
      while (!credits && !cancelled) {
        await new Promise((resolve) => (waiting = resolve));
      }
      if (cancelled) {
        throw new Error('The download was cancelled');
      }
      credits--;
      const copy = bytes.slice();
      port.postMessage({ type: 'chunk', buffer: copy.buffer }, [copy.buffer]);
    },
    async close() {
      port.postMessage({ type: 'end' });
    },
    fail(message) {
      port.postMessage({ type: 'error', message });
    },
  };
}

function gameFiles(data) {
  if (data.kind === 'iso') {
    return listIsoFiles(data.file);
  }
  return data.entries.map(({ path, file }) => ({
    path,
    size: file.size,
    read: async (offset, length) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()),
  }));
}

self.onmessage = async ({ data }) => {
  const sink = portSink(data.port);
  try {
    log('Reading the game files');
    const files = await gameFiles(data);
    const manifest = JSON.parse(new TextDecoder().decode(await fetchBytes(`${base}release/manifest.json`)));
    const { build, xexHash } = await identifyGame(files, manifest);
    if (!build) {
      throw new Error(`This copy of the game is not supported (default.xex SHA-256 ${xexHash}). FH1-nx needs the ` +
        'USA retail disc, MS-2505.');
    }
    log('Downloading the program and its shaders');
    // `?sha256=` keeps each file in the service worker's program cache (sw.js) until the release changes it.
    const [nro, ...shaderBytes] = await Promise.all([
      fetchGzip(`${base}release/${build.nro_gz}?sha256=${build.nro_sha256}`),
      ...SHADER_FILES.map((f) => fetchGzip(`${base}release/${build[f.gz]}?sha256=${build[f.sha256]}`)),
    ]);
    await checkFile('program', nro, build.nro_sha256, build.nro_size);
    const shaders = {};
    for (const [i, f] of SHADER_FILES.entries()) {
      await checkFile(f.name, shaderBytes[i], build[f.sha256], build[f.size]);
      shaders[f.name] = shaderBytes[i];
    }
    log('Program and shaders: checked');
    const result = await createPackage(files, { manifest, nro, shaders }, sink, log, progress,
      (size) => postMessage({ type: 'size', size }), { update: Boolean(data.update) });
    postMessage({ type: 'done', result });
  } catch (error) {
    const message = error.message || String(error);
    sink.fail(message);
    postMessage({ type: 'error', message });
  }
};
