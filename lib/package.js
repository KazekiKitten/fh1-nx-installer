// The renderer's two shader files, as FH1-nx's PC tools write them:
//   deko3d_glsl.bin     tools/deko3d_shader_package.py: the GLSL, one zstd frame per shader with a trained dictionary
//   fh1_shaders.nfsspv  tools/fh1_shader_library.py: the container of each packaged shader, by XXH3-64
// Both must come out byte for byte as the PC's (the manifest's sha256); the zstd steps run zstd's own command line
// (wasm/zstd.mjs) with the arguments the script passes.

const encoder = new TextEncoder();

// glsl: Map stem ("vs_<HASH>" / "ps_<HASH>") -> GLSL text; bound: Map stem -> "k:usage.index,..." (vertex shaders
// that fetch bound inputs). createZstd() makes a fresh zstd module (the command line keeps state between runs).
export async function buildGlslPackage(glsl, bound, createZstd, log = () => {}) {
  const names = [...glsl.keys()].sort();
  if (!names.length) {
    throw new Error('no shaders to package');
  }
  const texts = new Map();
  let withBound = 0;
  for (const n of names) {
    let text = glsl.get(n);
    const inputs = n.startsWith('vs_') ? bound.get(n) : null;
    if (inputs) {
      // A "// fh1-bound=" line after the banjo-dk line (src/renderer/fh1_dk_shaders.h, UsoShader::atados).
      const first = text.indexOf('\n', text.indexOf('// banjo-dk ')) + 1;
      text = text.slice(0, first) + `// fh1-bound=${inputs}\n` + text.slice(first);
      withBound++;
    }
    texts.set(n, encoder.encode(text));
  }
  if (bound.size && !withBound) {
    throw new Error('the bound inputs name no shader of the package');
  }

  // zstd --train over every file, then -19 with that dictionary, 300 files a run, as the script does.
  const files = names.map((n) => `src/${n}`);
  let zstd = await createZstd();
  zstd.FS.mkdirTree('/w/src');
  zstd.FS.chdir('/w');
  for (const n of names) {
    zstd.FS.writeFile(`/w/src/${n}`, texts.get(n));
  }
  log('training the compression dictionary');
  let rc = zstd.callMain(['--train', '-q', '--maxdict=131072', '-o', 'dict', ...files]);
  if (rc) {
    throw new Error(`zstd --train failed (${rc})`);
  }
  const dictionary = zstd.FS.readFile('/w/dict');
  const compressed = new Map();
  for (let i = 0; i < files.length; i += 300) {
    zstd = await createZstd();
    zstd.FS.mkdirTree('/w/src');
    zstd.FS.mkdirTree('/w/z');
    zstd.FS.chdir('/w');
    zstd.FS.writeFile('/w/dict', dictionary);
    const batch = names.slice(i, i + 300);
    for (const n of batch) {
      zstd.FS.writeFile(`/w/src/${n}`, texts.get(n));
    }
    rc = zstd.callMain(['-19', '-q', '-f', '-D', 'dict', '--output-dir-flat', 'z', ...batch.map((n) => `src/${n}`)]);
    if (rc) {
      throw new Error(`zstd failed (${rc})`);
    }
    for (const n of batch) {
      compressed.set(n, zstd.FS.readFile(`/w/z/${n}.zst`));
    }
    log(`compressed ${Math.min(i + 300, files.length)}/${files.length} shaders`);
  }

  const entries = [];
  const pieces = [];
  let dataSize = 0;
  const constant = /#define SPIRV_CROSS_CONSTANT_ID_(\d+) /g;
  for (const n of names) {
    const text = texts.get(n);
    const comp = compressed.get(n);
    const mask = new Uint32Array(8);
    for (const m of glslOf(text).matchAll(constant)) {
      const i = Number(m[1]);
      if (i >= 1000 && i < 1256) {
        mask[(i - 1000) >> 5] |= 1 << ((i - 1000) & 31);
      }
    }
    entries.push({ hash: BigInt(`0x${n.slice(3, 19)}`), offset: dataSize, csize: comp.length, size: text.length,
      stage: n.startsWith('ps_') ? 4 : 0, mask });
    pieces.push(comp);
    dataSize += comp.length;
    const pad = -dataSize & 7;
    if (pad) {
      pieces.push(new Uint8Array(pad));
      dataSize += pad;
    }
  }
  entries.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));
  const tableOffset = 32 + dictionary.length + (-(32 + dictionary.length) & 7);
  const dataOffset = tableOffset + 56 * entries.length;
  const out = new Uint8Array(dataOffset + dataSize);
  const view = new DataView(out.buffer);
  out.set(encoder.encode('BDKG'), 0);
  [1, entries.length, dictionary.length, tableOffset, dataOffset, 0, 0].forEach((v, k) => view.setUint32(4 + 4 * k, v, true));
  out.set(dictionary, 32);
  entries.forEach((e, k) => {
    const at = tableOffset + 56 * k;
    view.setBigUint64(at, e.hash, true);
    view.setUint32(at + 8, e.offset, true);
    view.setUint32(at + 12, e.csize, true);
    view.setUint32(at + 16, e.size, true);
    view.setUint32(at + 20, e.stage, true);
    e.mask.forEach((w, j) => view.setUint32(at + 24 + 4 * j, w, true));
  });
  let at = dataOffset;
  for (const p of pieces) {
    out.set(p, at);
    at += p.length;
  }
  return { bytes: out, shaders: entries.length, bound: withBound };
}

const decoder = new TextDecoder('latin1');
function glslOf(bytes) {
  return decoder.decode(bytes);
}

// containers: Map hash ("<HASH>", upper-case hex) -> container bytes, one per hash; stages: Map hash -> true for a
// vertex shader (the packaged GLSL's). xxh3(bytes) -> "<HASH>".
export function buildShaderLibrary(containers, stages, xxh3) {
  const found = [];
  for (const [hash, vertex] of stages) {
    const container = containers.get(hash);
    if (!container) {
      throw new Error(`shader ${hash} of the package has no container`);
    }
    if (Boolean(container[3] & 1) !== vertex) {
      throw new Error(`${hash}: the container's stage is not the GLSL's`);
    }
    found.push({ hash: BigInt(`0x${hash}`), container });
  }
  // Sorted by (hash, bytes); hashes are unique here, so by hash.
  found.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));
  const bodySize = found.reduce((n, e) => n + 16 + e.container.length, 0);
  // "NFSSPV\0\0", u32 version 2, u32 count, u64 XXH3-64 of the entries: 24 bytes.
  const out = new Uint8Array(24 + bodySize);
  const view = new DataView(out.buffer);
  out.set(encoder.encode('NFSSPV\0\0'), 0);
  view.setUint32(8, 2, true);
  view.setUint32(12, found.length, true);
  let at = 24;
  for (const e of found) {
    view.setUint32(at, e.container.length, true);
    view.setUint32(at + 4, 0, true);
    view.setBigUint64(at + 8, e.hash, true);
    out.set(e.container, at + 16);
    at += 16 + e.container.length;
  }
  view.setBigUint64(16, BigInt(`0x${xxh3(out.subarray(24))}`), true);
  return out;
}
