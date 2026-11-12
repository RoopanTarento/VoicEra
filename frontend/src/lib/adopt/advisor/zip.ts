/**
 * A minimal ZIP writer (stored, no compression) so several text files can be downloaded as one.
 * Runs in the browser. Nothing is uploaded.
 */

let TABLE: Uint32Array | null = null;

function crcTable(): Uint32Array {
  if (TABLE) return TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  TABLE = t;
  return t;
}

export function crc32(data: Uint8Array): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff];
}
function u32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

export function makeZip(files: { name: string; content: string }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: number[][] = [];
  const central: number[][] = [];
  let offset = 0;
  // Fixed timestamp (1 Jan 2026) so the same files always give the same archive.
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;

  for (const f of files) {
    const name = Array.from(enc.encode(f.name));
    const data = enc.encode(f.content);
    const crc = crc32(data);
    const local = [
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...name,
    ];
    parts.push(local, Array.from(data));
    central.push([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name,
    ]);
    offset += local.length + data.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(centralSize), ...u32(offset), ...u16(0)];
  const all = [...parts, ...central, end];
  const total = all.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of all) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}
