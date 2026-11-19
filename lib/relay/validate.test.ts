// Run: npx tsx --test lib/relay/validate.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyWebhookUrl,
  isBlockedHostname,
  isPrivateAddress,
  maskWebhookUrl,
  normalizeDiscordWebhook,
  normalizeGenericWebhook,
  parseManageCredential,
  validateRelayInput,
} from "./validate";
import { assertPublicHost, PrivateAddressError } from "./net";

const ID = "112233445566778899";
const TOKEN = "aB3_dE-fGhIjKlMnOpQrStUvWxYz0123456789aBcDeFgHiJkLmNoPqRsTuVwXyZ01";

test("discord: canonical host and the ptb/canary/discordapp variants pass", () => {
  for (const host of [
    "discord.com",
    "ptb.discord.com",
    "canary.discord.com",
    "discordapp.com",
    "ptb.discordapp.com",
    "canary.discordapp.com",
    "DISCORD.COM",
  ]) {
    const url = `https://${host}/api/webhooks/${ID}/${TOKEN}`;
    assert.equal(
      normalizeDiscordWebhook(url),
      `https://${host.toLowerCase()}/api/webhooks/${ID}/${TOKEN}`,
      host,
    );
  }
});

test("discord: lookalikes, wrong paths, ports, queries and http are refused", () => {
  const bad = [
    `http://discord.com/api/webhooks/${ID}/${TOKEN}`,
    `https://discord.com.evil.io/api/webhooks/${ID}/${TOKEN}`,
    `https://evil-discord.com/api/webhooks/${ID}/${TOKEN}`,
    `https://x.discord.com/api/webhooks/${ID}/${TOKEN}`,
    `https://discord.gg/api/webhooks/${ID}/${TOKEN}`,
    `https://discord.com:8443/api/webhooks/${ID}/${TOKEN}`,
    `https://user:pw@discord.com/api/webhooks/${ID}/${TOKEN}`,
    `https://discord.com/api/webhooks/${ID}/${TOKEN}?wait=true`,
    `https://discord.com/api/webhooks/${ID}/${TOKEN}/slack`,
    `https://discord.com/api/webhooks/${ID}/${TOKEN}#frag`,
    `https://discord.com/api/webhooks/abc/${TOKEN}`,
    `https://discord.com/api/webhooks/${ID}/short`,
    `https://discord.com/api/v10/webhooks/${ID}/${TOKEN}`,
    `https://discord.com/api/webhooks/${ID}/../../users/@me`,
    `https://discord%2ecom/api/webhooks/${ID}/${TOKEN}`,
    `https:\\\\discord.com/api/webhooks/${ID}/${TOKEN}`,
  ];
  for (const u of bad) assert.equal(normalizeDiscordWebhook(u), null, u);
});

test("classify: one paste box routes Discord and generic URLs", () => {
  const d = classifyWebhookUrl(`https://discord.com/api/webhooks/${ID}/${TOKEN}`);
  assert.equal(d.ok && d.kind, "discord");
  const g = classifyWebhookUrl("https://hooks.example.com/smokey/abc123");
  assert.equal(g.ok && g.kind, "webhook");
  // A Discord host with the wrong path must not fall through to generic.
  const bad = classifyWebhookUrl("https://discord.com/api/channels/1/messages");
  assert.deepEqual(bad, { ok: false, error: "invalid_discord_webhook" });
  assert.deepEqual(classifyWebhookUrl("ftp://x.com/a"), { ok: false, error: "invalid_url" });
});

test("generic: public https hosts pass and are WHATWG-normalized", () => {
  assert.equal(
    normalizeGenericWebhook("https://Hooks.Example.com/in/abc?x=1"),
    "https://hooks.example.com/in/abc?x=1",
  );
  assert.equal(normalizeGenericWebhook("https://hooks.example.com:443/a"), "https://hooks.example.com/a");
  // A paste with a trailing newline is trimmed, not refused.
  assert.equal(normalizeGenericWebhook(" https://hooks.example.com/a\n"), "https://hooks.example.com/a");
  assert.equal(normalizeGenericWebhook("https://xn--bcher-kva.example/a"), null); // .example TLD reserved
  assert.equal(normalizeGenericWebhook("https://bücher.de/hook"), "https://xn--bcher-kva.de/hook");
});

