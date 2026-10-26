// Makes the package off the main thread and streams the zip to the download (sw.js) through a MessagePort.
import { listIsoFiles } from './lib/iso.js';
import { createPackage, identifyGame } from './lib/installer.js';
import { loadModules } from './lib/modules.js';

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

// A gzipped file, decompressed by the browser. The NRO is published gzipped: GitHub Pages serves files under 100 MB,
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
    log('Downloading the program and the shader tools');
    const [nro, shaderCommon, modules] = await Promise.all([
      build.nro_gz ? fetchGzip(`${base}release/${build.nro_gz}?sha256=${build.nro_sha256}`)
        : fetchBytes(`${base}release/${build.nro}?sha256=${build.nro_sha256}`),
      fetchBytes(`${base}shader_common.h`),
      loadModules(base, log),
    ]);
    const nroHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', nro))]
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    if (nroHash !== build.nro_sha256) {
      throw new Error(`The downloaded program is not the expected one (${nroHash}). Try again later.`);
    }
    const result = await createPackage(files, { manifest, nro, shaderCommon }, modules, sink, log, progress,
      (size) => postMessage({ type: 'size', size }), { update: Boolean(data.update) });
    postMessage({ type: 'done', result });
  } catch (error) {
    const message = error.message || String(error);
    sink.fail(message);
    postMessage({ type: 'error', message });
  }
};
