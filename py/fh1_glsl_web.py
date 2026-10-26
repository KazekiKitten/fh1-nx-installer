"""FH1-nx installer page: the GLSL steps of the shader package, for Pyodide (docs/installer.md).

The same calls as the PC build: tools/deko3d_shaders.py's conversion (deko3d_glsl.convert) of SPIRV-Cross's output,
then tools/deko3d_glsl_opt.py with the package's passes (docs/shaders.md, "Which GLSL": alpha and earlyz). Returns the
GLSL as the package takes it, or None when the conversion rejects the shader (deko3d_shaders.py writes no GLSL).
"""
import deko3d_glsl
import deko3d_glsl_opt

PASSES = 'alpha,earlyz'


def glsl(stem, vk_text):
    stage = 'frag' if stem.startswith('ps_') else 'vert'
    try:
        text, _ = deko3d_glsl.convert(vk_text, stage, deko3d_glsl.DEFAULT_UBO_MAP, 'handle')
    except deko3d_glsl.Unsupported:
        return None
    return deko3d_glsl_opt.optimise(text, PASSES, stage, stem[3:19])
