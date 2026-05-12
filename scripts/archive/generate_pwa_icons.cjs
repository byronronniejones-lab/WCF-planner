// Phase 1B placeholder PWA icons — solid WCF-green tile with a centered
// white inset and a smaller inset accent. Reproducible so Phase 3 can swap
// in real artwork without losing the option to regenerate the placeholders.
//
// Usage: `node scripts/generate_pwa_icons.cjs` (writes 192 + 512 PNG into
// public/icons/). Re-runnable; idempotent on byte content given the same
// constants.
//
// Pure-Node — no canvas / sharp / pngjs dependency. Builds RGBA pixel data
// and zlib-deflates it into a minimal PNG (signature + IHDR + IDAT + IEND).

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DARK = [0x08, 0x50, 0x41, 0xff]; // #085041 — WCF green
const LIGHT = [0xff, 0xff, 0xff, 0xff]; // white inset
const ACCENT = [0x08, 0x50, 0x41, 0xff]; // dark green inner mark

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function pixelAt(x, y, size) {
  const m1 = Math.floor(size * 0.2); // 60% inset square
  const m2 = Math.floor(size * 0.34); // ~32% inner accent
  const inLight = x >= m1 && x < size - m1 && y >= m1 && y < size - m1;
  const inAccent = x >= m2 && x < size - m2 && y >= m2 && y < size - m2;
  if (inAccent) return ACCENT;
  if (inLight) return LIGHT;
  return DARK;
}

function makePNG(size) {
  const rowBytes = size * 4;
  const raw = Buffer.alloc((rowBytes + 1) * size);
  let off = 0;
  for (let y = 0; y < size; y++) {
    raw[off++] = 0; // filter type: None
    for (let x = 0; x < size; x++) {
      const p = pixelAt(x, y, size);
      raw[off++] = p[0];
      raw[off++] = p[1];
      raw[off++] = p[2];
      raw[off++] = p[3];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: truecolor + alpha
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const idat = zlib.deflateSync(raw, {level: 9});

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const outDir = path.resolve(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, {recursive: true});

for (const size of [192, 512]) {
  const png = makePNG(size);
  const file = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(file, png);
  console.log(`wrote ${file} (${png.length} bytes)`);
}
