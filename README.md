# FH1-nx installer

**Open it here: https://kazekikitten.github.io/fh1-nx-installer/**

The installer page for FH1-nx. You give it your own copy of Forza Horizon (an ISO, or the extracted folder) and it
gives you a zip to extract into `sdmc:/switch/`. It all runs in your browser, so your game files never get uploaded.

## What it does

1. Checks `default.xex` (SHA-256) against `release/manifest.json`. Only the USA retail disc (MS-2505) is supported.
2. Downloads the NRO (published gzipped, `release/fh1nx.nro.gz`, so it fits GitHub Pages' file size limit) and checks
   its SHA-256.
3. Makes the renderer's shader files from your disc with the same steps as the PC build: XenosRecomp, DXC,
   SPIRV-Cross, banjo-nx's GLSL scripts (under Pyodide) and zstd. DXC, most of the time, runs in several workers at
   once (`dxc_worker.js`, `lib/dxc_pool.js`: up to 6, by the browser's thread count); in Node, 6 workers took the
   shaders from 445 s to 132 s. Both files have to come out byte for byte the same
   as the ones the NRO was tested with, or the page stops.
4. Compiles the renderer's shader cache (`shadercache_dksh.bin`) with FH1-nx's `dksh_precompile` and uam built for
   WebAssembly (`dksh_worker.js`, `lib/dksh_pool.js`): every shader in the variants the renderer asks for, plus the
   ones a console run listed (`release/fh1_variants.txt`). Without it the Switch compiles each one the first time
   it is needed (seconds each, and what uses it is not drawn meanwhile). Checked against the manifest too.
5. Streams the zip to disk through the service worker, so the ~7 GB zip never has to fit in memory.

The zip:

```text
fh1-nx/
  fh1nx.nro
  deko3d_glsl.bin
  fh1_shaders.nfsspv
  shadercache_dksh.bin
  game_root/          (skipped with "Update only")
```

## Layout

- `index.html`, `app.js`: the page
- `worker.js`: builds the package off the main thread
- `dxc_worker.js`: one shader compile worker (DXC and SPIRV-Cross), several at once
- `sw.js`: streams the download, keeps the page for offline use
- `lib/`: disc, XEX, archive and zip code, the shader chain, the package files
- `wasm/`: the WebAssembly tools, built by FH1-nx's `tools/installer_wasm/` scripts
- `py/`: FH1-nx's GLSL scripts
- `pyodide/`: Pyodide 314.0.7 (the files the page loads; `fetch_parts.sh` gets them)
- `release/manifest.json`: the supported disc, the NRO and the expected shader files
- `test/`: Node scripts that run the same code as the page

## Building and testing

```sh
FH1NX=../FH1-nx ./fetch_parts.sh                 # wasm/, py/, shader_common.h, pyodide/
cp ../FH1-nx/.local/sd/switch/fh1-nx/fh1nx.nro release/
gzip -9 -n -k -f release/fh1nx.nro                # release/fh1nx.nro.gz, the one that is published
python3 serve.py 8193                            # then open http://127.0.0.1:8193/
node test/package_node.mjs <game .iso or folder> release/fh1nx.nro out.zip   # FH1_WORKERS=6 for the worker pool
```

A new NRO or new shader files need a new manifest entry (their SHA-256 and sizes; `nro_sha256` is the uncompressed
NRO's). The page is served by GitHub Pages from the `main` branch.

## License

GPL-3.0 (see LICENSE). Third-party parts are listed in NOTICES.md.

Forza Horizon is a trademark of Microsoft. This project isn't affiliated with Microsoft, Playground Games, Turn 10 or
Nintendo. The page hosts none of the game's files: the game data and the shaders come from your own copy, read in your
browser.
