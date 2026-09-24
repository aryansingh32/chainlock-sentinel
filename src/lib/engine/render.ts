// Variant renderer (handbook §4.2 step 2 and §4.5). Draws a page where every
// one of its 32 segments (text lines) is rendered as variant A or B:
//   L1  line shift     — baseline nudged ±LINE_SHIFT px (sub-perceptual)
//   L2  word shift     — one inter-word gap widened by WORD_SHIFT px for B
//   L3  micro-pattern  — faint background dot phase differs between A and B
//   L4  lexical        — optional synonym swap on prose-only lines
// Printed copies additionally carry two yellow microdot grids:
//   ours  — an opaque 24-bit ledger index (meaningless without ledger access)
//   MIC   — a simulated manufacturer Machine Identification Code (serial + time)
import { LINES_PER_PAGE, documentLines, isProseLine, lexicalVariant } from "./content";
import { segmentPermutation } from "./tardos";

export const PAGE_W = 840;
export const PAGE_H = 1188;
export const MARGIN_X = 72;
export const FIRST_BASELINE = 214;
export const LINE_PITCH = 28;
export const LINE_SHIFT = 0.7;
export const WORD_SHIFT = 0.8;
export const PAGE_GAP = 24;
export const GAP_RGB = [118, 126, 138] as const;
export const FONT = '15px "Times New Roman", Times, "Liberation Serif", "Noto Serif", serif';

export type DocMeta = {
  id: string;
  title: string;
  classification: string;
  layer4: boolean;
  customText?: string | undefined;
};
export type PrintMarks = {
  dotIndex: number;
  mic: { serial: string; hh: number; mm: number; day: number; month: number; year: number };
};

export function baselineY(line: number) {
  return FIRST_BASELINE + line * LINE_PITCH;
}

/** Top of the horizontal band that belongs to one segment line. */
export function bandTop(line: number) {
  return baselineY(line) - 19;
}

/** Variant bit (0 = A, 1 = B) for every segment of a page, given the full 320-bit codeword. */
export function pageBits(docId: string, page: number, codeword: number[]): number[] {
  const perm = segmentPermutation(docId);
  return Array.from(
    { length: LINES_PER_PAGE },
    (_, j) => codeword[perm[page * LINES_PER_PAGE + j]!] ?? 0,
  );
}

function classColour(c: string) {
  return c === "SECRET" ? "#B3261E" : c === "CONFIDENTIAL" ? "#1F4E79" : "#555";
}

/** Draw one segment line. Exposed so the extractor can render A/B references. */
export function drawLine(
  ctx: CanvasRenderingContext2D,
  meta: DocMeta,
  text: string,
  line: number,
  bit: number,
  yOffset = 0,
) {
  const base = baselineY(line) + yOffset + (bit ? LINE_SHIFT : -LINE_SHIFT);
  // L3 — background micro-pattern: phase of a faint dot row under the line
  ctx.fillStyle = "rgba(40,60,90,0.05)";
  for (let x = MARGIN_X + (bit ? 3 : 0); x < PAGE_W - MARGIN_X; x += 6)
    ctx.fillRect(x, base + 7, 1, 1);
  // L4 — lexical variant only if enabled for the document and the line is prose
  let t = text;
  if (meta.layer4 && bit === 1 && isProseLine(text)) t = lexicalVariant(text);
  ctx.fillStyle = "#16202c";
  ctx.font = /^(\d\.|ANNEX|DOCUMENT TEXT)/.test(t) ? "bold " + FONT : FONT;
  // L2 — word shift after the third word
  const words = t.split(" ");
  if (words.length > 4) {
    const head = words.slice(0, 3).join(" ") + " ";
    const tail = words.slice(3).join(" ");
    ctx.fillText(head, MARGIN_X, base);
    ctx.fillText(tail, MARGIN_X + ctx.measureText(head).width + (bit ? WORD_SHIFT : 0), base);
  } else ctx.fillText(t, MARGIN_X, base);
}

