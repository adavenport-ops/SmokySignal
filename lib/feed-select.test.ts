// Run: npx tsx --test lib/feed-select.test.ts
//
// Pins the upstream decision table and what riders get when it degrades:
// a dead feed must never read as a fresh, all-grounded fleet. Regional
// feeds are merged; OpenSky is asked only when none of them answered.

import { mock, test } from "node:test";
import assert from "node:assert";
import {
  aircraftCacheControl,
  degradedView,
  selectFeed,
  type FeedSpec,
} from "./feed-select";
import { FeedHttpError } from "./feeds/http";
import type { FeedSrc, NormalizedAc, Snapshot } from "./types";

// selectFeed logs every failure; keep the test output readable.
mock.method(console, "warn", () => {});
mock.method(console, "error", () => {});

const row = (hex: string, extra: Partial<NormalizedAc> = {}): NormalizedAc => ({
  hex,
  lat: 47.2,
  lon: -122.4,
  alt_baro: 2400,
  ...extra,
});
const boom = async (): Promise<NormalizedAc[]> => {
  throw new Error("upstream down");
};
const rows =
  (n: number, prefix = "a1b2") =>
  async () =>
    Array.from({ length: n }, (_, i) => row(`${prefix}${String(i).padStart(2, "0")}`));

const feed = (
  src: FeedSrc,
  fetch: FeedSpec["fetch"],
  extra: Partial<FeedSpec> = {},
): FeedSpec => ({ src, fetch, zeroIsFailure: true, ...extra });

const statusOf = (r: { feeds: { src: FeedSrc; status: string }[] }, src: FeedSrc) =>
  r.feeds.find((f) => f.src === src)?.status;

test("primary rows: fi, not degraded, fallback never called", async () => {
  let fallbackCalled = false;
  const r = await selectFeed({
    sources: [feed("fi", rows(3))],
    fallback: feed("os", async () => {
      fallbackCalled = true;
      return [];
    }),
  });
  assert.equal(r.source, "fi");
  assert.equal(r.degraded, false);
  assert.equal(r.raw.length, 3);
  assert.equal(fallbackCalled, false);
  assert.equal(statusOf(r, "os"), "standby");
  assert.ok(r.raw.every((a) => a.src === "fi"), "rows are tagged with their feed");
});

test("two regional feeds both answer: merged, summary fi+lol, union by hex", async () => {
  const r = await selectFeed({
    sources: [
      feed("fi", async () => [row("aaaaaa"), row("bbbbbb")]),
      feed("lol", async () => [row("BBBBBB"), row("cccccc")]),
    ],
    fallback: feed("os", boom),
  });
  assert.equal(r.source, "fi+lol");
  assert.equal(r.degraded, false);
  assert.deepEqual(r.raw.map((a) => a.hex).sort(), ["aaaaaa", "bbbbbb", "cccccc"]);
  const shared = r.raw.find((a) => a.hex === "bbbbbb")!;
  assert.deepEqual(shared.sources, ["fi", "lol"]);
  assert.deepEqual(r.raw.find((a) => a.hex === "cccccc")!.sources, ["lol"]);
});

test("one regional feed down: the other carries the tick, not degraded", async () => {
  let fallbackCalled = false;
  const r = await selectFeed({
    sources: [
      feed("fi", async () => {
        throw new FeedHttpError("fi", 503);
      }),
      feed("lol", rows(2)),
    ],
    fallback: feed("os", async () => {
      fallbackCalled = true;
      return [];
    }),
  });
  assert.equal(r.source, "lol");
  assert.equal(r.degraded, false);
  assert.equal(r.raw.length, 2);
  assert.equal(fallbackCalled, false);
  const fi = r.feeds.find((f) => f.src === "fi")!;
  assert.equal(fi.status, "error");
  assert.equal(fi.error_code, "http_5xx");
});

test("a slow feed failing does not reject the others", async () => {
  const r = await selectFeed({
    sources: [
      feed("fi", rows(1)),
      feed("lol", () => new Promise((_, rej) => setTimeout(() => rej(new Error("late")), 5))),
    ],
  });
  assert.equal(r.source, "fi");
  assert.equal(statusOf(r, "lol"), "error");
});

