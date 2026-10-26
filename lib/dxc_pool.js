// Several shader compile workers (dxc_worker.js) at once: DXC is most of the shader chain's time (about 0.17 s a
// shader, 3,863 shaders) and runs on one thread, so the page splits the shaders between workers. The package does not
// depend on the order they finish in (lib/package.js sorts both files' entries).

// How many: the browser's threads less one for the page and one for the worker making the package, at most 6 (each
// worker holds its own DXC, about 150 MB).
export function poolSize() {
  const threads = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  return Math.max(1, Math.min(6, threads - 2));
}

// spawn(url) -> { post(message), listen(handler), stop() }: a module worker in the browser, a worker thread in Node.
export async function createDxcPool(base, count, spawn) {
  const workers = [];
  for (let i = 0; i < count; i++) {
    workers.push(spawn(new URL('dxc_worker.js', base).href));
  }
  await Promise.all(workers.map((w) => new Promise((resolve, reject) => {
    w.listen((m) => (m.type === 'ready' ? resolve() : reject(new Error(m.error || 'a shader worker did not start'))));
    w.post({ type: 'init', base });
  })));

  // jobs: [{ stem, hlsl }]; onResult(stem, vulkanGlsl | null) for each, in the order they finish.
  async function compileAll(jobs, onResult) {
    let next = 0;
    await Promise.all(workers.map((w) => new Promise((resolve, reject) => {
      const give = () => {
        if (next >= jobs.length) {
          resolve();
          return;
        }
        const id = next++;
        w.post({ type: 'job', id, stem: jobs[id].stem, hlsl: jobs[id].hlsl });
      };
      w.listen((m) => {
        if (m.error) {
          reject(new Error(m.error));
          return;
        }
        try {
          onResult(jobs[m.id].stem, m.text);
        } catch (error) {
          reject(error);
          return;
        }
        give();
      });
      give();
    })));
  }

  return { size: count, compileAll, close: () => workers.forEach((w) => w.stop()) };
}

// spawn for the browser.
export function spawnWebWorker(url) {
  const worker = new Worker(url, { type: 'module' });
  return {
    post: (m) => worker.postMessage(m),
    listen: (handler) => (worker.onmessage = ({ data }) => handler(data)),
    stop: () => worker.terminate(),
  };
}
