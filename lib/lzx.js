// decompressLzx(bytes, windowBits, size) over wasm/lzx.mjs (fh1_lzx): the output, or null when the stream does not
// give exactly `size` bytes.
export function lzxStep(lzx) {
  return (bytes, windowBits, size) => {
    const input = lzx._malloc(bytes.length);
    const output = lzx._malloc(size);
    try {
      lzx.HEAPU8.set(bytes, input);
      const rc = lzx._fh1_lzx(input, bytes.length, output, size, windowBits);
      return rc ? null : lzx.HEAPU8.slice(output, output + size);
    } finally {
      lzx._free(input);
      lzx._free(output);
    }
  };
}
