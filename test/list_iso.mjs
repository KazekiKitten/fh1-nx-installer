// Lists an Xbox 360 disc image with lib/iso.js (Node): top-level entries with their file count and size.
//   node test/list_iso.mjs <image.iso>
import fs from 'node:fs';
import { listIsoFiles } from '../lib/iso.js';

const fd = fs.openSync(process.argv[2], 'r');
const size = fs.fstatSync(fd).size;
const blob = {
  size,
  slice: (start, end) => ({
    arrayBuffer: async () => {
      const b = Buffer.alloc(end - start);
      fs.readSync(fd, b, 0, b.length, start);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
    },
  }),
};
const files = await listIsoFiles(blob);
const top = new Map();
for (const f of files) {
  const k = f.path.split('/')[0];
  const t = top.get(k) || { n: 0, size: 0 };
  t.n++;
  t.size += f.size;
  top.set(k, t);
}
for (const [k, t] of top) console.log(`${k}\t${t.n} files\t${(t.size / 1048576).toFixed(1)} MB`);
console.log(`${files.length} files, ${(files.reduce((s, f) => s + f.size, 0) / 1073741824).toFixed(2)} GB`);
