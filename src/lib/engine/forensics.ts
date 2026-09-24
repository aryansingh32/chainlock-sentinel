// Forensic extractor (handbook §4.7 steps 1–3, §2.10). Runs entirely on the
// pixels of a leaked artefact:
//   1. normalise   — split stacked pages, rescale to canonical page size
//   2. identify    — perceptual hash (DCT pHash, 64-bit) + layout profile
//   3. Layer 1     — per-line ink centroid vs A/B reference renders → bits
//   4. microdots   — decode our ledger-index grid and the printer MIC grid
import { LINES_PER_PAGE, PAGES } from "./content";
import {
  DOT_PITCH,
  GAP_RGB,
  MIC_GRID,
  MARGIN_X,
  OUR_GRID,
  PAGE_H,
  PAGE_W,
  LINE_PITCH,
  bandTop,
  decodeDotIndex,
  decodeMic,
  drawLine,
  makeCanvas,
  renderPageCanvas,
  type DocMeta,
} from "./render";
import { segmentPermutation, SEGMENTS } from "./tardos";

export type MicroDots = { index: number; checksumOk: boolean; tiles: number };
export type MicDecode = ReturnType<typeof decodeMic> & { tiles: number };

export type PageExtraction = {
  page: number;
  docId: string;
  phash: string;
  phashDistance: number;
  layoutScore: number;
  bits: number[];
  confidence: number[];
  erased: number;
  microdots: MicroDots | null;
  mic: MicDecode | null;
};

export type ExtractResult = {
  width: number;
  height: number;
  pagesDetected: number;
  pages: PageExtraction[];
  unidentified: number;
  docId: string | null;
  /** Recovered symbol per codeword position (0/1, -1 = erased). */
  recovered: number[];
  recoveredCount: number;
  microdots: MicroDots | null;
  mic: MicDecode | null;
  ms: number;
};

// ---------- image loading ----------

export async function canvasFromFile(file: Blob): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = makeCanvas(img.naturalWidth, img.naturalHeight);
    c.getContext("2d")!.drawImage(img, 0, 0);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- 1. normalise ----------

export function splitPages(src: HTMLCanvasElement): HTMLCanvasElement[] {
  const ctx = src.getContext("2d", { willReadFrequently: true })!;
  const { width: w, height: h } = src;
  const data = ctx.getImageData(0, 0, w, h).data;
  const isGapRow = (y: number) => {
    let n = 0;
    const step = Math.max(1, Math.floor(w / 120));
    let total = 0;
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      total++;
      if (
        Math.abs(data[i]! - GAP_RGB[0]) < 40 &&
        Math.abs(data[i + 1]! - GAP_RGB[1]) < 40 &&
        Math.abs(data[i + 2]! - GAP_RGB[2]) < 40
      )
        n++;
    }
    return n / total > 0.92;
  };
  const runs: [number, number][] = [];
  let start = -1;
  for (let y = 0; y < h; y++) {
    const gap = isGapRow(y);
    if (!gap && start < 0) start = y;
    if ((gap || y === h - 1) && start >= 0) {
      const end = gap ? y : y + 1;
      if (end - start > Math.max(80, h / 60)) runs.push([start, end]);
      start = -1;
    }
  }
  if (!runs.length) runs.push([0, h]);
  return runs.map(([a, b]) => {
    const c = makeCanvas(PAGE_W, PAGE_H);
    const cx = c.getContext("2d", { willReadFrequently: true })!;
    cx.imageSmoothingQuality = "high";
    cx.drawImage(src, 0, a, w, b - a, 0, 0, PAGE_W, PAGE_H);
    return c;
  });
}

// ---------- 2. perceptual hash + layout profile ----------

function gray(d: Uint8ClampedArray, i: number) {
  return 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
}

