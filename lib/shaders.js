// Makes the renderer's two shader files from the game files, in the browser (or Node), with the PC build's steps
// (FH1-nx docs/shaders.md and docs/installer.md):
//
//   the files with containers  media/shaders/**/*.fxobj, the .fxobj members of media/**/*.zip, default.xex's image
//                              (tools/fh1_dump_containers.py), and Direct3D's own four programs from that image,
//                              wrapped (tools/fh1_wrap_d3d_shaders.py)
//   XenosRecomp                wasm/hlsl.mjs: HLSL, the bound vertex inputs and each container
//   DXC                        wasm/dxc.mjs: the deko3d SPIR-V
//   SPIRV-Cross, GLSL passes   wasm/spirv_cross.mjs, then fh1_glsl_web.py under Pyodide (tools/deko3d_shaders.py,
//                              tools/deko3d_glsl_opt.py)
//   the files                  lib/package.js: deko3d_glsl.bin and fh1_shaders.nfsspv
//
// files: [{ path, size, read(offset, length) }] with paths from the game root (default.xex, media/...).

import { listArchive, readMember } from './archive.js';
import { buildGlslPackage, buildShaderLibrary } from './package.js';
import { crc32Update } from './zip.js';

const utf8 = new TextDecoder('utf-8');

function flatName(path) {
  return path.replaceAll('!/', '__').replaceAll('/', '__');
}

// tools/fh1_wrap_d3d_shaders.py's wrap(): a 2008 container around raw microcode, linked by register.
export function wrapProgram(code, vertex) {
  const shader = 0x24;
  const virtual = shader + (vertex ? 36 : 32) + 16 * 4;
  const c = new Uint8Array(virtual + code.length);
  const view = new DataView(c.buffer);
  const put = (offset, value) => view.setUint32(offset, value >>> 0, false);
  put(0, 0x102a1100 | (vertex ? 1 : 0));
  put(4, virtual);
  put(8, code.length);
  put(24, shader);
  put(shader + 4, code.length);
  put(shader + 20, 16 << 5);
  const table = shader + (vertex ? 36 : 32);
  if (!vertex) {
    put(shader + 28, 0x01);
  }
  for (let register = 0; register < 16; register++) {
    put(table + register * 4, (register << 8) | (5 << 4) | register);
  }
  c.set(code, virtual);
  return c;
}

// The files XenosRecomp scans, as [{ name, bytes }]. image: default.xex's decompressed image.
async function containerFiles(files, image, d3dPrograms, xxh3, decompressLzx, log) {
  const out = [];
  for (const f of files.filter((f) => f.path.startsWith('media/shaders/') && f.path.endsWith('.fxobj'))) {
    out.push({ name: flatName(f.path), bytes: await f.read(0, f.size) });
  }
  out.push({ name: 'default.xex.image', bytes: image });
  const crc32 = (bytes) => crc32Update(0, bytes);
  const archives = files.filter((f) => f.path.startsWith('media/') && f.path.endsWith('.zip'));
  let members = 0;
  for (const archive of archives) {
    for (const m of await listArchive(archive)) {
      if (!m.name.endsWith('/') && m.name.toLowerCase().endsWith('.fxobj')) {
        out.push({ name: flatName(`${archive.path}!/${m.name}`), bytes: await readMember(archive, m, decompressLzx, crc32) });
        members++;
      }
    }
  }
  log(`shader files: ${out.length} (${members} from ${archives.length} track archives)`);
  for (const p of d3dPrograms) {
    const code = image.subarray(p.offset, p.offset + p.words * 4);
    if (xxh3(code) !== p.hash) {
      throw new Error(`Direct3D program ${p.hash} is not where this edition has it`);
    }
    out.push({ name: `d3d_${p.vertex ? 'vs' : 'ps'}_${p.hash}.bin`, bytes: wrapProgram(code, p.vertex) });
  }
  return out;
}