test("generic SSRF: IP literals in every spelling are refused", () => {
  const bad = [
    "https://127.0.0.1/a",
    "https://10.0.0.1/a",
    "https://169.254.169.254/latest/meta-data",
    "https://8.8.8.8/a", // public, but still an IP literal
    "https://2130706433/a", // decimal 127.0.0.1
    "https://0x7f000001/a", // hex
    "https://0177.0.0.1/a", // octal
    "https://127.1/a", // short form
    "https://[::1]/a",
    "https://[::ffff:127.0.0.1]/a",
    "https://[fe80::1]/a",
    "https://[2606:4700::1111]/a", // public v6 literal
  ];
  for (const u of bad) assert.equal(normalizeGenericWebhook(u), null, u);
});

test("generic SSRF: internal names, ports, userinfo, schemes, encodings", () => {
  const bad = [
    "http://hooks.example.com/a",
    "https://localhost/a",
    "https://LOCALHOST/a",
    "https://api.localhost/a",
    "https://printer.local/a",
    "https://metadata.google.internal/a",
    "https://router.lan/a",
    "https://nas.home.arpa/a",
    "https://1.0.0.127.in-addr.arpa/a",
    "https://intranet/a", // single label
    "https://hooks.example.com./a", // trailing dot
    "https://hooks.example.com:8080/a",
    "https://hooks.example.com:444/a",
    "https://user@hooks.example.com/a",
    "https://user:pw@hooks.example.com/a",
    "https://hooks%2eexample.com/a",
    "https://%6c%6f%63%61%6c%68%6f%73%74/a", // encoded "localhost"
    "https://hooks.example.com\\@evil.com/a",
    "https:/\\hooks.example.com/a",
    "https://hooks.example.com/a b",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "",
    "https://" + "a".repeat(64) + ".com/a", // label > 63
    "https://" + "a".repeat(2100) + ".com",
  ];
  for (const u of bad) assert.equal(normalizeGenericWebhook(u), null, JSON.stringify(u));
});

test("isBlockedHostname: allows ordinary multi-label public names", () => {
  for (const h of ["hooks.slack.com", "maker.ifttt.com", "n8n.myclub.org", "a-b.co.uk"]) {
    assert.equal(isBlockedHostname(h), false, h);
  }
});

