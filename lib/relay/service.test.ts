// Run: npx tsx --test lib/relay/service.test.ts
//
// Route-level behaviour against MemoryKv and a fake resolver: the manage
// token is stored only as a hash, the webhook URL never comes back, and
// the cap holds.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRelayService,
  deleteRelayService,
  getRelayService,
  testRelayService,
  updateRelayService,
  type ServiceDeps,
} from "./service";
import { MemoryKv, createRelay, getRelay } from "./store";
import { hashManageToken } from "./crypto";
import { MAX_RELAYS, type StoredRelay } from "./types";
import type { LookupAllFn } from "./net";
import type { RelayDeps } from "./dispatch";

const DISCORD = `https://discord.com/api/webhooks/112233445566778899/${"a".repeat(68)}`;
const GENERIC = "https://hooks.example.com/in/very-secret-path-0001";

const publicDns: LookupAllFn = async () => [{ address: "93.184.216.34", family: 4 }];
const privateDns: LookupAllFn = async () => [{ address: "10.0.0.5", family: 4 }];
const deadDns: LookupAllFn = async () => {
  throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
};

function deps(kv = new MemoryKv(), lookupAll: LookupAllFn = publicDns): ServiceDeps {
  return { kv, lookupAll, siteUrl: "https://smokysignal.app", now: () => 1_763_500_000_000 };
}

function credFrom(manageUrl: string): string {
  const frag = new URL(manageUrl).hash.slice(1);
  return `Bearer ${frag}`;
}

