// Run: npx tsx --test lib/bots/bluesky.test.ts
//
// Post text, UTF-8 facet byte offsets, session caching / refresh, and
// the cooldown + daily cap, against a mocked XRPC server.

import { test } from "node:test";
import assert from "node:assert";
import {
  BSKY_DAILY_CAP,
  buildBlueskyPost,
  getBskySession,
  jwtExpMs,
  linkFacet,
  postTakeoffToBluesky,
  utf8Length,
  type BlueskyDeps,
} from "./bluesky";
import { MemoryBotKv } from "./kv";
import { BSKY_SESSION_KEY } from "../storage-keys";
import type { BotTakeoffEvent } from "./types";

const T = Date.parse("2026-11-18T22:22:00Z");

const smokey4: BotTakeoffEvent = {
  tail: "N305DK",
  nickname: "Smokey 4",
  mission: "police",
  matchMission: "police",
  policeUnit: "wsp",
  lat: 47.2402,
  lon: -122.3605,
  alt_ft: 2600,
  tsMs: T,
};

test("buildBlueskyPost: brand line plus the plane link", () => {
  const p = buildBlueskyPost(smokey4);
  assert.equal(p.text, "Smokey 4 up · I-5 · Fife · 14:22 PT\nsmokysignal.app/plane/N305DK");
  assert.equal(p.planeUrl, "https://www.smokysignal.app/plane/N305DK");
  assert.equal(p.facets.length, 1);
  assert.equal(p.facets[0]!.features[0]!.uri, "https://www.smokysignal.app/plane/N305DK");
});

test("facet offsets are UTF-8 bytes, not UTF-16 code units", () => {
  const p = buildBlueskyPost(smokey4);
  const f = p.facets[0]!.index;
  const bytes = new TextEncoder().encode(p.text);
  const slice = new TextDecoder().decode(bytes.slice(f.byteStart, f.byteEnd));
  assert.equal(slice, "smokysignal.app/plane/N305DK");
  // Three "·" separators at 2 bytes each push the byte offset 3 past the
  // JS string index.
  assert.equal(f.byteStart, p.text.indexOf("smokysignal.app") + 3);
  assert.equal(utf8Length("·"), 2);
  assert.equal(utf8Length("\u{1F985}"), 4);

  const emoji = "\u{1F985} x https://a.b";
  const e = linkFacet(emoji, "https://a.b", "https://a.b")!;
  assert.deepEqual(e.index, { byteStart: 7, byteEnd: 18 });
  assert.equal(linkFacet("abc", "zzz", "https://a.b"), null);
});

test("buildBlueskyPost: region fallback and bare line", () => {
  const east = buildBlueskyPost({ ...smokey4, lat: 47.6, lon: -117.4 });
  assert.match(east.text, /^Smokey 4 up · East WA · 14:22 PT\n/);
  const nofix = buildBlueskyPost({ ...smokey4, lat: null, lon: null, nickname: null });
  assert.match(nofix.text, /^N305DK up · 14:22 PT\n/);
});

