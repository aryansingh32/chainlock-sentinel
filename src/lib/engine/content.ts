// Synthetic, clearly fictional exercise documents used by the prototype.
// Each document is laid out as 10 pages × 32 lines = 320 markable segments
// (handbook §2.7: 320 segments, 32 marks per page).
import { Rng, fromHex } from "./bytes";
import { sha3 } from "./sha3";

export const PAGES = 10;
export const LINES_PER_PAGE = 32;
export const WRAP = 76;

function wrap(par: string, width = WRAP): string[] {
  const words = par.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > width) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}

type Section = { heading: string; paras: string[] };

const OPORD7: Section[] = [
  {
    heading: "1. SITUATION",
    paras: [
      "a. General. This order is issued for Exercise SAGAR KAVACH (synthetic). All units, positions, call signs and timings below are fictional and exist only to demonstrate the ChainLock prototype.",
      "b. Opposing forces. Exercise opposing forces are represented by two surface units and one simulated air asset operating from the northern edge of Sector Seven. Their assumed intent is to probe the patrol line and test response times.",
      "c. Friendly forces. Task Group 71 comprises one destroyer, two frigates, one offshore patrol vessel and one replenishment tanker. Shore support is provided by the forward station and its air-gapped operations room.",
      "d. Environment. Sea state is expected to remain between two and four. Visibility will be reduced during early morning hours. Commanders shall plan for intermittent communications in the southern boxes of the sector.",
    ],
  },
  {
    heading: "2. MISSION",
    paras: [
      "Task Group 71 will establish and maintain a surveillance patrol line across Sector Seven from D-Day 0600 to D+3 1800 in order to detect, track and report all exercise contacts and to demonstrate a coordinated response.",
    ],
  },
  {
    heading: "3. EXECUTION",
    paras: [
      "a. Commander's intent. The patrol line must be continuous, unpredictable and quiet. Units will rotate between patrol boxes on the schedule at Annex B and will avoid transmitting on the primary net except for contact reports.",
      "b. Concept of operations. The operation is conducted in three phases. Phase One covers transit and assembly. Phase Two covers the establishment of the patrol line. Phase Three covers the coordinated response drill and recovery.",
      "c. Phase One. Units sail independently and assemble at rendezvous point KESTREL by D-Day 0400. The replenishment tanker will hold station at point HERON and conduct refuelling on request.",
      "d. Phase Two. Units occupy patrol boxes S7-A to S7-F as allocated in Annex B. Box changes will be executed at the times listed and will not be announced on any net. Surface search radars remain in standby unless directed.",
      "e. Phase Three. On receipt of codeword TRIDENT the destroyer will assume the role of scene of action commander. Frigates will close to support and the patrol vessel will maintain the outer screen until relieved.",
      "f. Coordinating instructions. Emission control state BRAVO applies throughout. Contact reports use the format at Annex C. Any loss of communications longer than two hours will be reported to the forward station at the next opportunity.",
      "g. Rules of engagement. This is a training exercise. No live weapons will be used. Safety officers on each unit have authority to stop any serial. The exercise ROE card at Annex D applies.",
    ],
  },
  {
    heading: "4. SERVICE SUPPORT",
    paras: [
      "a. Fuel. Units shall not fall below fifty percent fuel. Replenishment requests are passed to the tanker with at least six hours notice. Priority is given to the destroyer during Phase Three.",
      "b. Stores and medical. Each unit carries stores for five days. Medical evacuation requests are passed via the forward station, which holds a helicopter at short notice during daylight hours.",
      "c. Maintenance. Defects affecting sensors or propulsion are reported immediately. A unit that cannot maintain its box will be relieved by the offshore patrol vessel until repairs are complete.",
    ],
  },
  {
    heading: "5. COMMAND AND SIGNAL",
    paras: [
      "a. Command. Officer in tactical command is embarked in the destroyer. The forward station acts as the shore authority and holds this order in its air-gapped secure enclave under ChainLock control.",
      "b. Signal. Primary and alternate nets are listed at Annex C. Authentication follows the exercise table. Codewords TRIDENT, ANCHOR and LANTERN are valid for the duration of the exercise only.",
      "c. Document control. This document is released only through ChainLock. Every opening and every print is recorded on the ledger before keys are released. Copies must not be photographed, scanned or retyped.",
    ],
  },
];

