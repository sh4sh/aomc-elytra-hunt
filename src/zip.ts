// Bundles files into a zip, stored as they are (the images are already compressed).

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** The checksum a zip keeps for each file. */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip holding the given files, uncompressed, as the bytes of the archive in order. */
export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array[] {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name);
    const crc = crc32(file.data);
    // What a zip says about a file, written twice: before its bytes, and again in the list at the end.
    const fields = (view: DataView, at: number) => {
      view.setUint16(at, 20, true); // version needed
      view.setUint16(at + 2, 0x0800, true); // names are UTF-8
      view.setUint16(at + 4, 0, true); // stored, not compressed
      view.setUint32(at + 6, 0x00210000, true); // time and date: 1 January 1980
      view.setUint32(at + 10, crc, true);
      view.setUint32(at + 14, file.data.length, true);
      view.setUint32(at + 18, file.data.length, true);
      view.setUint16(at + 22, name.length, true);
    };
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    fields(lv, 4);
    local.set(name, 30);
    const entry = new Uint8Array(46 + name.length);
    const ev = new DataView(entry.buffer);
    ev.setUint32(0, 0x02014b50, true);
    ev.setUint16(4, 20, true); // version made by
    fields(ev, 6);
    ev.setUint32(42, offset, true);
    entry.set(name, 46);
    parts.push(local, file.data);
    central.push(entry);
    offset += local.length + file.data.length;
  }
  const size = central.reduce((n, e) => n + e.length, 0);
  const end = new Uint8Array(22);
  const dv = new DataView(end.buffer);
  dv.setUint32(0, 0x06054b50, true);
  dv.setUint16(8, files.length, true);
  dv.setUint16(10, files.length, true);
  dv.setUint32(12, size, true);
  dv.setUint32(16, offset, true);
  return [...parts, ...central, end];
}