function jwt(expMs: number): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "ES256K" })}.${b64({ exp: Math.floor(expMs / 1000) })}.sig`;
}

type Call = { nsid: string; auth: string | null; body: unknown };

function mockPds(opts: { createRecordStatus?: number } = {}) {
  const calls: Call[] = [];
  let n = 0;
  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    const nsid = url.split("/xrpc/")[1]!;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    let body: unknown = null;
    if (typeof init?.body === "string") body = JSON.parse(init.body);
    else if (init?.body) body = "<bytes>";
    calls.push({ nsid, auth: headers.authorization ?? null, body });
    const json = (o: unknown, status = 200) =>
      new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
    switch (nsid) {
      case "com.atproto.server.createSession":
      case "com.atproto.server.refreshSession":
        n++;
        return json({ accessJwt: jwt(T + 2 * 3600_000), refreshJwt: jwt(T + 60 * 86400_000), did: "did:plc:test", handle: "x", n });
      case "com.atproto.repo.uploadBlob":
        return json({ blob: { $type: "blob", ref: { $link: "bafy" }, mimeType: "image/png", size: 4 } });
      case "com.atproto.repo.createRecord":
        return json({ uri: "at://x", cid: "y" }, opts.createRecordStatus ?? 200);
      default:
        return json({ error: "nope" }, 404);
    }
  };
  return { fetchFn, calls };
}

function deps(kv: MemoryBotKv, fetchFn: BlueskyDeps["fetchFn"], now = T): BlueskyDeps {
  return {
    config: { identifier: "smokysignal.app", password: "app-pass", service: "https://pds.test" },
    kv,
    fetchFn,
    now: () => now,
    renderCard: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  };
}

test("postTakeoffToBluesky: logs in, uploads the card, posts with facet + image embed", async () => {
  const kv = new MemoryBotKv(() => T);
  const pds = mockPds();
  const out = await postTakeoffToBluesky(smokey4, deps(kv, pds.fetchFn));
  assert.equal(out, "posted");
  assert.deepEqual(
    pds.calls.map((c) => c.nsid),
    ["com.atproto.server.createSession", "com.atproto.repo.uploadBlob", "com.atproto.repo.createRecord"],
  );
  const create = pds.calls[2]!.body as { repo: string; record: Record<string, any> };
  assert.equal(create.repo, "did:plc:test");
  assert.equal(create.record.$type, "app.bsky.feed.post");
  assert.equal(create.record.text, "Smokey 4 up · I-5 · Fife · 14:22 PT\nsmokysignal.app/plane/N305DK");
  assert.equal(create.record.facets[0].features[0].$type, "app.bsky.richtext.facet#link");
  assert.equal(create.record.embed.$type, "app.bsky.embed.images");
  assert.deepEqual(create.record.embed.images[0].aspectRatio, { width: 1200, height: 630 });
  assert.ok(kv.has(BSKY_SESSION_KEY), "session cached");
});

test("postTakeoffToBluesky: 30-minute per-tail cooldown, then the session is reused", async () => {
  const kv = new MemoryBotKv(() => T);
  const pds = mockPds();
  assert.equal(await postTakeoffToBluesky(smokey4, deps(kv, pds.fetchFn)), "posted");
  assert.equal(await postTakeoffToBluesky(smokey4, deps(kv, pds.fetchFn)), "cooldown");
  // Another tail posts, and does not log in again.
  const before = pds.calls.filter((c) => c.nsid.endsWith("createSession")).length;
  assert.equal(await postTakeoffToBluesky({ ...smokey4, tail: "N815SC" }, deps(kv, pds.fetchFn)), "posted");
  assert.equal(pds.calls.filter((c) => c.nsid.endsWith("createSession")).length, before);
});

test("postTakeoffToBluesky: hard daily cap, non-Smokey skipped, failed post releases cooldown", async () => {
  const kv = new MemoryBotKv(() => T);
  const pds = mockPds();
  for (let i = 0; i < BSKY_DAILY_CAP; i++) {
    assert.equal(await postTakeoffToBluesky({ ...smokey4, tail: `N${i}AB` }, deps(kv, pds.fetchFn)), "posted");
  }
  assert.equal(await postTakeoffToBluesky({ ...smokey4, tail: "N999ZZ" }, deps(kv, pds.fetchFn)), "daily_cap");

  const kv2 = new MemoryBotKv(() => T);
  assert.equal(
    await postTakeoffToBluesky({ ...smokey4, mission: "sar", matchMission: "sar" }, deps(kv2, pds.fetchFn)),
    "not_smokey",
  );
  assert.equal(
    await postTakeoffToBluesky({ ...smokey4, matchMission: null }, deps(kv2, pds.fetchFn)),
    "not_smokey",
    "mutual aid outside WA",
  );

  const bad = mockPds({ createRecordStatus: 500 });
  assert.equal(await postTakeoffToBluesky(smokey4, deps(kv2, bad.fetchFn)), "failed");
  assert.equal(await postTakeoffToBluesky(smokey4, deps(kv2, mockPds().fetchFn)), "posted", "cooldown was released");
});

test("getBskySession: refreshes near expiry instead of logging in again", async () => {
  const kv = new MemoryBotKv(() => T);
  await kv.set(
    BSKY_SESSION_KEY,
    JSON.stringify({ accessJwt: jwt(T + 60_000), refreshJwt: jwt(T + 30 * 86400_000), did: "did:plc:test" }),
  );
  const pds = mockPds();
  const s = await getBskySession(deps(kv, pds.fetchFn));
  assert.ok(s);
  assert.deepEqual(pds.calls.map((c) => c.nsid), ["com.atproto.server.refreshSession"]);
  assert.match(pds.calls[0]!.auth ?? "", /^Bearer /);
  assert.ok(jwtExpMs(s!.accessJwt) > T + 3600_000);
  assert.equal(jwtExpMs("garbage"), 0);
});
