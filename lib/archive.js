// Reads the members of FH1's media/**/*.zip archives through a file's read(offset, length), as Pinyon Shift's
// fh1_archive.cpp does: the central directory, a local header that some archives leave out, and three methods:
// stored (0), deflate (8, which the PC build reads through Python's zipfile) and XMem LZX (21).

function u16(d, o) {
  return d[o] | (d[o + 1] << 8);
}

function u32(d, o) {
  return (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
}

// [{ name, method, crc, compressedSize, size, headerOffset }], in directory order.
export async function listArchive(file) {
  const tailSize = Math.min(file.size, 22 + 0xffff);
  const tail = await file.read(file.size - tailSize, tailSize);
  let end = -1;
  for (let at = tail.length - 22; at >= 0; at--) {
    if (u32(tail, at) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) {
    throw new Error(`${file.path}: not a zip archive`);
  }
  // The entry count is 16 bits and colorado/bin.zip has 230,057 entries without ZIP64: the directory is read to its
  // end, as Python's zipfile does.
  const size = u32(tail, end + 12);
  const offset = u32(tail, end + 16);
  const directory = await file.read(offset, size);
  const decoder = new TextDecoder('utf-8');
  const members = [];
  let at = 0;
  while (at < directory.length) {
    if (at + 46 > directory.length || u32(directory, at) !== 0x02014b50) {
      throw new Error(`${file.path}: damaged zip directory`);
    }
    const nameSize = u16(directory, at + 28);
    members.push({
      name: decoder.decode(directory.subarray(at + 46, at + 46 + nameSize)),
      method: u16(directory, at + 10),
      crc: u32(directory, at + 16),
      compressedSize: u32(directory, at + 20),
      size: u32(directory, at + 24),
      headerOffset: u32(directory, at + 42),
    });
    at += 46 + nameSize + u16(directory, at + 30) + u16(directory, at + 32);
  }
  return members;
}

// XMem's framing around one LZX stream (fh1_archive.cpp, ParseXmemPayload): blocks with a 2-byte compressed size,
// or 0xFF + 2-byte uncompressed + 2-byte compressed size.
function xmemPayload(data, size) {
  const pieces = [];
  let at = 0;
  let produced = 0;
  let total = 0;
  while (produced < size) {
    let blockCompressed;
    let blockSize;
    if (at < data.length && data[at] === 0xff) {
      if (data.length - at < 5) return null;
      blockSize = (data[at + 1] << 8) | data[at + 2];
      blockCompressed = (data[at + 3] << 8) | data[at + 4];
      at += 5;
    } else {
      if (data.length - at < 2) return null;
      blockSize = Math.min(0x8000, size - produced);
      blockCompressed = (data[at] << 8) | data[at + 1];
      at += 2;
    }
    if (!blockCompressed || !blockSize || blockCompressed > data.length - at || blockSize > size - produced) {
      return null;
    }
    pieces.push(data.subarray(at, at + blockCompressed));
    total += blockCompressed;
    at += blockCompressed;
    produced += blockSize;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of pieces) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function inflateRaw(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// decompressLzx(bytes, windowBits, size) -> Uint8Array of `size` bytes, or null. crc32(bytes) -> number.
export async function readMember(file, member, decompressLzx, crc32) {
  const local = await file.read(member.headerOffset, 30);
  let start = member.headerOffset;
  if (u32(local, 0) === 0x04034b50) {
    start += 30 + u16(local, 26) + u16(local, 28);
  }
  const compressed = await file.read(start, member.compressedSize);
  let data = null;
  if (member.method === 0) {
    data = compressed;
  } else if (member.method === 8) {
    data = await inflateRaw(compressed);
  } else if (member.method === 21) {
    const payload = xmemPayload(compressed, member.size);
    // The window the stream was made with is not recorded: the three the runtime tries, in its order. The member's
    // CRC decides, not only the decoder's status, so a wrong window that happens to decode cleanly is not taken.
    for (const bits of payload ? [16, 17, 15] : []) {
      const out = decompressLzx(payload, bits, member.size);
      if (out && crc32(out) === member.crc) {
        data = out;
        break;
      }
    }
  } else {
    throw new Error(`${file.path}!/${member.name}: unknown method ${member.method}`);
  }
  if (!data || data.length !== member.size || crc32(data) !== member.crc) {
    throw new Error(`${file.path}!/${member.name}: could not be read (damaged file?)`);
  }
  return data;
}