/** Classic DCT pHash: 32×32 greyscale → DCT → low 8×8 → above-median bits. */
export function phash(src: HTMLCanvasElement): string {
  const N = 32;
  const c = makeCanvas(N, N);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  // crop to the text body so page furniture doesn't dominate
  ctx.drawImage(src, 0, 170, PAGE_W, PAGE_H - 250, 0, 0, N, N);
  const d = ctx.getImageData(0, 0, N, N).data;
  const px: number[] = [];
  for (let i = 0; i < N * N; i++) px.push(gray(d, i * 4));
  const coef: number[] = [];
  for (let u = 0; u < 8; u++)
    for (let v = 0; v < 8; v++) {
      let s = 0;
      for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
          s +=
            px[y * N + x]! *
            Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N)) *
            Math.cos(((2 * y + 1) * v * Math.PI) / (2 * N));
      coef.push(s);
    }
  const ac = coef.slice(1);
  const median = [...ac].sort((a, b) => a - b)[Math.floor(ac.length / 2)]!;
  let hex = "";
  for (let i = 0; i < 64; i += 4) {
    let nib = 0;
    for (let k = 0; k < 4; k++) nib = (nib << 1) | (coef[i + k]! > median ? 1 : 0);
    hex += nib.toString(16);
  }
  return hex;
}

export function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i] ?? "0", 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/** Ink mass per line — a layout fingerprint robust to the sub-pixel marks. */
function lineProfile(src: HTMLCanvasElement): number[] {
  const d = src
    .getContext("2d", { willReadFrequently: true })!
    .getImageData(0, 0, PAGE_W, PAGE_H).data;
  return Array.from({ length: LINES_PER_PAGE }, (_, j) => {
    let m = 0;
    const y0 = bandTop(j);
    for (let y = y0; y < y0 + LINE_PITCH; y += 2)
      for (let x = MARGIN_X; x < PAGE_W - MARGIN_X; x += 2)
        m += Math.max(0, 190 - gray(d, (y * PAGE_W + x) * 4));
    return m;
  });
}

/** Horizontal ink profile of each line (64 buckets) — word-gap positions identify a line. */
function lineXProfiles(src: HTMLCanvasElement): number[][] {
  const d = src
    .getContext("2d", { willReadFrequently: true })!
    .getImageData(0, 0, PAGE_W, PAGE_H).data;
  const W = PAGE_W - 2 * MARGIN_X;
  return Array.from({ length: LINES_PER_PAGE }, (_, j) => {
    const out = Array(64).fill(0) as number[];
    const y0 = bandTop(j);
    for (let y = y0 + 4; y < y0 + LINE_PITCH - 4; y += 2)
      for (let x = MARGIN_X; x < PAGE_W - MARGIN_X; x += 2)
        out[Math.floor(((x - MARGIN_X) / W) * 64)]! += Math.max(
          0,
          190 - gray(d, (y * PAGE_W + x) * 4),
        );
    return out;
  });
}

function correlation(a: number[], b: number[]) {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i]! - ma) * (b[i]! - mb);
    da += (a[i]! - ma) ** 2;
    db += (b[i]! - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

type RegistryEntry = {
  docId: string;
  page: number;
  phash: string;
  profile: number[];
  xprof: number[][];
  meta: DocMeta;
};
const registryCache = new Map<string, RegistryEntry>();

/** pHash registry of every protected page (exported to Zone 2 through the diode in production). */
export function registry(docs: DocMeta[]): RegistryEntry[] {
  const out: RegistryEntry[] = [];
  for (const meta of docs)
    for (let p = 0; p < PAGES; p++) {
      const key = `${meta.id}:${p}:${meta.layer4}:${meta.customText?.length ?? 0}`;
      let e = registryCache.get(key);
      if (!e) {
        const c = renderPageCanvas(meta, p, null);
        e = {
          docId: meta.id,
          page: p,
          phash: phash(c),
          profile: lineProfile(c),
          xprof: lineXProfiles(c),
          meta,
        };
        registryCache.set(key, e);
      }
      out.push(e);
    }
  return out;
}

// ---------- 3. Layer 1 extraction ----------

type Ref = { cA: number; cB: number; mass: number };
const refCache = new Map<string, Ref[]>();
let refCanvas: HTMLCanvasElement | null = null;

function centroid(
  d: Uint8ClampedArray,
  width: number,
  y0: number,
  h: number,
): { c: number; mass: number } {
  let m = 0;
  let s = 0;
  for (let y = y0; y < y0 + h; y++)
    for (let x = MARGIN_X - 4; x < PAGE_W - MARGIN_X + 4; x++) {
      const w = Math.max(0, 190 - gray(d, (y * width + x) * 4));
      m += w;
      s += w * y;
    }
  return { c: m ? s / m : 0, mass: m };
}

function references(meta: DocMeta, page: number, lines: string[]): Ref[] {
  const key = `${meta.id}:${page}:${meta.layer4}:${meta.customText?.length ?? 0}`;
  const hit = refCache.get(key);
  if (hit) return hit;
  refCanvas ??= makeCanvas(PAGE_W, PAGE_H);
  const ctx = refCanvas.getContext("2d", { willReadFrequently: true })!;
  const refs = Array.from({ length: LINES_PER_PAGE }, (_, j) => {
    const text = lines[page * LINES_PER_PAGE + j] ?? "";
    const res: number[] = [];
    let mass = 0;
    for (const bit of [0, 1]) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, bandTop(j) - 4, PAGE_W, LINE_PITCH + 8);
      drawLine(ctx, meta, text, j, bit);
      const d = ctx.getImageData(0, bandTop(j), PAGE_W, LINE_PITCH).data;
      const r = centroid(d, PAGE_W, 0, LINE_PITCH);
      res.push(r.c + bandTop(j));
      mass = r.mass;
    }
    return { cA: res[0]!, cB: res[1]!, mass };
  });
  refCache.set(key, refs);
  return refs;
}

