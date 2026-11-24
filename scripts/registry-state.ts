// State registry pipeline (B31). Pulls every government aircraft for one
// state out of the FAA releasable aircraft database and writes
// data/gov-aircraft/<st>.json. Read-only against the FAA; writes only the
// output file. No KV, no network beyond the FAA download.
//
//   npm run registry:state -- --state OR
//     [--cache ~/.cache/smokysignal/faa]   where the zip and extracted files live
//     [--refresh]                          download the zip again
//     [--out data/gov-aircraft/or.json]    output path
//     [--all]                              keep colleges, schools and military
//     [--compare data/wa-gov-aircraft.json] check against a hand-built list
//     [--dry-run]                          print counts, write nothing
//
// The core (parse, classify, build, compare) is lib/registry-state-core.ts.
// How to review a new state: docs/registry-state.md.

import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { spawnSync } from "node:child_process";
import {
  FAA_RELEASABLE_URL,
  buildStateFile,
  compareWithList,
  formatCompare,
  masterColumns,
  parseAcftRef,
  parseMasterLine,
  type GovAircraftFile,
  type ListRow,
  type MasterRow,
} from "../lib/registry-state-core";
import { formatTs } from "../lib/time";

// The FAA's CDN answers 403 to curl's default agent; a plain browser-style
// agent is accepted. No contact details in it.
const USER_AGENT = "Mozilla/5.0 (compatible; smokysignal-registry/1.0)";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith("--")) {
    console.error(`--${name} needs a value (got ${v === undefined ? "nothing" : v})`);
    process.exit(2);
  }
  return v;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function expandHome(p: string): string {
  return p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
}

async function download(zipPath: string): Promise<void> {
  console.log(`downloading ${FAA_RELEASABLE_URL}`);
  const r = await fetch(FAA_RELEASABLE_URL, { headers: { "user-agent": USER_AGENT } });
  if (!r.ok) throw new Error(`FAA download ${r.status} ${r.statusText}`);
  const buf = Buffer.from(await r.arrayBuffer());
  // An error page served with 200 must not replace a good cached zip.
  if (buf.length < 2 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new Error(`FAA download is not a zip (${buf.length} bytes, starts ${JSON.stringify(buf.subarray(0, 16).toString("latin1"))})`);
  }
  const tmp = `${zipPath}.tmp`;
  writeFileSync(tmp, buf);
  renameSync(tmp, zipPath);
  console.log(`saved ${(buf.length / 1e6).toFixed(1)} MB to ${zipPath}`);
}

function extract(zipPath: string, dir: string): void {
  mkdirSync(dir, { recursive: true });
  const r = spawnSync("unzip", ["-o", "-q", zipPath, "MASTER.txt", "ACFTREF.txt", "-d", dir], {
    stdio: "inherit",
  });
  if (r.status !== 0) throw new Error(`unzip exited ${r.status}`);
}

/** Make sure <cache>/extracted/{MASTER,ACFTREF}.txt exist; returns their dir. */
async function ensureFiles(cache: string, refresh: boolean): Promise<string> {
  mkdirSync(cache, { recursive: true });
  const zipPath = join(cache, "ReleasableAircraft.zip");
  const dir = join(cache, "extracted");
  const have = existsSync(join(dir, "MASTER.txt")) && existsSync(join(dir, "ACFTREF.txt"));
  if (refresh || !existsSync(zipPath)) await download(zipPath);
  if (refresh || !have) {
    try {
      extract(zipPath, dir);
    } catch (e) {
      console.error(`could not unzip ${zipPath}; it may be partial or corrupt. Re-run with --refresh to download it again.`);
      throw e;
    }
  }
  return dir;
}

async function* streamMaster(path: string): AsyncGenerator<MasterRow> {
  const rl = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity });
  let get: ReturnType<typeof masterColumns> | null = null;
  for await (const line of rl) {
    if (!get) {
      get = masterColumns(line);
      continue;
    }
    const row = parseMasterLine(get, line);
    if (row) yield row;
  }
}

async function collect(path: string, state: string): Promise<MasterRow[]> {
  const out: MasterRow[] = [];
  for await (const r of streamMaster(path)) if (r.state === state) out.push(r);
  return out;
}

function readJson<T>(p: string): T {
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

/** Other generated state files beside `out`, for out-of-state list rows. */
function siblingFiles(outPath: string, self: string): Record<string, GovAircraftFile> {
  const dir = dirname(outPath);
  const res: Record<string, GovAircraftFile> = {};
  if (!existsSync(dir)) return res;
  for (const name of readdirSync(dir)) {
    const m = /^([a-z]{2})\.json$/.exec(name);
    if (!m || m[1]!.toUpperCase() === self) continue;
    res[m[1]!.toUpperCase()] = readJson<GovAircraftFile>(join(dir, name));
  }
  return res;
}

async function main() {
  const state = (arg("state") ?? "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) {
    console.error("usage: npm run registry:state -- --state OR [--cache DIR] [--refresh] [--out PATH] [--all] [--compare LIST.json] [--dry-run]");
    process.exit(2);
  }
  const cache = resolve(expandHome(arg("cache") ?? "~/.cache/smokysignal/faa"));
  const out = resolve(arg("out") ?? join("data", "gov-aircraft", `${state.toLowerCase()}.json`));
  const dir = await ensureFiles(cache, flag("refresh"));

  const masterPath = join(dir, "MASTER.txt");
  const faaFileDate = formatTs(statSync(masterPath).mtimeMs, "date");
  const acft = parseAcftRef(readFileSync(join(dir, "ACFTREF.txt"), "utf8"));
  const rows = await collect(masterPath, state);
  const file = buildStateFile(rows, acft, {
    state,
    pulled: formatTs(Date.now(), "date"),
    faaFileDate,
    includeExcluded: flag("all"),
  });

  const c = file.counts;
  console.log(
    `${state}: ${rows.length} MASTER rows in state, ${c.total} government aircraft ` +
      `(${c.police_enforcement} police, ${c.other} other, ${c.needs_review} to review), ` +
      `${c.excluded} excluded; FAA file ${faaFileDate}`,
  );
  for (const [k, n] of Object.entries(c.by_category).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(18)} ${n}`);
  }

  if (!flag("dry-run")) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(file, null, 2) + "\n");
    console.log(`wrote ${out}`);
  }

  const comparePath = arg("compare");
  if (comparePath) {
    const list = readJson<ListRow[]>(resolve(comparePath));
    const rep = compareWithList(file, list, siblingFiles(out, state));
    console.log("");
    console.log(formatCompare(rep));
    if (rep.missing.length > 0) process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