const ANNEX_PROSE = [
  "Annex A lists task organisation. Commanding officers will confirm readiness to the officer in tactical command twelve hours before sailing and will report any change in personnel holding access to this order.",
  "Annex B sets out the patrol box rotation. Rotation is deliberately irregular so that an observer cannot predict which box is occupied at a given time. Units must follow the table exactly.",
  "Annex C describes the communications plan. Nets are kept quiet by default. The forward station monitors all nets and relays critical traffic to the shore authority using the wired path through the data diode.",
  "Annex D summarises the exercise rules of engagement. Safety of navigation takes priority over every exercise serial. Any unit may call a safety stop and all units will comply without delay.",
  "Annex E covers logistics. The tanker schedule will be adjusted to support Phase Three. Units will report stores remaining at the daily situation report and flag any shortfall early.",
];

function tableRows(rng: Rng, kind: "box" | "net" | "readiness" | "comms"): string[] {
  const units = ["UNIT DD-71", "UNIT FF-72", "UNIT FF-73", "UNIT PV-74", "UNIT AO-75"];
  const boxes = ["S7-A", "S7-B", "S7-C", "S7-D", "S7-E", "S7-F"];
  const rows: string[] = [];
  for (let i = 0; i < 12; i++) {
    const u = units[rng.nextU32() % units.length]!;
    const hh = String(rng.nextU32() % 24).padStart(2, "0");
    const mm = ["00", "15", "30", "45"][rng.nextU32() % 4]!;
    if (kind === "box")
      rows.push(
        `  D+${rng.nextU32() % 4}  ${hh}${mm}   ${u.padEnd(16)} ${boxes[rng.nextU32() % 6]!} -> ${boxes[rng.nextU32() % 6]!}   EMCON B`,
      );
    else if (kind === "net")
      rows.push(
        `  NET ${String.fromCharCode(65 + (i % 6))}${i + 1}   ${hh}${mm}-${String((Number(hh) + 4) % 24).padStart(2, "0")}${mm}   ${u.padEnd(16)} CALLSIGN ${["ORCA", "MARLIN", "SKUA", "PETREL", "GANNET"][i % 5]}-${i + 3}`,
      );
    else if (kind === "readiness")
      rows.push(
        `  ${u.padEnd(16)} HULL ${60 + (rng.nextU32() % 40)}%  PROP ${70 + (rng.nextU32() % 30)}%  SENSORS ${65 + (rng.nextU32() % 35)}%  CREW ${80 + (rng.nextU32() % 20)}%`,
      );
    else
      rows.push(
        `  ${hh}${mm}Z  ${["HF", "VHF", "UHF", "SATCOM-X", "LORA-IN865"][i % 5]!.padEnd(11)} ${u.padEnd(16)} WINDOW ${20 + (rng.nextU32() % 40)} MIN  ${["PRIMARY", "ALTERNATE", "EMERGENCY"][i % 3]}`,
      );
  }
  return rows;
}

function assemble(
  sections: Section[],
  annexes: string[],
  rng: Rng,
  tableKinds: ("box" | "net" | "readiness" | "comms")[],
): string[] {
  const out: string[] = [];
  for (const s of sections) {
    out.push(s.heading);
    for (const p of s.paras) out.push(...wrap(p));
    out.push("");
  }
  let a = 0;
  while (out.length < PAGES * LINES_PER_PAGE) {
    const kind = tableKinds[a % tableKinds.length]!;
    out.push(
      `ANNEX ${String.fromCharCode(65 + (a % 5))} — ${kind === "box" ? "PATROL BOX ROTATION" : kind === "net" ? "NET ALLOCATION" : kind === "readiness" ? "UNIT READINESS" : "COMMUNICATIONS WINDOWS"} (SYNTHETIC)`,
    );
    out.push(...wrap(annexes[a % annexes.length]!));
    out.push(...tableRows(rng, kind));
    out.push("");
    a++;
  }
  // Blank lines are awkward as marking sites; replace them with a separator.
  return out.slice(0, PAGES * LINES_PER_PAGE).map((l) => (l === "" ? "—" : l));
}

