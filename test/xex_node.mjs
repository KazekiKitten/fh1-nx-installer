// Decompresses default.xex with lib/xex.js and wasm/lzx.mjs and compares it with an image file (Node).
//   node test/xex_node.mjs <wasm folder> <default.xex> <expected image>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readXexImage } from '../lib/xex.js';
import { lzxStep } from '../lib/lzx.js';

const [wasmDir, xexPath, expected] = process.argv.slice(2);
const { default: createLzxModule } = await import(pathToFileURL(path.join(wasmDir, 'lzx.mjs')));
const lzx = await createLzxModule();
const step = lzxStep(lzx);
const { image, windowBits, blocks } = await readXexImage(new Uint8Array(fs.readFileSync(xexPath)), async (b, w, s) => {
  const out = step(b, w, s);
  if (!out) throw new Error('LZX failed');
  return out;
});
const want = fs.readFileSync(expected);
if (process.env.OUT) fs.writeFileSync(process.env.OUT, image);
console.log(`${image.length} bytes, window ${windowBits}, ${blocks} blocks: ${Buffer.compare(Buffer.from(image), want) === 0 ? 'IDENTICAL' : `DIFFERENT (expected ${want.length})`}`);
