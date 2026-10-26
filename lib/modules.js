// Loads the shader chain's modules from the page's folders (or, in Node, from file URLs with the same layout):
//   wasm/   hlsl, dxc, spirv_cross, zstd and lzx (FH1-nx tools/installer_wasm)
//   py/     tools/deko3d_glsl.py, tools/deko3d_glsl_opt.py and tools/installer_wasm/fh1_glsl_web.py
//   pyodide/ Pyodide 314.0.7 (Python 3.14, the PC build's)
// base: the page's URL (a string ending in "/").

import { lzxStep } from './lzx.js';

const PYTHON = ['deko3d_glsl.py', 'deko3d_glsl_opt.py', 'fh1_glsl_web.py'];

async function bytesOf(url) {
  if (url.startsWith('file:')) {
    const { readFile } = await import('node:fs/promises');
    return new Uint8Array(await readFile(new URL(url)));
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function loadModules(base, log = () => {}) {
  // A new object for each module: Emscripten makes the object it is given the module itself.
  const quiet = () => ({ print: () => {}, printErr: () => {} });
  const errors = () => ({ print: () => {}, printErr: (t) => log(t) });
  const create = async (name) => (await import(`${base}wasm/${name}.mjs`)).default;
  const [createHlsl, createDxc, createSpirvCross, createZstd, createLzx] = await Promise.all([
    create('hlsl'), create('dxc'), create('spirv_cross'), create('zstd'), create('lzx'),
  ]);
  const { loadPyodide } = await import(`${base}pyodide/pyodide.mjs`);
  // Node's Pyodide takes a path, not a file: URL.
  const indexURL = base.startsWith('file:') ? `${decodeURIComponent(new URL('pyodide/', base).pathname)}` : `${base}pyodide/`;
  const py = await loadPyodide({ indexURL });
  for (const name of PYTHON) {
    py.FS.writeFile(`/home/pyodide/${name}`, await bytesOf(`${base}py/${name}`));
  }
  const glslOf = py.pyimport('fh1_glsl_web').glsl;
  const lzx = await createLzx(quiet());
  return {
    hlsl: await createHlsl(quiet()),
    dxc: await createDxc(quiet()), // its only expected failure is the memory-export shader (counted in the log)
    spirvCross: await createSpirvCross(errors()),
    glsl: (stem, text) => glslOf(stem, text) ?? null,
    createZstd: () => createZstd(errors()),
    decompressLzx: lzxStep(lzx),
  };
}

export { bytesOf };
