// Identifies the disc and writes the package: fh1-nx/ with the program, the renderer's three shader files (published
// with the program, checked against the manifest) and (unless it is an update) the game files under game_root/. The
// program writes its own fh1nx.toml on the first start, so an update never replaces the player's settings.

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

// The build for this disc: { build, xexHash } (build null when the disc is not supported).
export async function identifyGame(files, manifest) {
  const entry = files.find((f) => f.path.toLowerCase() === 'default.xex');
  if (!entry) {
    throw new Error('default.xex is missing: choose the Forza Horizon disc image or its extracted folder');
  }
  const xex = await entry.read(0, entry.size);
  const xexHash = await sha256(xex);
  return { xexHash, build: manifest.builds.find((b) => b.xex_sha256 === xexHash) || null };
}

// The shader files the release publishes next to the program, by manifest field: the zip name and the SHA-256 and
// size the page checks.
export const SHADER_FILES = [
  { name: 'deko3d_glsl.bin', gz: 'glsl_gz', sha256: 'glsl_sha256', size: 'glsl_size' },
  { name: 'fh1_shaders.nfsspv', gz: 'library_gz', sha256: 'library_sha256', size: 'library_size' },
  { name: 'shadercache_dksh.bin', gz: 'dksh_gz', sha256: 'dksh_sha256', size: 'dksh_size' },
];

// Checks a downloaded release file against the manifest.
export async function checkFile(name, bytes, sha, size) {
  const hash = await sha256(bytes);
  if (hash !== sha || bytes.length !== size) {
    throw new Error(`The downloaded ${name} is not the expected one (${hash}, ${bytes.length} bytes). Try again later.`);
  }
}

// release: { manifest, nro, shaders: { name: bytes } } (the files of SHADER_FILES, already checked); sink: the zip's
// destination ({ write, close }).
export async function createPackage(files, release, sink, log = () => {}, progress = () => {}, onSize = () => {},
  { update = false } = {}) {
  const { xexHash, build } = await identifyGame(files, release.manifest);
  if (!build) {
    throw new Error(`This copy of the game is not supported (default.xex SHA-256 ${xexHash}). FH1-nx needs the USA ` +
      'retail disc, MS-2505.');
  }
  log(`Disc: ${build.edition}`);
  const game = files.filter((f) => isGameFile(f.path)).sort((a, b) => a.path.toLowerCase().localeCompare(b.path.toLowerCase()));
  const copies = update ? [] : game;
  const shaders = SHADER_FILES.map(({ name }) => ({ path: `${ROOT}/${name}`, bytes: release.shaders[name] }));
  onSize(zipSize([
    { path: `${ROOT}/fh1nx.nro`, size: release.nro.length },
    ...copies.map((f) => ({ path: `${ROOT}/game_root/${f.path}`, size: f.size })),
    ...shaders.map((f) => ({ path: f.path, size: f.bytes.length })),
  ]));

  const zip = new ZipWriter(sink);
  await zip.addBytes(`${ROOT}/fh1nx.nro`, release.nro);
  const total = copies.reduce((sum, f) => sum + f.size, 0);
  let done = 0;
  for (const f of copies) {
    await zip.addFile(`${ROOT}/game_root/${f.path}`, f.size, chunksOf(f), (chunk) => {
      done += chunk.length;
      progress(done / total);
    });
    if (f.size > 64 * 1024 * 1024) {
      log(`Copied ${f.path}`);
    }
  }
  if (copies.length) {
    log(`Copied ${copies.length} game files`);
  }
  for (const f of shaders) {
    await zip.addBytes(f.path, f.bytes);
  }
  await zip.finish();
  progress(1);
  log('Done');
  return { edition: build.edition, files: copies.length };
}
