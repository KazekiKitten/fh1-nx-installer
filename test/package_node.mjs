// Makes the package with the page's code in Node, from a disc image or an extracted folder, with the program and
// shader files of release/ (the gzipped ones the page downloads, checked against release/manifest.json).
//   node test/package_node.mjs <game .iso | game folder> <output .zip> [--update]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { listIsoFiles } from '../lib/iso.js';
import { SHADER_FILES, checkFile, createPackage, identifyGame } from '../lib/installer.js';

const [source, output, flag] = process.argv.slice(2);
const release = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'release');

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

const manifest = JSON.parse(fs.readFileSync(path.join(release, 'manifest.json'), 'utf8'));
const { build, xexHash } = await identifyGame(files, manifest);
if (!build) {
  throw new Error(`default.xex ${xexHash} is not in the manifest`);
}
const gunzip = (name) => new Uint8Array(zlib.gunzipSync(fs.readFileSync(path.join(release, name))));
const nro = gunzip(build.nro_gz);
await checkFile('program', nro, build.nro_sha256, build.nro_size);
const shaders = {};
for (const f of SHADER_FILES) {
  shaders[f.name] = gunzip(build[f.gz]);
  await checkFile(f.name, shaders[f.name], build[f.sha256], build[f.size]);
}

const out = fs.openSync(output, 'w');
const sink = { write: async (bytes) => void fs.writeSync(out, bytes), close: async () => fs.closeSync(out) };
const started = Date.now();
const log = (t) => console.log(`${((Date.now() - started) / 1000).toFixed(0).padStart(5)} s  ${t}`);
let size = 0;
const result = await createPackage(files, { manifest, nro, shaders }, sink, log, () => {}, (s) => (size = s),
  { update: flag === '--update' });
const written = fs.statSync(output).size;
log(`${result.edition}: ${result.files} game files, ${written} bytes (announced ${size}, ${written === size ? 'same' : 'DIFFERENT'})`);
