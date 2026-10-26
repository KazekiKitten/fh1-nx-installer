// One of the page's DKSH workers (lib/dksh_pool.js): FH1-nx's dksh_precompile (wasm/dksh.mjs, with uam) compiles one
// shard of the renderer's shader cache, or merges the shards into shadercache_dksh.bin. Also runs as a Node worker
// thread (test/package_node.mjs).

const node = typeof self === 'undefined';
const port = node ? (await import('node:worker_threads')).parentPort : self;
const send = (message, transfer = []) => port.postMessage(message, transfer);
const listen = (handler) => (node ? port.on('message', handler) : (port.onmessage = ({ data }) => handler(data)));

let createDksh = null;
const output = [];

// uam is not reentrant and dksh_precompile is a command line: a fresh instance for each run.
async function run(args, files) {
  output.length = 0;
  const m = await createDksh({ print: (t) => output.push(t), printErr: (t) => output.push(t) });
  m.FS.mkdirTree('/w');
  for (const [name, bytes] of Object.entries(files)) {
    m.FS.writeFile(`/w/${name}`, bytes);
  }
  const rc = m.callMain(args);
  if (rc) {
    throw new Error(`dksh_precompile ${args[0]} failed (${rc}): ${output.slice(-3).join(' | ')}`);
  }
  return m.FS.readFile('/w/out.bin');
}

listen(async (message) => {
  try {
    if (message.type === 'init') {
      createDksh = (await import(`${message.base}wasm/dksh.mjs`)).default;
      send({ type: 'ready' });
    } else if (message.type === 'shard') {
      // The same tasks as the PC tool's fork child number k of n (--shard k/n).
      const bytes = await run(['/w/pkg', '/w/out.bin', '--list', '/w/list', '--shard', `${message.k}/${message.n}`],
        { pkg: message.pkg, list: message.list });
      send({ type: 'done', bytes }, [bytes.buffer]);
    } else if (message.type === 'merge') {
      const names = message.parts.map((_, i) => `part${i}`);
      const files = Object.fromEntries(message.parts.map((bytes, i) => [names[i], bytes]));
      const bytes = await run(['--merge', '/w/out.bin', ...names.map((n) => `/w/${n}`)], files);
      send({ type: 'done', bytes }, [bytes.buffer]);
    }
  } catch (error) {
    send({ type: 'done', error: error.message || String(error) });
  }
});