test("isPrivateAddress: v4 private, loopback, link-local, CGNAT, reserved", () => {
  const priv = [
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "100.127.255.255",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.8",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.9",
    "224.0.0.1",
    "255.255.255.255",
  ];
  for (const ip of priv) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "162.159.135.232"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test("isPrivateAddress: IPv6 forms, including ones embedding a private v4", () => {
  const priv = [
    "::",
    "::1",
    "fe80::1",
    "fe80::1%en0",
    "fc00::1",
    "fd12:3456::1",
    "fec0::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1", // same, hex tail
    "::ffff:10.0.0.1",
    "::127.0.0.1", // v4-compatible
    "64:ff9b::a9fe:a9fe", // NAT64 of 169.254.169.254
    "64:ff9b:1::1",
    "2002:7f00:1::", // 6to4 of 127.0.0.1
    "2001:db8::1",
    "2001::1", // Teredo
    "100::1",
    "[::1]",
    "not-an-ip",
    "1.2.3", // unparseable fails closed
  ];
  for (const ip of priv) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ["2606:4700:4700::1111", "2a00:1450:4009:81f::200e", "::ffff:8.8.8.8", "64:ff9b::808:808"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test("assertPublicHost: any private answer refuses the host", async () => {
  const lookup = (answers: string[]) => async () =>
    answers.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  await assertPublicHost("hooks.example.com", lookup(["93.184.216.34"]));
  await assert.rejects(
    assertPublicHost("rebind.example.com", lookup(["93.184.216.34", "127.0.0.1"])),
    PrivateAddressError,
  );
  await assert.rejects(
    assertPublicHost("v6.example.com", lookup(["::ffff:192.168.0.10"])),
    PrivateAddressError,
  );
  await assert.rejects(assertPublicHost("empty.example.com", lookup([])), /did not resolve/);
});

test("maskWebhookUrl: never shows the Discord token or a generic path", () => {
  const m = maskWebhookUrl(`https://discord.com/api/webhooks/${ID}/${TOKEN}`);
  assert.equal(m, `discord.com/api/webhooks/…/••••${TOKEN.slice(-4)}`);
  assert.ok(!m.includes(TOKEN.slice(0, 20)));
  assert.ok(!m.includes(ID));
  const g = maskWebhookUrl("https://hooks.example.com/secret-path-abcdef?key=zzzz9876");
  assert.equal(g, "hooks.example.com/••••9876");
  assert.equal(maskWebhookUrl("https://hooks.example.com/"), "hooks.example.com");
  assert.equal(maskWebhookUrl("garbage"), "••••");
});

test("validateRelayInput: create defaults and strict errors", () => {
  const ok = validateRelayInput(
    { url: `https://discord.com/api/webhooks/${ID}/${TOKEN}` },
    { partial: false },
  );
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.value.kind, "discord");
    assert.deepEqual(ok.value.events, ["takeoff"]);
    assert.deepEqual(ok.value.missions, ["police"]);
    assert.equal(ok.value.region, "all_wa");
    assert.equal(ok.value.quiet, null);
    assert.equal(ok.value.paused, false);
  }
  const cases: Array<[unknown, string]> = [
    [null, "invalid_payload"],
    [[], "invalid_payload"],
    [{}, "invalid_url"],
    [{ url: "https://127.0.0.1/a" }, "invalid_url"],
    [{ url: "https://hooks.example.com/a", events: [] }, "invalid_events"],
    [{ url: "https://hooks.example.com/a", events: ["squawk"] }, "invalid_events"],
    [{ url: "https://hooks.example.com/a", missions: ["fbi"] }, "invalid_missions"],
    [{ url: "https://hooks.example.com/a", region: "mars" }, "invalid_region"],
    [{ url: "https://hooks.example.com/a", region: "__proto__" }, "invalid_region"],
    [{ url: "https://hooks.example.com/a", quiet: { start_h: 24, end_h: 6 } }, "invalid_quiet"],
    [{ url: "https://hooks.example.com/a", paused: "yes" }, "invalid_paused"],
  ];
  for (const [body, error] of cases) {
    assert.deepEqual(validateRelayInput(body, { partial: false }), { ok: false, error }, JSON.stringify(body));
  }
});

test("validateRelayInput: missions use lib/mission.ts; legacy role names map", () => {
  const r = validateRelayInput({ missions: ["unknown", "federal_le", "police", "police"] }, { partial: true });
  assert.ok(r.ok && r.ok);
  if (r.ok) assert.deepEqual(r.value.missions, ["police", "federal_le", "unknown"]);
  const legacy = validateRelayInput({ missions: ["smokey", "patrol", "sar"] }, { partial: true });
  assert.ok(legacy.ok);
  if (legacy.ok) assert.deepEqual(legacy.value.missions, ["police", "sar"]);
  assert.deepEqual(validateRelayInput({ missions: ["cia"] }, { partial: true }), {
    ok: false,
    error: "invalid_missions",
  });
});

test("validateRelayInput: partial edits keep only what was sent; labels are cleaned", () => {
  const r = validateRelayInput(
    { paused: true, label: "  <b>Tacoma</b>\n Riders\u0007 ", quiet: { start_h: 23, end_h: 6, tz: "Bad/Zone" } },
    { partial: true },
  );
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.url, undefined);
    assert.equal(r.value.events, undefined);
    assert.equal(r.value.paused, true);
    assert.equal(r.value.label, "bTacoma/b Riders");
    assert.deepEqual(r.value.quiet, { start_h: 23, end_h: 6, tz: "America/Los_Angeles" });
  }
});

test("parseManageCredential: exact {id}.{token} shape only", () => {
  const id = "0123456789abcdef01234567";
  const tok = "A".repeat(43);
  assert.deepEqual(parseManageCredential(`Bearer ${id}.${tok}`), { id, token: tok });
  assert.deepEqual(parseManageCredential(`${id}.${tok}`), { id, token: tok });
  assert.equal(parseManageCredential(null), null);
  assert.equal(parseManageCredential(`Bearer ${id}.${tok}x`), null);
  assert.equal(parseManageCredential(`Bearer ${id.toUpperCase()}.${tok}`), null);
  assert.equal(parseManageCredential(`Bearer ${id}`), null);
});
