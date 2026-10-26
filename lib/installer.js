// Identifies the disc and writes the package: fh1-nx/ with the program, the renderer's two shader files and (unless
// it is an update) the game files under game_root/. The program writes its own fh1nx.toml on the first start, so an
// update never replaces the player's settings.

import { buildShaders } from './shaders.js';
import { readXexImage } from './xex.js';
import { ZipWriter, zipSize } from './zip.js';

export const ROOT = 'fh1-nx';

export async function sha256(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function* chunksOf(file, size = 4 * 1024 * 1024) {
  for (let offset = 0; offset < file.size; offset += size) {
    yield await file.read(offset, Math.min(size, file.size - offset));
  }
}

// Every disc file but the console's system update.
function isGameFile(path) {
  return !path.startsWith('$SystemUpdate/');
}

// The build for this disc: { build, xexHash, xex } (build null when the disc is not supported).
export async function identifyGame(files, manifest) {
  const entry = files.find((f) => f.path.toLowerCase() === 'default.xex');
  if (!entry) {
    throw new Error('default.xex is missing: choose the Forza Horizon disc image or its extracted folder');
  }
  const xex = await entry.read(0, entry.size);
  const xexHash = await sha256(xex);
  return { xex, xexHash, build: manifest.builds.find((b) => b.xex_sha256 === xexHash) || null };
}

// release: { manifest, nro, shaderCommon, variants }; modules: lib/shaders.js's, plus decompressLzx and dkshCache(glsl,
// variants, log) (lib/dksh_pool.js; without it no shader cache is made); sink: the zip's
// destination ({ write, close }).
export async function createPackage(files, release, modules, sink, log = () => {}, progress = () => {},
  onSize = () => {}, { update = false } = {}) {
  const { xex, xexHash, build } = await identifyGame(files, release.manifest);
  if (!build) {
    throw new Error(`This copy of the game is not supported (default.xex SHA-256 ${xexHash}). FH1-nx needs the USA ` +
      'retail disc, MS-2505.');
  }
  log(`Disc: ${build.edition}`);
  const decompress = async (bytes, windowBits, size) => {
    const out = modules.decompressLzx(bytes, windowBits, size);
    if (!out) {
      throw new Error('default.xex could not be decompressed');
    }
    return out;
  };
  const { image } = await readXexImage(xex, decompress);

  const game = files.filter((f) => isGameFile(f.path)).sort((a, b) => a.path.toLowerCase().localeCompare(b.path.toLowerCase()));
  const copies = update ? [] : game;
  // The shaders first: if this browser cannot make them, nothing has been copied yet, and the download (which starts
  // when its size is known) does not sit at 0 bytes meanwhile.
  const shaders = await buildShaders(files, image, { modules, shaderCommon: release.shaderCommon,
    d3dPrograms: build.d3d_programs }, log, (f) => progress(update ? f : 0.25 * f));
  const glslHash = await sha256(shaders.glslPackage);
  const libraryHash = await sha256(shaders.library);
  if (glslHash !== build.glsl_sha256 || libraryHash !== build.library_sha256) {
    throw new Error(`The shaders did not come out as the tested ones (deko3d_glsl.bin ${glslHash}, fh1_shaders.nfsspv ` +
      `${libraryHash}). Please report this with the log.`);
  }
  log(`Shaders: ${shaders.shaders}, checked`);
  // The renderer's DKSH cache (lib/dksh_pool.js), when the build lists one: compiled from the checked package and
  // the release's variants list, and checked the same way.
  let dksh = null;
  if (build.dksh_sha256 && modules.dkshCache) {
    dksh = await modules.dkshCache(shaders.glslPackage, release.variants, log);
    const dkshHash = await sha256(dksh);
    if (dkshHash !== build.dksh_sha256) {
      throw new Error(`The shader cache did not come out as the tested one (shadercache_dksh.bin ${dkshHash}). ` +
        'Please report this with the log.');
    }
    log('Shader cache: checked');
  }
  onSize(zipSize([
    { path: `${ROOT}/fh1nx.nro`, size: release.nro.length },
    ...copies.map((f) => ({ path: `${ROOT}/game_root/${f.path}`, size: f.size })),
    { path: `${ROOT}/deko3d_glsl.bin`, size: shaders.glslPackage.length },
    { path: `${ROOT}/fh1_shaders.nfsspv`, size: shaders.library.length },
    ...(dksh ? [{ path: `${ROOT}/shadercache_dksh.bin`, size: dksh.length }] : []),
  ]));

  const zip = new ZipWriter(sink);
  await zip.addBytes(`${ROOT}/fh1nx.nro`, release.nro);
  const total = copies.reduce((sum, f) => sum + f.size, 0);
  let done = 0;
  for (const f of copies) {
    await zip.addFile(`${ROOT}/game_root/${f.path}`, f.size, chunksOf(f), (chunk) => {
      done += chunk.length;
      progress(0.25 + 0.75 * (done / total));
    });
    if (f.size > 64 * 1024 * 1024) {
      log(`Copied ${f.path}`);
    }
  }
  if (copies.length) {
    log(`Copied ${copies.length} game files`);
  }
  await zip.addBytes(`${ROOT}/deko3d_glsl.bin`, shaders.glslPackage);
  await zip.addBytes(`${ROOT}/fh1_shaders.nfsspv`, shaders.library);
  if (dksh) {
    await zip.addBytes(`${ROOT}/shadercache_dksh.bin`, dksh);
  }
  await zip.finish();
  progress(1);
  log('Done');
  return { edition: build.edition, shaders: shaders.shaders };
}
