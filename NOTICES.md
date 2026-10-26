# Third-party notices

| Component | Where | License |
|---|---|---|
| [DirectXShaderCompiler](https://github.com/microsoft/DirectXShaderCompiler) at 0d3ee6b5 (release 1.9.2607), unmodified, with its SPIRV-Tools and SPIRV-Headers | `wasm/dxc.*` | University of Illinois/NCSA (LLVM); SPIRV-Tools: Apache-2.0; SPIRV-Headers: MIT |
| [XenosRecomp](https://github.com/hedge-dev/XenosRecomp) by hedge-dev, with reNut's, banjo-nx's and FH1-nx's changes | `wasm/hlsl.*`, `shader_common.h` | MIT |
| [SPIRV-Cross](https://github.com/KhronosGroup/SPIRV-Cross) at vulkan-sdk-1.4.363.0, unmodified | `wasm/spirv_cross.*` | Apache-2.0 |
| [zstd](https://github.com/facebook/zstd) 1.5.7, unmodified | `wasm/zstd.*` | BSD-3-Clause |
| [libmspack](https://www.cabextract.org.uk/libmspack/) by Stuart Caie (LZX decoder) | `wasm/lzx.*` | LGPL-2.1 |
| [fmt](https://github.com/fmtlib/fmt) | `wasm/hlsl.*` | MIT |
| [xxHash](https://github.com/Cyan4973/xxHash) by Yann Collet | `wasm/hlsl.*` | BSD-2-Clause |
| banjo-nx's GLSL tools (`deko3d_glsl.py`, `deko3d_glsl_opt.py`, from sa2-nx 1.0.3.1) | `py/` | GPL-3.0 |
| [Pyodide](https://pyodide.org) 314.0.7 (CPython 3.14), unmodified | `pyodide/` | MPL-2.0 (CPython: PSF License) |
| The page's download streaming, ISO, XEX and zip code, from [nfsmw-nx-installer](https://github.com/StevensND/nfsmw-nx-installer) | `sw.js`, `lib/iso.js`, `lib/xex.js`, `lib/zip.js` | GPL-3.0 |

`wasm/lzx.wasm` is built from the unmodified libmspack sources (`lzxd.c` of the copy in the FH1-nx SDK) and FH1-nx's
`tools/installer_wasm/fh1_lzx.cpp` with `tools/installer_wasm/build_wasm.sh`; with those sources it can be rebuilt and
replaced by a modified version. Every module in `wasm/` is built by the scripts in FH1-nx's `tools/installer_wasm/`.
