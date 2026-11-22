// Run: npx tsx --test lib/speed-warning-prefs.test.ts
//
// B20: the radius pick round-trips through localStorage and a bad stored
// value falls back to the 5 nm default. A tiny in-memory window stands in
// for the browser.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SPEED_WARNING_PREFS,
  SPEED_WARNING_PREFS_EVENT,
  SPEED_WARNING_RADIUS_KEY,
  readSpeedWarningPrefs,
  setSpeedWarningRadiusNm,
} from "./speed-warning-prefs";

const store = new Map<string, string>();
const events: string[] = [];
const g = globalThis as unknown as { window?: unknown };

beforeEach(() => {
  store.clear();
  events.length = 0;
  g.window = {
    localStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    },
    dispatchEvent: (e: Event) => {
      events.push(e.type);
      return true;
    },
  };
});

test("default radius is 5 nm with nothing stored", () => {
  assert.equal(DEFAULT_SPEED_WARNING_PREFS.birdRadiusNm, 5);
  assert.equal(readSpeedWarningPrefs().birdRadiusNm, 5);
});

test("each pick round-trips and announces the change", () => {
  for (const nm of [2, 3, 5]) {
    setSpeedWarningRadiusNm(nm);
    assert.equal(store.get(SPEED_WARNING_RADIUS_KEY), String(nm));
    assert.equal(readSpeedWarningPrefs().birdRadiusNm, nm);
  }
  assert.deepEqual(events, [SPEED_WARNING_PREFS_EVENT, SPEED_WARNING_PREFS_EVENT, SPEED_WARNING_PREFS_EVENT]);
});

test("a hand-edited or garbage stored value reads as 5", () => {
  for (const bad of ["4", "0", "-3", "abc", "", "2.5", "NaN"]) {
    store.set(SPEED_WARNING_RADIUS_KEY, bad);
    assert.equal(readSpeedWarningPrefs().birdRadiusNm, 5, `stored ${JSON.stringify(bad)}`);
  }
});

test("writing an off-list value stores the default, never the raw number", () => {
  setSpeedWarningRadiusNm(4);
  assert.equal(store.get(SPEED_WARNING_RADIUS_KEY), "5");
});