const READINESS: Section[] = [
  {
    heading: "1. PURPOSE",
    paras: [
      "This report summarises the synthetic readiness state of exercise units for the third quarter. Figures are invented for the ChainLock demonstration and do not describe any real vessel.",
    ],
  },
  {
    heading: "2. SUMMARY",
    paras: [
      "Overall readiness improved over the quarter. Two units completed planned maintenance ahead of schedule. One unit remains limited by a sensor defect awaiting spares. Crew training targets were met across the group.",
      "Fuel and stores holdings are adequate for the planned exercise programme. Medical readiness is satisfactory. The forward station reports that its air-gapped enclave passed the quarterly key ceremony audit.",
    ],
  },
  {
    heading: "3. ISSUES",
    paras: [
      "Spares lead times remain the main risk. Units should report expected shortfalls early so that the fleet readiness cell can reallocate stock. Delays in reporting reduce the options available to the cell.",
    ],
  },
];

const COMMS: Section[] = [
  {
    heading: "1. GENERAL",
    paras: [
      "This schedule allocates synthetic communications windows for the Western Fleet exercise group. All frequencies, call signs and windows are fictional and exist only for the prototype demonstration.",
    ],
  },
  {
    heading: "2. POLICY",
    paras: [
      "Nets remain silent outside allocated windows. Emergency traffic may be passed at any time. The LoRa relay mesh operates only in the IN865 band between 865 and 867 MHz and is transmit-only from secure rooms.",
      "Stations must log every transmission window used. Missed windows are reported at the next opportunity so that the schedule can be adjusted without exposing the pattern on an open net.",
    ],
  },
];

const cache = new Map<string, string[]>();

/** The 320 text lines of a document (deterministic). */
export function documentLines(docId: string, customText?: string): string[] {
  const key = docId + (customText ? ":" + sha3(customText).slice(0, 8) : "");
  const hit = cache.get(key);
  if (hit) return hit;
  const rng = new Rng(fromHex(sha3("content:" + docId)));
  let lines: string[];
  if (customText) {
    const paras = customText
      .split(/\n\s*\n|\r\n\s*\r\n/)
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    lines = assemble([{ heading: "DOCUMENT TEXT", paras }], ANNEX_PROSE, rng, ["comms", "box"]);
  } else if (docId === "DOC-008")
    lines = assemble(READINESS, ANNEX_PROSE.slice(3), rng, ["readiness"]);
  else if (docId === "DOC-009")
    lines = assemble(COMMS, ANNEX_PROSE.slice(2, 3), rng, ["comms", "net"]);
  else lines = assemble(OPORD7, ANNEX_PROSE, rng, ["box", "net", "comms"]);
  cache.set(key, lines);
  return lines;
}

// --- Layer 4 lexical variants (handbook §4.5 — disabled by default, prose only) ---

export const SYNONYMS: [string, string][] = [
  ["immediately", "at once"],
  ["must", "shall"],
  ["early", "promptly"],
  ["maintain", "keep"],
  ["deliberately", "intentionally"],
  ["priority", "precedence"],
  ["adequate", "sufficient"],
  ["report", "notify"],
  ["quiet", "silent"],
  ["exactly", "precisely"],
];

/** Prose-only region detection: no digits, no ALL-CAPS tokens (call signs, codewords, grid boxes). */
export function isProseLine(line: string): boolean {
  if (/\d/.test(line)) return false;
  if (/\b[A-Z]{3,}\b/.test(line)) return false;
  if (line.length < 30) return false;
  return SYNONYMS.some(([a]) => new RegExp(`\\b${a}\\b`, "i").test(line));
}

export function lexicalVariant(line: string): string {
  for (const [a, b] of SYNONYMS) {
    const re = new RegExp(`\\b${a}\\b`);
    if (re.test(line)) return line.replace(re, b);
  }
  return line;
}