function extractLayer1(page: HTMLCanvasElement, meta: DocMeta, p: number, lines: string[]) {
  const d = page
    .getContext("2d", { willReadFrequently: true })!
    .getImageData(0, 0, PAGE_W, PAGE_H).data;
  const refs = references(meta, p, lines);
  const obs = refs.map((r, j) => {
    const o = centroid(d, PAGE_W, bandTop(j), LINE_PITCH);
    return {
      delta: o.c - (r.cA + r.cB) / 2,
      sep: r.cB - r.cA,
      ok: r.mass > 0 && o.mass > 0.35 * r.mass && o.mass < 2.5 * r.mass,
    };
  });
  // Global offset correction (different font rasteriser, scan shift): find the
  // largest gap between the two clusters of deltas and centre on it.
  const ds = obs
    .filter((o) => o.ok)
    .map((o) => o.delta)
    .sort((a, b) => a - b);
  const sep = obs.find((o) => o.sep)?.sep ?? 1.4;
  let offset = 0;
  let best = 0;
  for (let i = 1; i < ds.length; i++) {
    const g = ds[i]! - ds[i - 1]!;
    if (g > best) {
      best = g;
      offset = (ds[i]! + ds[i - 1]!) / 2;
    }
  }
  if (best < sep * 0.35 || Math.abs(offset) > sep * 1.5) offset = 0;
  const bits: number[] = [];
  const confidence: number[] = [];
  obs.forEach((o) => {
    const v = o.delta - offset;
    const conf = Math.min(1, Math.abs(v) / (Math.abs(o.sep) / 2 || 0.7));
    if (!o.ok || conf < 0.2) {
      bits.push(-1);
      confidence.push(0);
    } else {
      bits.push(v > 0 === o.sep > 0 ? 1 : 0);
      confidence.push(conf);
    }
  });
  return { bits, confidence };
}

// ---------- 4. microdots ----------

function yellowAt(d: Uint8ClampedArray, x: number, y: number) {
  let n = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const xx = Math.round(x + dx);
      const yy = Math.round(y + dy);
      if (xx < 0 || yy < 0 || xx >= PAGE_W || yy >= PAGE_H) continue;
      const i = (yy * PAGE_W + xx) * 4;
      if ((d[i]! + d[i + 1]!) / 2 - d[i + 2]! > 45 && d[i]! > 140) n++;
    }
  return n >= 2;
}