test("all regional down, fallback has fleet rows: os, not degraded", async () => {
  const r = await selectFeed({
    sources: [feed("fi", boom), feed("lol", boom)],
    fallback: feed("os", rows(1)),
  });
  assert.equal(r.source, "os");
  assert.equal(r.degraded, false);
  assert.equal(r.raw[0]!.src, "os");
});

test("every feed throws: degraded, source none", async () => {
  const r = await selectFeed({
    sources: [feed("fi", boom), feed("lol", boom), feed("apl", boom)],
    fallback: feed("os", boom),
  });
  assert.equal(r.degraded, true);
  assert.equal(r.source, "none");
  assert.deepEqual(r.raw, []);
  assert.deepEqual(
    r.feeds.map((f) => [f.src, f.status]),
    [
      ["fi", "error"],
      ["lol", "error"],
      ["apl", "error"],
      ["os", "error"],
    ],
  );
});

test("every feed empty: degraded, source none", async () => {
  const r = await selectFeed({
    sources: [feed("fi", rows(0)), feed("lol", rows(0))],
    fallback: feed("os", rows(0)),
  });
  assert.equal(r.degraded, true);
  assert.equal(r.source, "none");
  assert.equal(statusOf(r, "fi"), "empty");
});

test("regional throws and fallback empty: degraded, source none", async () => {
  const r = await selectFeed({
    sources: [feed("fi", boom)],
    fallback: feed("os", rows(0)),
  });
  assert.equal(r.degraded, true);
  assert.equal(r.source, "none");
});

test("narrow region: empty answer is accepted as a real answer", async () => {
  const r = await selectFeed({
    sources: [feed("fi", rows(0), { zeroIsFailure: false })],
    fallback: feed("os", boom),
  });
  assert.equal(r.source, "fi");
  assert.equal(r.degraded, false);
});

test("budget gate closed: feed skipped and never fetched; disabled feed never fetched", async () => {
  let lolFetched = false;
  let aplFetched = false;
  const r = await selectFeed({
    sources: [
      feed("fi", rows(1)),
      feed(
        "lol",
        async () => {
          lolFetched = true;
          return [row("dddddd")];
        },
        { claim: async () => false },
      ),
      feed(
        "apl",
        async () => {
          aplFetched = true;
          return [];
        },
        { enabled: false },
      ),
    ],
  });
  assert.equal(lolFetched, false);
  assert.equal(aplFetched, false);
  assert.equal(statusOf(r, "lol"), "skipped");
  assert.equal(statusOf(r, "apl"), "disabled");
  assert.equal(r.source, "fi");
});

test("skipped feed's remembered rows carry forward next to a fresh answer", async () => {
  const lolOnly = row("eeeeee", { src: "lol", pos_ts: 1000 });
  const r = await selectFeed({
    sources: [
      feed("fi", async () => [row("aaaaaa")]),
      feed("lol", boom, { claim: async () => false, recall: async () => [lolOnly] }),
    ],
  });
  assert.equal(r.source, "fi+lol", "source line stays steady between lol requests");
  assert.deepEqual(r.raw.map((a) => a.hex), ["aaaaaa", "eeeeee"]);
  const lol = r.feeds.find((f) => f.src === "lol")!;
  assert.equal(lol.status, "skipped");
  assert.equal(lol.carried, true);
});

test("a recent answer with no carried rows keeps the source summary steady", async () => {
  const r = await selectFeed({
    sources: [
      feed("fi", async () => [row("aaaaaa")]),
      feed("lol", boom, { claim: async () => false, recall: async () => [] }),
      feed("apl", boom, { claim: async () => false, recall: async () => null }),
    ],
  });
  assert.equal(r.source, "fi+lol");
  assert.equal(r.raw.length, 1);
  assert.equal(r.feeds.find((f) => f.src === "apl")!.carried, undefined);
});