export function drawPage(
  ctx: CanvasRenderingContext2D,
  meta: DocMeta,
  page: number,
  bits: number[] | null,
  print?: PrintMarks,
) {
  const lines = documentLines(meta.id, meta.customText);
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  const col = classColour(meta.classification);
  ctx.textAlign = "center";
  ctx.fillStyle = col;
  ctx.font = "bold 13px Arial, Helvetica, sans-serif";
  ctx.fillText(meta.classification, PAGE_W / 2, 64);
  ctx.fillText(meta.classification, PAGE_W / 2, PAGE_H - 34);
  ctx.fillStyle = "#16202c";
  ctx.font = "bold 12px Arial, Helvetica, sans-serif";
  ctx.fillText("WESTERN FLEET — EXERCISE HEADQUARTERS (SYNTHETIC)", PAGE_W / 2, 96);
  ctx.font = 'bold 18px "Times New Roman", Times, serif';
  ctx.fillText(meta.title.toUpperCase(), PAGE_W / 2, 128);
  ctx.font = "11px Arial, Helvetica, sans-serif";
  ctx.fillStyle = "#4a5563";
  ctx.fillText(
    `${meta.id} · Page ${page + 1} of 10 · Controlled copy — ChainLock`,
    PAGE_W / 2,
    150,
  );
  ctx.strokeStyle = "#c9d1db";
  ctx.beginPath();
  ctx.moveTo(MARGIN_X, 170);
  ctx.lineTo(PAGE_W - MARGIN_X, 170);
  ctx.stroke();
  ctx.textAlign = "left";
  for (let j = 0; j < LINES_PER_PAGE; j++) {
    const text = lines[page * LINES_PER_PAGE + j] ?? "";
    if (bits) drawLine(ctx, meta, text, j, bits[j] ?? 0);
    else {
      ctx.fillStyle = "#16202c";
      ctx.font = FONT;
      ctx.fillText(text, MARGIN_X, baselineY(j));
    }
  }
  ctx.fillStyle = "#6b7684";
  ctx.font = "10px Arial, Helvetica, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("PROTOTYPE — SYNTHETIC EXERCISE DATA — NOT A REAL ORDER", PAGE_W / 2, PAGE_H - 16);
  ctx.textAlign = "left";
  if (print) drawMicrodots(ctx, print);
  ctx.restore();
}

// ---------- microdots ----------

export const DOT_PITCH = 6;
export const OUR_GRID = { cols: 16, rows: 2, y0: 20, tiles: [96, 300, 504, 690] };
export const MIC_GRID = {
  cols: 15,
  rows: 8,
  y0: PAGE_H - 30 - 8 * 5,
  pitch: 5,
  tiles: [110, 380, 650],
};
const YELLOW = "rgb(255, 232, 20)";

/** 24-bit index + 8-bit checksum = 32 bits, 2 rows × 16 columns. */
export function encodeDotIndex(index: number): number[] {
  const idx = index & 0xffffff;
  const chk = ((idx >> 16) ^ (idx >> 8) ^ idx ^ 0xa5) & 0xff;
  const word = ((idx << 8) | chk) >>> 0;
  return Array.from({ length: 32 }, (_, i) => (word >>> (31 - i)) & 1);
}

export function decodeDotIndex(bits: number[]): { index: number; checksumOk: boolean } {
  let word = 0;
  for (const b of bits) word = ((word << 1) | (b ? 1 : 0)) >>> 0;
  const idx = word >>> 8;
  const chk = word & 0xff;
  return { index: idx, checksumOk: (((idx >> 16) ^ (idx >> 8) ^ idx ^ 0xa5) & 0xff) === chk };
}

/**
 * Simulated Xerox DocuColor-style MIC: 15 columns × 8 rows, row 0 = column parity,
 * rows 1–7 = 7-bit value. Columns: 1 minute, 4 hour, 5 day, 6 month, 7 year,
 * 10–13 serial as four BCD pairs, 14 = all-set separator.
 */
export function encodeMic(m: PrintMarks["mic"]): number[][] {
  const cols: number[] = Array(15).fill(0);
  const bcd = (n: number) => ((Math.floor(n / 10) & 0x7) << 4) | (n % 10);
  cols[1] = bcd(m.mm);
  cols[4] = bcd(m.hh);
  cols[5] = bcd(m.day);
  cols[6] = bcd(m.month);
  cols[7] = bcd(m.year % 100);
  const s = m.serial.padStart(8, "0");
  for (let k = 0; k < 4; k++) cols[10 + k] = bcd(Number(s.slice(k * 2, k * 2 + 2)));
  cols[14] = 0x7f;
  return cols.map((v) => {
    const bits = Array.from({ length: 7 }, (_, r) => (v >> (6 - r)) & 1);
    const parity = bits.reduce((a, b) => a + b, 0) % 2 === 0 ? 1 : 0; // odd parity
    return [parity, ...bits];
  });
}

export function decodeMic(cols: number[][]) {
  const val = (c: number) => (cols[c] ?? []).slice(1).reduce((a, b) => (a << 1) | b, 0);
  const dec = (v: number) => (v >> 4) * 10 + (v & 0xf);
  const parityOk = cols.every(
    (c) => c.reduce((a, b) => a + b, 0) % 2 === 1 || c.every((b) => b === 0),
  );
  const serial = [10, 11, 12, 13].map((c) => String(dec(val(c))).padStart(2, "0")).join("");
  return {
    serial,
    hh: dec(val(4)),
    mm: dec(val(1)),
    day: dec(val(5)),
    month: dec(val(6)),
    year: 2000 + dec(val(7)),
    parityOk,
  };
}

