// One of the page's shader compile workers (lib/dxc_pool.js): DXC and SPIRV-Cross for one shader at a time, the Vulkan
// GLSL back to the pool. The GLSL passes (Pyodide) stay in the worker that made the HLSL: they are a few ms a shader,
// DXC most of a second. Also runs as a Node worker thread (test/package_node.mjs).

const node = typeof self === 'undefined';
const port = node ? (await import('node:worker_threads')).parentPort : self;
const send = (message) => port.postMessage(message);
const listen = (handler) => (node ? port.on('message', handler) : (port.onmessage = ({ data }) => handler(data)));

let dxc = null;
let spirvCross = null;
const quiet = () => ({ print: () => {}, printErr: () => {} });

listen(async (message) => {
  try {
    if (message.type === 'init') {
      const [{ default: createDxc }, { default: createSpirvCross }] = await Promise.all([
        import(`${message.base}wasm/dxc.mjs`), import(`${message.base}wasm/spirv_cross.mjs`)]);
      [dxc, spirvCross] = await Promise.all([createDxc(quiet()), createSpirvCross(quiet())]);
      dxc.FS.mkdirTree('/w');
      spirvCross.FS.mkdirTree('/w');
      send({ type: 'ready' });
      return;
    }
    // { type: 'job', id, stem, hlsl }: the same calls as the single-threaded path in lib/shaders.js.
    const { id, stem, hlsl } = message;
    dxc.FS.writeFile('/w/in.hlsl', hlsl);
    if (dxc.ccall('compile', 'number', ['string', 'string', 'number'],
      ['/w/in.hlsl', '/w/out.spv', stem.startsWith('ps_') ? 1 : 0])) {
      send({ type: 'done', id, text: null }); // the memory-export shader, as on the PC
      return;
    }
    spirvCross.FS.writeFile('/w/in.spv', dxc.FS.readFile('/w/out.spv'));
    if (spirvCross.callMain(['/w/in.spv', '--version', '460', '--vulkan-semantics', '--relax-nan-checks', '--output',
      '/w/out.glsl'])) {
      send({ type: 'done', id, error: `SPIRV-Cross rejected ${stem}` });
      return;
    }
    send({ type: 'done', id, text: new TextDecoder().decode(spirvCross.FS.readFile('/w/out.glsl')) });
  } catch (error) {
    send({ type: 'done', id: message.id, error: `${message.stem || 'shader worker'}: ${error.message || error}` });
  }
});
