import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EARCONS,
  EARCON_KINDS,
  EARCON_LABELS,
  EARCON_SPEECH_GAP_MS,
  earconDurationMs,
  earconForPushTitle,
  earconSchedule,
  planSpokenAlert,
} from "./earcon-core";

test("three tones, each with a different shape", () => {
  assert.deepEqual([...EARCON_KINDS], ["up", "near", "clear"]);
  const shapes = EARCON_KINDS.map((k) => JSON.stringify(EARCONS[k].map((n) => [n.hz, n.ms])));
  assert.equal(new Set(shapes).size, 3);
});

test("up rises, clear falls, near repeats one high note", () => {
  const up = EARCONS.up.map((n) => n.hz);
  const clear = EARCONS.clear.map((n) => n.hz);
  const near = EARCONS.near.map((n) => n.hz);
  assert.ok(up.every((hz, i) => i === 0 || hz > up[i - 1]!), "up rises");
  assert.ok(clear.every((hz, i) => i === 0 || hz < clear[i - 1]!), "clear falls");
  assert.equal(near.length, 3);
  assert.equal(new Set(near).size, 1);
  assert.ok(near[0]! > Math.max(...up), "near sits above up");
});

test("every note stays inside the Bluetooth hands-free band", () => {
  for (const k of EARCON_KINDS) {
    for (const n of EARCONS[k]) {
      assert.ok(n.hz >= 300 && n.hz <= 3400, `${k} ${n.hz} Hz`);
      assert.ok(n.ms >= 60, `${k} note long enough to hear`);
    }
  }
});

test("tones are short enough to sit in front of the words", () => {
  for (const k of EARCON_KINDS) {
    const ms = earconDurationMs(k);
    assert.ok(ms >= 250 && ms <= 600, `${k} ${ms} ms`);
  }
  assert.equal(earconDurationMs("up"), 150 + 50 + 190);
  assert.equal(earconDurationMs("near"), 90 * 3 + 60 * 2);
});

test("schedule lays notes end to end with their gaps, from t0", () => {
  const s = earconSchedule("near", 1);
  assert.equal(s.length, 3);
  const [a, b, c] = s as [(typeof s)[0], (typeof s)[0], (typeof s)[0]];
  assert.equal(a.start, 1);
  assert.ok(Math.abs(a.end - 1.09) < 1e-9);
  assert.ok(Math.abs(b.start - 1.15) < 1e-9);
  assert.ok(Math.abs(c.end - (1 + earconDurationMs("near") / 1000)) < 1e-9);
  for (const n of s) assert.ok(n.end > n.start);
});

test("push titles: takeoffs get the rising tone, down or clear the falling one", () => {
  assert.equal(earconForPushTitle("Smokey’s up."), "up");
  assert.equal(earconForPushTitle("SAR run."), "up");
  assert.equal(earconForPushTitle("Unconfirmed bird up."), "up");
  assert.equal(earconForPushTitle("Smokey’s down."), "clear");
  assert.equal(earconForPushTitle("All clear."), "clear");
  assert.equal(earconForPushTitle("Smokey 4 landed."), "clear");
  assert.equal(earconForPushTitle(undefined), "up");
  assert.equal(earconForPushTitle("Downtown pass"), "up");
});

test("plan: tone first, words after tone plus gap", () => {
  const p = planSpokenAlert({ kind: "near", tonesOn: true, audioAvailable: true });
  assert.deepEqual(p, { tone: "near", speakDelayMs: earconDurationMs("near") + EARCON_SPEECH_GAP_MS });
});

test("plan: no tone when off, no audio, or no kind; words go at once", () => {
  for (const args of [
    { kind: "up" as const, tonesOn: false, audioAvailable: true },
    { kind: "up" as const, tonesOn: true, audioAvailable: false },
    { kind: undefined, tonesOn: true, audioAvailable: true },
    { kind: null, tonesOn: true, audioAvailable: true },
  ]) {
    assert.deepEqual(planSpokenAlert(args), { tone: null, speakDelayMs: 0 });
  }
});

test("preview labels follow the brand rules", () => {
  for (const k of EARCON_KINDS) {
    const l = EARCON_LABELS[k];
    assert.ok(!/[!]/.test(l));
    assert.ok(/^[A-Za-z ]+$/.test(l));
  }
});
