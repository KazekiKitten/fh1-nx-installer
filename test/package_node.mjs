// Makes the package with the page's code in Node, from a disc image or an extracted folder.
//   node test/package_node.mjs <game .iso | game folder> <fh1nx.nro> <output .zip> [--update]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { listIsoFiles } from '../lib/iso.js';
import { createPackage } from '../lib/installer.js';
import { loadModules } from '../lib/modules.js';

const [source, nroPath, output, flag] = process.argv.slice(2);
const base = pathToFileURL(path.resolve(path.dirname(new URL(import.meta.url).pathname), '..') + '/').href;

function fileReader(fd) {
  return async (offset, length) => {
    const b = Buffer.alloc(length);
    fs.readSync(fd, b, 0, length, offset);
    return new Uint8Array(b.buffer, b.byteOffset, length);
  };
}

let files;
if (fs.statSync(source).isDirectory()) {
  files = [];
  const walk = (dir, prefix) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), rel);
      else {
        const p = path.join(dir, e.name);
        const fd = fs.openSync(p, 'r');
        files.push({ path: rel, size: fs.fstatSync(fd).size, read: fileReader(fd) });
      }
    }
  };
  walk(source, '');
} else {
  const fd = fs.openSync(source, 'r');
  const read = fileReader(fd);
  files = await listIsoFiles({
    size: fs.fstatSync(fd).size,
    slice: (start, end) => ({ arrayBuffer: async () => (await read(start, end - start)).slice().buffer }),
  });
}

const out = fs.openSync(output, 'w');
const sink = { write: async (bytes) => void fs.writeSync(out, bytes), close: async () => fs.closeSync(out) };
const started = Date.now();
const log = (t) => console.log(`${((Date.now() - started) / 1000).toFixed(0).padStart(5)} s  ${t}`);
const modules = await loadModules(base, log);
log('modules loaded');
const release = {
  manifest: JSON.parse(fs.readFileSync(new URL('release/manifest.json', base), 'utf8')),
  nro: new Uint8Array(fs.readFileSync(nroPath)),
  shaderCommon: new Uint8Array(fs.readFileSync(new URL('shader_common.h', base))),
};
let size = 0;
const result = await createPackage(files, release, modules, sink, log, () => {}, (s) => (size = s),
  { update: flag === '--update' });
const written = fs.statSync(output).size;
log(`${result.edition}: ${result.shaders} shaders, ${written} bytes (announced ${size}, ${written === size ? 'same' : 'DIFFERENT'})`);
