// Packs GLSL folders with lib/package.js and compares the result with a package made by the PC script (Node).
//   node test/repack_node.mjs <wasm folder> <expected deko3d_glsl.bin> <bound index.txt> <glsl folder>...
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildGlslPackage } from '../lib/package.js';

const [wasmDir, expected, index, ...folders] = process.argv.slice(2);
const { default: createZstdModule } = await import(pathToFileURL(path.join(wasmDir, 'zstd.mjs')));
const glsl = new Map();
for (const folder of folders) {
  for (const n of fs.readdirSync(folder)) {
    const m = /^((vs|ps)_[0-9A-F]{16})\.glsl$/.exec(n);
    if (m) glsl.set(m[1], fs.readFileSync(path.join(folder, n), 'utf8'));
  }
}
const bound = new Map();
for (const line of fs.readFileSync(index, 'utf8').split('\n')) {
  const [stem, inputs] = line.split(' ');
  if (inputs && inputs !== '-') bound.set(stem, inputs);
}
const started = Date.now();
const result = await buildGlslPackage(glsl, bound, () => createZstdModule({ print: (t) => console.log(t), printErr: (t) => console.error(t) }),
  (t) => console.log(t));
const want = fs.readFileSync(expected);
console.log(`${result.shaders} shaders, ${result.bound} bound, ${result.bytes.length} bytes (expected ${want.length}), ` +
  `${Buffer.compare(Buffer.from(result.bytes), want) === 0 ? 'IDENTICAL' : 'DIFFERENT'}, ${((Date.now() - started) / 1000).toFixed(1)} s`);
if (process.env.OUT) fs.writeFileSync(process.env.OUT, result.bytes);