function drawMicrodots(ctx: CanvasRenderingContext2D, p: PrintMarks) {
  ctx.fillStyle = YELLOW;
  const ours = encodeDotIndex(p.dotIndex);
  for (const x0 of OUR_GRID.tiles) {
    // sync column (always on) then data
    for (let r = 0; r < OUR_GRID.rows; r++) dot(ctx, x0 - DOT_PITCH, OUR_GRID.y0 + r * DOT_PITCH);
    ours.forEach((b, i) => {
      if (b) dot(ctx, x0 + (i % 16) * DOT_PITCH, OUR_GRID.y0 + Math.floor(i / 16) * DOT_PITCH);
    });
  }
  const mic = encodeMic(p.mic);
  for (const x0 of MIC_GRID.tiles)
    mic.forEach((col, c) =>
      col.forEach(
        (b, r) => b && dot(ctx, x0 + c * MIC_GRID.pitch, MIC_GRID.y0 + r * MIC_GRID.pitch),
      ),
    );
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillRect(x - 1, y - 1, 2, 2);
}

// ---------- canvas helpers ----------

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

export function renderPageCanvas(
  meta: DocMeta,
  page: number,
  codeword: number[] | null,
  print?: PrintMarks,
): HTMLCanvasElement {
  const c = makeCanvas(PAGE_W, PAGE_H);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  drawPage(ctx, meta, page, codeword ? pageBits(meta.id, page, codeword) : null, print);
  return c;
}

/** Stack pages vertically with a grey gutter — the "PDF export" used for leak tests. */
export function stackPages(pages: HTMLCanvasElement[]): HTMLCanvasElement {
  const c = makeCanvas(PAGE_W, pages.length * PAGE_H + (pages.length - 1) * PAGE_GAP);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = `rgb(${GAP_RGB.join(",")})`;
  ctx.fillRect(0, 0, c.width, c.height);
  pages.forEach((p, i) => ctx.drawImage(p, 0, i * (PAGE_H + PAGE_GAP)));
  return c;
}

/** Print-scan / phone-photo simulation: brightness shift, tint, blur and sensor noise. */
export function degrade(
  src: HTMLCanvasElement,
  o: {
    noise: number;
    blur: number;
    tint?: [number, number, number];
    scale?: number;
    seed?: number;
  },
) {
  const scale = o.scale ?? 1;
  const c = makeCanvas(Math.round(src.width * scale), Math.round(src.height * scale));
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.filter = o.blur ? `blur(${o.blur}px)` : "none";
  ctx.drawImage(src, 0, 0, c.width, c.height);
  ctx.filter = "none";
  const img = ctx.getImageData(0, 0, c.width, c.height);
  let s = o.seed ?? 12345;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5;
  const [tr, tg, tb] = o.tint ?? [0, 0, 0];
  for (let i = 0; i < img.data.length; i += 4) {
    const n = rnd() * o.noise;
    img.data[i] = clamp(img.data[i]! + n + tr);
    img.data[i + 1] = clamp(img.data[i + 1]! + n + tg);
    img.data[i + 2] = clamp(img.data[i + 2]! + n + tb);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function clamp(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/**
 * Collusion attack: two officers splice their copies line by line, taking each
 * segment at random from one of them (handbook §2.6).
 */
export function spliceCopies(
  a: HTMLCanvasElement[],
  b: HTMLCanvasElement[],
  seed = 7,
): HTMLCanvasElement[] {
  let s = seed;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  return a.map((pa, p) => {
    const out = makeCanvas(PAGE_W, PAGE_H);
    const ctx = out.getContext("2d")!;
    ctx.drawImage(pa, 0, 0);
    for (let j = 0; j < LINES_PER_PAGE; j++) {
      if (rnd() < 0.5) continue;
      const y = bandTop(j);
      ctx.drawImage(b[p]!, 0, y, PAGE_W, LINE_PITCH, 0, y, PAGE_W, LINE_PITCH);
    }
    return out;
  });
}

/** "Blue torch": turn faint yellow microdots dark so they become visible (§2.13). */
export function blueTorch(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = makeCanvas(src.width, src.height);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const yellow = (d[i]! + d[i + 1]!) / 2 - d[i + 2]!;
    if (yellow > 70) {
      d[i] = 20;
      d[i + 1] = 40;
      d[i + 2] = 200;
    } else {
      d[i] = d[i]! * 0.35 + 150;
      d[i + 1] = d[i + 1]! * 0.35 + 155;
      d[i + 2] = d[i + 2]! * 0.35 + 165;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