test("remembered rows alone are not an observation: still falls back / degrades", async () => {
  const r = await selectFeed({
    sources: [
      feed("fi", boom),
      feed("lol", boom, { claim: async () => false, recall: async () => [row("eeeeee")] }),
    ],
    fallback: feed("os", boom),
  });
  assert.equal(r.degraded, true);
  assert.equal(r.source, "none");
});

test("a fresh answer is remembered; an empty or failed one is not", async () => {
  const kept: string[][] = [];
  const remember = async (rows: NormalizedAc[]) => {
    kept.push(rows.map((a) => a.hex));
  };
  await selectFeed({ sources: [feed("lol", async () => [row("ffffff")], { remember })] });
  await selectFeed({ sources: [feed("lol", rows(0), { remember })] });
  await selectFeed({ sources: [feed("lol", boom, { remember })] });
  assert.deepEqual(kept, [["ffffff"]]);
});

test("a throwing gate skips the feed instead of spending quota", async () => {
  let fetched = false;
  const r = await selectFeed({
    sources: [
      feed("fi", rows(1)),
      feed(
        "lol",
        async () => {
          fetched = true;
          return [];
        },
        {
          claim: async () => {
            throw new Error("kv down");
          },
        },
      ),
    ],
  });
  assert.equal(fetched, false);
  assert.equal(statusOf(r, "lol"), "skipped");
});

test("only skipped and failed regional feeds: falls back", async () => {
  const r = await selectFeed({
    sources: [feed("fi", boom), feed("lol", rows(1), { claim: async () => false })],
    fallback: feed("os", rows(1)),
  });
  assert.equal(r.source, "os");
});

test("429 runs the onError hook with the Retry-After", async () => {
  let backoff: number | null = null;
  const r = await selectFeed({
    sources: [
      feed("fi", rows(1)),
      feed(
        "lol",
        async () => {
          throw new FeedHttpError("lol", 429, 3600);
        },
        {
          onError: (e) => {
            if (e instanceof FeedHttpError) backoff = e.retryAfterS;
          },
        },
      ),
    ],
  });
  assert.equal(backoff, 3600);
  const lol = r.feeds.find((f) => f.src === "lol")!;
  assert.equal(lol.error_code, "rate_limited");
});

test("latency and count are recorded per feed", async () => {
  let t = 1000;
  const r = await selectFeed({
    clock: () => (t += 25),
    sources: [feed("fi", rows(4))],
  });
  const fi = r.feeds[0]!;
  assert.equal(fi.count, 4);
  assert.equal(fi.latency_ms, 25);
});

const T_GOOD = Date.UTC(2026, 10, 18, 22, 2, 0);
const T_NOW = T_GOOD + 7 * 60_000;

function placeholder(): Snapshot {
  return {
    fetched_at: T_NOW,
    source: "none",
    aircraft: [],
    live_seen_count: 0,
    degraded: true,
  };
}

test("every feed down with a last good snapshot: old fetched_at, degraded, no-store", async () => {
  const fed = await selectFeed({
    sources: [feed("fi", boom), feed("lol", boom)],
    fallback: feed("os", boom),
  });
  assert.equal(fed.degraded, true);
  const lastGood: Snapshot = {
    fetched_at: T_GOOD,
    source: "fi+lol",
    aircraft: [],
    live_seen_count: 140,
  };
  const view = degradedView(placeholder(), lastGood);
  assert.equal(view.degraded, true);
  assert.equal(view.fetched_at, T_GOOD, "keeps the ORIGINAL fetched_at");
  assert.equal(view.source, "fi+lol");
  const cc = aircraftCacheControl(view);
  assert.equal(cc, "no-store");
  assert.ok(!cc.includes("s-maxage"));
});

test("no last good snapshot: placeholder, source none, degraded", () => {
  const view = degradedView(placeholder(), null);
  assert.equal(view.degraded, true);
  assert.equal(view.source, "none");
});

test("healthy snapshot keeps the CDN cache window", () => {
  const cc = aircraftCacheControl({
    fetched_at: T_NOW,
    source: "fi+lol",
    aircraft: [],
    live_seen_count: 140,
  });
  assert.ok(cc.includes("s-maxage=10"));
});