// modules: { hlsl, dxc, spirvCross, glsl(stem, text) -> text | null, createZstd() };
// shaderCommon: XenosRecomp's shader_common.h. Returns { glslPackage, library, shaders }.
export async function buildShaders(files, image, { modules, shaderCommon, d3dPrograms }, log = () => {},
  progress = () => {}) {
  const { hlsl, dxc, spirvCross, glsl, createZstd } = modules;
  const xxh3 = (bytes) => {
    const p = hlsl._malloc(bytes.length + 17);
    hlsl.HEAPU8.set(bytes, p);
    hlsl.ccall('fh1_xxh3_hex', null, ['number', 'number', 'number'], [p, bytes.length, p + bytes.length]);
    const hex = utf8.decode(hlsl.HEAPU8.subarray(p + bytes.length, p + bytes.length + 16));
    hlsl._free(p);
    return hex;
  };

  const inputs = await containerFiles(files, image, d3dPrograms, xxh3, modules.decompressLzx, log);
  hlsl.FS.mkdirTree('/in');
  for (const f of inputs) {
    hlsl.FS.writeFile(`/in/${f.name}`, f.bytes);
  }
  hlsl.FS.writeFile('/shader_common.h', shaderCommon);
  const rc = hlsl.callMain(['/in', '/out', '/shader_common.h']);
  if (rc) {
    throw new Error(`shader translation failed (${rc})`);
  }
  const index = utf8.decode(hlsl.FS.readFile('/out/index.txt')).split('\n').filter(Boolean);
  const bound = new Map();
  for (const line of index) {
    const [stem, inputs] = line.split(' ');
    if (inputs !== '-') {
      bound.set(stem, inputs);
    }
  }
  log(`translated ${index.length} shaders`);

  const texts = new Map();
  let failed = 0;
  let done = 0;
  // The Vulkan GLSL of one shader (null: DXC could not compile it) through the GLSL passes into the package.
  const add = (stem, vulkan) => {
    if (vulkan === null) {
      failed++; // XenosRecomp writes <hash>.fail: no GLSL, as on the PC (the memory-export shader)
    } else {
      const text = glsl(stem, vulkan);
      if (text) {
        texts.set(stem, text);
      }
    }
    done++;
    if (done % 50 === 0 || done === index.length) {
      log(`compiled ${done}/${index.length} shaders`);
      progress(done / index.length);
    }
  };
  const stems = index.map((line) => line.split(' ')[0]);
  if (modules.pool) {
    // lib/dxc_pool.js: DXC and SPIRV-Cross in several workers at once.
    log(`compiling with ${modules.pool.size} workers`);
    await modules.pool.compileAll(stems.map((stem) => ({ stem, hlsl: hlsl.FS.readFile(`/out/${stem}.hlsl`) })), add);
  } else {
    dxc.FS.mkdirTree('/w');
    spirvCross.FS.mkdirTree('/w');
    for (const stem of stems) {
      dxc.FS.writeFile('/w/in.hlsl', hlsl.FS.readFile(`/out/${stem}.hlsl`));
      if (dxc.ccall('compile', 'number', ['string', 'string', 'number'], ['/w/in.hlsl', '/w/out.spv', stem.startsWith('ps_') ? 1 : 0])) {
        add(stem, null);
        continue;
      }
      spirvCross.FS.writeFile('/w/in.spv', dxc.FS.readFile('/w/out.spv'));
      if (spirvCross.callMain(['/w/in.spv', '--version', '460', '--vulkan-semantics', '--relax-nan-checks', '--output',
        '/w/out.glsl'])) {
        throw new Error(`SPIRV-Cross rejected ${stem}`);
      }
      add(stem, utf8.decode(spirvCross.FS.readFile('/w/out.glsl')));
    }
  }
  log(`${texts.size} shaders in the package, ${failed} DXC could not compile`);

  const glslPackage = await buildGlslPackage(texts, bound, createZstd, log);
  const containers = new Map();
  const stages = new Map();
  for (const stem of texts.keys()) {
    const hash = stem.slice(3);
    containers.set(hash, hlsl.FS.readFile(`/out/c/${hash}.bin`));
    stages.set(hash, stem.startsWith('vs_'));
  }
  const library = buildShaderLibrary(containers, stages, xxh3);
  return { glslPackage: glslPackage.bytes, library, shaders: texts.size };
}
