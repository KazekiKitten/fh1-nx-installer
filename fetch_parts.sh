#!/usr/bin/env bash
# Puts the page's built parts in place (none of them is game data):
#   wasm/            FH1-nx's out/installer_wasm (tools/installer_wasm/build_wasm.sh and link_dxc_wasm.sh)
#   py/              FH1-nx's GLSL scripts
#   shader_common.h  FH1-nx's vendored XenosRecomp header
#   pyodide/         Pyodide 314.0.7 from npm (the files the page loads)
#
#   FH1NX=../FH1-nx ./fetch_parts.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FH1NX="${FH1NX:-$HERE/../FH1-nx}"
PYODIDE_VERSION=314.0.7
mkdir -p "$HERE/wasm" "$HERE/py" "$HERE/pyodide"
for m in hlsl dxc spirv_cross zstd lzx dksh; do
  cp "$FH1NX/out/installer_wasm/$m.mjs" "$FH1NX/out/installer_wasm/$m.wasm" "$HERE/wasm/"
done
cp "$FH1NX/tools/deko3d_glsl.py" "$FH1NX/tools/deko3d_glsl_opt.py" "$FH1NX/tools/installer_wasm/fh1_glsl_web.py" "$HERE/py/"
cp "$FH1NX/thirdparty/reblue-XenosRecomp/XenosRecomp/shader_common.h" "$HERE/"
if [ ! -f "$HERE/pyodide/pyodide.mjs" ] || ! grep -q "\"version\": \"$PYODIDE_VERSION\"" "$HERE/pyodide/package.json" 2>/dev/null; then
  tmp="$(mktemp -d)"
  (cd "$tmp" && npm pack --silent "pyodide@$PYODIDE_VERSION" >/dev/null && tar xzf "pyodide-$PYODIDE_VERSION.tgz")
  for f in pyodide.mjs pyodide.asm.mjs pyodide.asm.wasm python_stdlib.zip pyodide-lock.json package.json LICENSE; do
    [ -f "$tmp/package/$f" ] && cp "$tmp/package/$f" "$HERE/pyodide/"
  done
  rm -rf "$tmp"
fi
du -sh "$HERE/wasm" "$HERE/py" "$HERE/pyodide"