test("create: Discord relay returns a one-time manage URL; only the token hash is stored", async () => {
  const d = deps();
  const r = await createRelayService({ url: DISCORD }, d);
  assert.equal(r.status, 201);
  const url = r.body.manage_url as string;
  assert.match(url, /^https:\/\/smokysignal\.app\/relay\/manage#[0-9a-f]{24}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(r.body.secret, null);
  const [id, token] = new URL(url).hash.slice(1).split(".");
  const stored = (await getRelay(d.kv, id!))!;
  assert.equal(stored.tokenHash, hashManageToken(token!));
  assert.ok(!JSON.stringify(stored).includes(token!), "raw token not persisted");
  // The response never echoes the webhook URL or its token.
  const body = JSON.stringify(r.body);
  assert.ok(!body.includes(DISCORD));
  assert.ok(!body.includes("a".repeat(20)));
  assert.equal((r.body.relay as { urlMasked: string }).urlMasked, "discord.com/api/webhooks/…/••••aaaa");
});

test("create: generic relay gets a signing secret, shown once", async () => {
  const d = deps();
  const r = await createRelayService({ url: GENERIC, events: ["takeoff", "landing"] }, d);
  assert.equal(r.status, 201);
  assert.match(r.body.secret as string, /^whsec_/);
  const got = await getRelayService(credFrom(r.body.manage_url as string), d);
  assert.equal(got.status, 200);
  assert.ok(!JSON.stringify(got.body).includes("whsec_"), "secret not returned again");
  assert.ok(!JSON.stringify(got.body).includes("very-secret-path"));
});

test("create: invalid webhook is a 400; private and unresolvable hosts are 400s", async () => {
  assert.deepEqual((await createRelayService({ url: "https://127.0.0.1/x" }, deps())).body, {
    error: "invalid_url",
  });
  assert.equal((await createRelayService({ url: "not a url" }, deps())).status, 400);
  const priv = await createRelayService({ url: GENERIC }, deps(new MemoryKv(), privateDns));
  assert.deepEqual([priv.status, priv.body.error], [400, "private_host"]);
  const dead = await createRelayService({ url: GENERIC }, deps(new MemoryKv(), deadDns));
  assert.deepEqual([dead.status, dead.body.error], [400, "unresolvable_host"]);
});

test("create: the 2000-relay cap returns 503", async () => {
  const kv = new MemoryKv();
  for (let i = 0; i < MAX_RELAYS; i++) await kv.sadd("relay:index", `x${i}`);
  const r = await createRelayService({ url: DISCORD }, deps(kv));
  assert.deepEqual([r.status, r.body.error], [503, "at_capacity"]);
});

test("manage: wrong, malformed, and missing credentials all read 401", async () => {
  const d = deps();
  const r = await createRelayService({ url: DISCORD }, d);
  const [id] = new URL(r.body.manage_url as string).hash.slice(1).split(".");
  for (const auth of [null, "", "Bearer nope", `Bearer ${id}.${"B".repeat(43)}`, `Bearer ${"0".repeat(24)}.${"B".repeat(43)}`]) {
    const g = await getRelayService(auth, d);
    assert.equal(g.status, 401, String(auth));
  }
});

test("manage: pause, edit, swap to generic (new secret), delete", async () => {
  const d = deps();
  const r = await createRelayService({ url: DISCORD }, d);
  const auth = credFrom(r.body.manage_url as string);

  const paused = await updateRelayService(auth, { paused: true }, d);
  assert.equal((paused.body.relay as { paused: boolean }).paused, true);

  const edited = await updateRelayService(auth, { region: "puget_sound", missions: ["police", "sar"], label: "Club" }, d);
  const v = edited.body.relay as { region: string; missions: string[]; label: string; kind: string };
  assert.deepEqual([v.region, v.missions, v.label, v.kind], ["puget_sound", ["police", "sar"], "Club", "discord"]);

  const bad = await updateRelayService(auth, { region: "mars" }, d);
  assert.equal(bad.status, 400);

  const swapped = await updateRelayService(auth, { url: GENERIC }, d);
  assert.equal((swapped.body.relay as { kind: string }).kind, "webhook");
  assert.match(swapped.body.secret as string, /^whsec_/);

  const gone = await deleteRelayService(auth, d);
  assert.equal(gone.status, 200);
  assert.equal((await getRelayService(auth, d)).status, 401);
});

test("test send: goes through the injected transport, marked as a test", async () => {
  const kv = new MemoryKv();
  const d = deps(kv);
  const r = await createRelayService({ url: DISCORD }, d);
  const sent: string[] = [];
  const relayDeps: RelayDeps = {
    getKv: async () => kv,
    post: async (_url, body) => {
      sent.push(body);
      return { status: 204, headers: {}, body: "" };
    },
    siteUrl: "https://smokysignal.app",
    now: () => Date.UTC(2026, 10, 18, 22, 22),
    sleep: async () => {},
  };
  const t = await testRelayService(credFrom(r.body.manage_url as string), { ...d, relayDeps });
  assert.deepEqual(t.body, { ok: true, status: 204, retried: false });
  assert.equal(JSON.parse(sent[0]!).embeds[0].title, "Test signal. Smokey’s up.");
  const after = await getRelayService(credFrom(r.body.manage_url as string), d);
  assert.equal((after.body.relay as { lastStatus: number }).lastStatus, 204);
});

test("store: legacy rows map through the back-compat mapper; junk falls back to police", async () => {
  const kv = new MemoryKv();
  const row = {
    id: "f".repeat(24),
    kind: "discord",
    url: DISCORD,
    events: ["takeoff"],
    region: "all_wa",
    missions: ["future-mission"],
    quiet: null,
    paused: false,
    label: "",
    tokenHash: hashManageToken("t"),
    secret: null,
    createdAt: 0,
    updatedAt: 0,
  } as unknown as StoredRelay;
  await createRelay(kv, row);
  assert.deepEqual((await getRelay(kv, row.id))!.missions, ["police"]);
  // Legacy role names go through the back-compat mapper, not the default.
  const old = { ...row, id: "e".repeat(24), missions: ["smokey", "patrol", "unknown"] } as unknown as StoredRelay;
  await createRelay(kv, old);
  assert.deepEqual((await getRelay(kv, old.id))!.missions, ["police", "unknown"]);
});