export function decodeMicrodots(page: HTMLCanvasElement): {
  ours: MicroDots | null;
  mic: MicDecode | null;
} {
  const d = page
    .getContext("2d", { willReadFrequently: true })!
    .getImageData(0, 0, PAGE_W, PAGE_H).data;
  const votes = Array(32).fill(0);
  let tiles = 0;
  for (const x0 of OUR_GRID.tiles) {
    const sync = [0, 1].every((r) => yellowAt(d, x0 - DOT_PITCH, OUR_GRID.y0 + r * DOT_PITCH));
    if (!sync) continue;
    tiles++;
    for (let i = 0; i < 32; i++)
      if (yellowAt(d, x0 + (i % 16) * DOT_PITCH, OUR_GRID.y0 + Math.floor(i / 16) * DOT_PITCH))
        votes[i]++;
  }
  const ours = tiles
    ? { ...decodeDotIndex(votes.map((v) => (v * 2 > tiles ? 1 : 0))), tiles }
    : null;

  const micVotes = Array.from({ length: 15 }, () => Array(8).fill(0) as number[]);
  let micTiles = 0;
  for (const x0 of MIC_GRID.tiles) {
    // column 14 is the all-set separator — use it to detect a tile
    const sep = Array.from({ length: 7 }, (_, r) =>
      yellowAt(d, x0 + 14 * MIC_GRID.pitch, MIC_GRID.y0 + (r + 1) * MIC_GRID.pitch),
    ).filter(Boolean).length;
    if (sep < 5) continue;
    micTiles++;
    for (let c = 0; c < 15; c++)
      for (let r = 0; r < 8; r++)
        if (yellowAt(d, x0 + c * MIC_GRID.pitch, MIC_GRID.y0 + r * MIC_GRID.pitch))
          micVotes[c]![r]!++;
  }
  const mic = micTiles
    ? {
        ...decodeMic(micVotes.map((col) => col.map((v) => (v * 2 > micTiles ? 1 : 0)))),
        tiles: micTiles,
      }
    : null;
  return { ours, mic };
}

// ---------- pipeline ----------

export function extract(
  src: HTMLCanvasElement,
  docs: DocMeta[],
  linesOf: (m: DocMeta) => string[],
): ExtractResult {
  const t0 = performance.now();
  const pages = splitPages(src);
  const reg = registry(docs);
  const out: PageExtraction[] = [];
  let unidentified = 0;
  let microdots: MicroDots | null = null;
  let mic: MicDecode | null = null;
  for (const pg of pages) {
    const h = phash(pg);
    const prof = lineProfile(pg);
    // Rank candidates by pHash distance, break ties with the layout profile.
    let best: RegistryEntry | null = null;
    let bestScore = -Infinity;
    let bestDist = 64;
    let bestCorr = 0;
    for (const e of reg) {
      const dist = hamming(h, e.phash);
      const corr = correlation(prof, e.profile);
      const score = corr * 40 - dist;
      if (score > bestScore) {
        bestScore = score;
        best = e;
        bestDist = dist;
        bestCorr = corr;
      }
    }
    const dots = decodeMicrodots(pg);
    if (dots.ours?.checksumOk) microdots = dots.ours;
    if (dots.mic?.parityOk) mic = dots.mic;
    if (!best || (bestDist > 20 && bestCorr < 0.8)) {
      // Fallback for crops: match the layout of the surviving (non-blank) lines only.
      const maxInk = Math.max(...prof);
      const keep = prof.map((v, j) => (v > maxInk * 0.15 ? j : -1)).filter((j) => j >= 0);
      let pBest: RegistryEntry | null = null;
      let pCorr = 0;
      const xp = lineXProfiles(pg);
      if (keep.length >= 3)
        for (const e of reg) {
          const c =
            keep.reduce((acc, j) => acc + correlation(xp[j]!, e.xprof[j]!), 0) / keep.length;
          if (c > pCorr) {
            pCorr = c;
            pBest = e;
          }
        }
      if (!pBest || pCorr < 0.85) {
        unidentified++;
        continue;
      }
      best = pBest;
      bestCorr = pCorr;
    }
    const { bits, confidence } = extractLayer1(pg, best.meta, best.page, linesOf(best.meta));
    out.push({
      page: best.page,
      docId: best.docId,
      phash: h,
      phashDistance: bestDist,
      layoutScore: bestCorr,
      bits,
      confidence,
      erased: bits.filter((b) => b < 0).length,
      microdots: dots.ours,
      mic: dots.mic,
    });
  }
  // Majority document; map page bits back to codeword positions.
  const counts = new Map<string, number>();
  out.forEach((p) => counts.set(p.docId, (counts.get(p.docId) ?? 0) + 1));
  const docId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const recovered = Array(SEGMENTS).fill(-1) as number[];
  if (docId) {
    const perm = segmentPermutation(docId);
    for (const p of out.filter((x) => x.docId === docId))
      p.bits.forEach((b, j) => {
        if (b >= 0) recovered[perm[p.page * LINES_PER_PAGE + j]!] = b;
      });
  }
  return {
    width: src.width,
    height: src.height,
    pagesDetected: pages.length,
    pages: out,
    unidentified,
    docId,
    recovered,
    recoveredCount: recovered.filter((b) => b >= 0).length,
    microdots,
    mic,
    ms: Math.round(performance.now() - t0),
  };
}
