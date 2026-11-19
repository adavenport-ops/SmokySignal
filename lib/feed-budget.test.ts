// Run: npx tsx --test lib/feed-budget.test.ts
//
// At the planned 30 s tick cadence every provider must stay inside its
// published limit. adsb.lol's 500/day cannot take one request per tick
// (2,880/day), so it gets its own longer interval.

import { test } from "node:test";
import assert from "node:assert";
import {
  DAY_S,
  PLANNED_CADENCE_S,
  effectiveIntervalS,
  fitsBudget,
  minIntervalS,
  providerLimits,
  requestsPerDay,
} from "./feed-budget";

test("requestsPerDay", () => {
  assert.equal(requestsPerDay(30), 2880);
  assert.equal(requestsPerDay(10), 8640);
  assert.equal(requestsPerDay(192), 450);
  assert.equal(requestsPerDay(30, 2), 5760);
  assert.equal(requestsPerDay(0), Infinity);
});

test("adsb.lol without a key: 500/day with 10% headroom is one request per 192 s", () => {
  const { lol } = providerLimits({});
  assert.equal(lol.perDay, 500);
  assert.equal(minIntervalS(lol), 192);
  assert.equal(requestsPerDay(192), 450);
  assert.equal(fitsBudget(lol, PLANNED_CADENCE_S), false, "every tick would blow the quota");
  assert.equal(fitsBudget(lol, effectiveIntervalS(PLANNED_CADENCE_S, lol)), true);
});

test("adsb.lol with a feeder key quota", () => {
  const { lol } = providerLimits({ ADSBLOL_DAILY_QUOTA: "7200" });
  assert.equal(minIntervalS(lol), 14);
  assert.equal(effectiveIntervalS(PLANNED_CADENCE_S, lol), 30, "cadence binds, not quota");
  assert.equal(fitsBudget(lol, 30), true);
});

test("bad quota env falls back to the anonymous figure", () => {
  assert.equal(providerLimits({ ADSBLOL_DAILY_QUOTA: "lots" }).lol.perDay, 500);
  assert.equal(providerLimits({ ADSBLOL_DAILY_QUOTA: "-3" }).lol.perDay, 500);
});

test("1 req/s feeds fit at the planned cadence and even at the 10 s cache floor", () => {
  const limits = providerLimits({});
  for (const l of [limits.fi, limits.apl]) {
    assert.equal(minIntervalS(l), 1);
    assert.equal(fitsBudget(l, PLANNED_CADENCE_S), true);
    assert.equal(fitsBudget(l, 10), true);
  }
});

test("every provider fits at its effective interval for the planned cadence", () => {
  const limits = providerLimits({});
  let total = 0;
  for (const l of Object.values(limits)) {
    const s = effectiveIntervalS(PLANNED_CADENCE_S, l);
    assert.ok(fitsBudget(l, s), `${l.src} within budget at ${s}s`);
    total += requestsPerDay(s);
  }
  // fi 2880 + lol 450 + apl 2880 (when enabled)
  assert.equal(total, 2880 + 450 + 2880);
  assert.ok(total < DAY_S);
});
