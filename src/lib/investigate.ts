// Leak samples for the Trace workspace. Each sample is produced by actually
// rendering the leaking officer's session variant from the ledger, then
// attacking it (print-scan noise, phone photo, collusion splice). The
// extractor only ever sees pixels.
import { ensureCheckpoint, nowIso, saveCase, store } from "./app";
import { sha3_256 } from "./engine/sha3";
import { toHex } from "./engine/bytes";
import { documentLines } from "./engine/content";
import { extract, type ExtractResult } from "./engine/forensics";
import type { AppState, CaseRecord, DocumentRecord } from "./engine/model";
import {
  bandTop,
  degrade,
  renderPageCanvas,
  spliceCopies,
  stackPages,
  type DocMeta,
} from "./engine/render";
import { buildBundle, fullCodeword, trace, type TraceResult } from "./engine/trace";

export type SampleId = "pdf" | "print" | "merged" | "photo" | "crop";
export const SAMPLES: { id: SampleId; title: string; sub: string; channel: string }[] = [
  {
    id: "pdf",
    title: "Leaked PDF export",
    sub: "Posted to a Telegram channel · 10 pages",
    channel: "Digital file",
  },
  {
    id: "print",
    title: "Scan of a printout",
    sub: "Page 3 · print-scan cycle · yellow dots",
    channel: "Print → scan",
  },
  {
    id: "merged",
    title: "Merged copy (collusion)",
    sub: "Two officers spliced their copies",
    channel: "Collusion attack",
  },
  {
    id: "photo",
    title: "Phone photo of screen",
    sub: "Single page · noise, blur, rescale",
    channel: "Photograph",
  },
  {
    id: "crop",
    title: "Cropped paragraph",
    sub: "Five lines of page 3 · rest cut away",
    channel: "Heavy crop",
  },
];

export const metaOf = (d: DocumentRecord): DocMeta => ({
  id: d.id,
  title: d.title,
  classification: d.classification,
  layer4: d.layer4,
  customText: d.customText,
});

function session(
  s: AppState,
  officer: string,
  docId: string,
  type: "DECRYPT" | "PRINT" = "DECRYPT",
  index?: number,
) {
  return (
    s.ledger.find(
      (r) =>
        r.actor === officer &&
        r.docId === docId &&
        r.type === type &&
        (index === undefined || r.index === index),
    ) ?? s.ledger.find((r) => r.actor === officer && r.docId === docId && r.type === type)
  );
}

export function makeSample(
  id: SampleId,
  s: AppState = store.get(),
): { canvas: HTMLCanvasElement; kind: string } {
  const doc = s.documents.find((d) => d.id === "DOC-007")!;
  const meta = metaOf(doc);
  const pages = (officer: string, nonce: string, only?: number[]) =>
    (only ?? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).map((p) =>
      renderPageCanvas(meta, p, fullCodeword(doc, officer, nonce)),
    );
  if (id === "pdf") {
    const r = session(s, "OFF-004", doc.id)!;
    return {
      canvas: stackPages(pages("OFF-004", r.sessionNonce!)),
      kind: "PNG render of leaked PDF (10 pages)",
    };
  }
  if (id === "photo") {
    const r = session(s, "OFF-004", doc.id)!;
    const [pg] = pages("OFF-004", r.sessionNonce!, [2]);
    return {
      canvas: degrade(pg!, { noise: 22, blur: 0.7, tint: [8, 3, -10], scale: 0.82, seed: 99 }),
      kind: "Phone photograph (JPEG-like), single page",
    };
  }
  if (id === "crop") {
    const r = session(s, "OFF-004", doc.id)!;
    const [pg] = pages("OFF-004", r.sessionNonce!, [2]);
    const ctx = pg!.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    // keep only the band of lines 9–13 — a screenshot of one paragraph
    ctx.fillRect(0, 0, pg!.width, bandTop(9));
    ctx.fillRect(0, bandTop(14), pg!.width, pg!.height - bandTop(14));
    return {
      canvas: degrade(pg!, { noise: 10, blur: 0.3, seed: 5 }),
      kind: "Cropped screenshot (5 lines of page 3)",
    };
  }
  if (id === "print") {
    const r = session(s, "OFF-004", doc.id, "PRINT")!;
    const t = r.time;
    const pg = renderPageCanvas(meta, 2, fullCodeword(doc, "OFF-004", r.sessionNonce!), {
      dotIndex: parseInt(String(r.meta?.["dotIndex"]), 16),
      mic: {
        serial: String(r.meta?.["serial"] ?? "00654321"),
        hh: Number(t.slice(11, 13)),
        mm: Number(t.slice(14, 16)),
        day: 24,
        month: 9,
        year: 2026,
      },
    });
    return {
      canvas: degrade(pg, { noise: 14, blur: 0.45, tint: [3, 3, -5], seed: 7 }),
      kind: "Flatbed scan of printed page 3",
    };
  }
  const a = session(s, "OFF-002", doc.id)!;
  const b = session(s, "OFF-005", doc.id)!;
  return {
    canvas: stackPages(
      spliceCopies(pages("OFF-002", a.sessionNonce!), pages("OFF-005", b.sessionNonce!), 20260924),
    ),
    kind: "Collusion splice of two copies (10 pages)",
  };
}

export function runExtraction(canvas: HTMLCanvasElement, s: AppState = store.get()): ExtractResult {
  return extract(canvas, s.documents.map(metaOf), (m) => documentLines(m.id, m.customText));
}

export function runTrace(ex: ExtractResult, s: AppState = store.get()): TraceResult | null {
  const doc = s.documents.find((d) => d.id === ex.docId);
  return doc ? trace(ex, doc, s.ledger) : null;
}

export async function artefactHash(c: HTMLCanvasElement): Promise<string> {
  const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), "image/png"));
  return toHex(sha3_256(new Uint8Array(await blob.arrayBuffer())));
}

export async function createCase(o: {
  ex: ExtractResult;
  tr: TraceResult;
  canvas: HTMLCanvasElement;
  kind: string;
  sample: string;
  caseId?: string;
}): Promise<CaseRecord> {
  await ensureCheckpoint();
  const s = store.get();
  const n = Object.keys(s.cases).length;
  const id = o.caseId ?? `CASE-${String(71 + n).padStart(3, "0")}`;
  const bundle = buildBundle(s, id, nowIso(), o.ex, o.tr, {
    kind: o.kind,
    sha3: await artefactHash(o.canvas),
    pages: o.ex.pagesDetected,
    width: o.ex.width,
    height: o.ex.height,
  });
  const c: CaseRecord = {
    id,
    createdAt: nowIso(),
    docId: o.tr.docId,
    sample: o.sample,
    accused: o.tr.accused,
    bundle,
  };
  saveCase(c);
  return c;
}
