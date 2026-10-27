# FH1-nx installer

**Open it here: https://kazekikitten.github.io/fh1-nx-installer/**

The installer page for FH1-nx. You give it your own copy of Forza Horizon (an ISO, or the extracted folder) and it
gives you a zip to extract into `sdmc:/switch/`. It all runs in your browser, so your game files never get uploaded.

## What it does

1. Checks `default.xex` (SHA-256) against `release/manifest.json`. Only the USA retail disc (MS-2505) is supported.
2. Downloads the NRO and the renderer's three shader files (`deko3d_glsl.bin`, `fh1_shaders.nfsspv` and the
   Switch-compiled cache `shadercache_dksh.bin`), all published gzipped in `release/` so they fit GitHub Pages' file
   size limit, and checks each one's SHA-256 and size against the manifest.
3. Streams the zip to disk through the service worker, so the ~7 GB zip never has to fit in memory.

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
- `sw.js`: streams the download, keeps the page for offline use
- `lib/`: disc and zip code, the package
- `release/`: `manifest.json` (the supported disc, the NRO and the shader files' SHA-256 and sizes) and the gzipped
  files it names
- `test/`: Node scripts that run the same code as the page

## Building and testing

```sh
../FH1-nx/tools/installer_release.py <fh1nx.nro>   # release/*.gz and manifest.json, from FH1-nx's build
python3 serve.py 8193                              # then open http://127.0.0.1:8193/
node test/package_node.mjs <game .iso or folder> out.zip
```

The NRO and the shader files go together: the shader files are the ones the NRO was tested with
(FH1-nx's docs/installer.md). The page is served by GitHub Pages from the `main` branch.

## License

GPL-3.0 (see LICENSE). Third-party parts are listed in NOTICES.md.

Forza Horizon is a trademark of Microsoft. This project isn't affiliated with Microsoft, Playground Games, Turn 10 or
Nintendo. The game files come from your own copy, read in your browser; the page hosts the program and its shader
files.
