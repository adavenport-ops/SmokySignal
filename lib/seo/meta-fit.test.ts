import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DESCRIPTION_LIMIT,
  TITLE_BUDGET,
  TITLE_LIMIT,
  TITLE_SUFFIX,
  clip,
  flightDescription,
  flightTitle,
  nicknameVariants,
} from "./meta-fit";

const WHEN = "2026-11-17 14:22 PT";

test("title budget leaves room for the template suffix", () => {
  assert.equal(TITLE_BUDGET + TITLE_SUFFIX.length, TITLE_LIMIT);
});

test("nicknameVariants: full, parenthetical dropped, none", () => {
  assert.deepEqual(nicknameVariants("Guardian One (legacy)"), ["Guardian One (legacy)", "Guardian One", null]);
  assert.deepEqual(nicknameVariants("Smokey 4"), ["Smokey 4", null]);
  assert.deepEqual(nicknameVariants(null), [null]);
});

test("flightTitle: keeps a short nickname, trims a long one, stays in budget", () => {
  assert.equal(flightTitle("N305DK", "Smokey 4", WHEN), `N305DK "Smokey 4" flight, ${WHEN}`);
  const long = flightTitle("N2446X", "Guardian One (legacy)", WHEN);
  assert.equal(long, `N2446X "Guardian One" flight, ${WHEN}`);
  for (const nick of ["Guardian One (legacy)", "Smokey 5 (renamed)", "A very long community nickname for this one", null]) {
    const t = flightTitle("N12345", nick, WHEN);
    assert.ok((t + TITLE_SUFFIX).length <= TITLE_LIMIT, `${t} is ${(t + TITLE_SUFFIX).length}`);
    assert.ok(t.includes("N12345"));
  }
});

test("flightDescription: at most 160 characters for every nickname length", () => {
  for (const nick of ["Smokey 4", "Guardian One (legacy)", "A very long community nickname for this one", null]) {
    const d = flightDescription({
      tail: "N2446X",
      nickname: nick,
      model: "Cessna 182T Skylane (turbo, FLIR turret)",
      agency: "King County Sheriff's Office",
      when: WHEN,
    });
    assert.ok(d.length <= DESCRIPTION_LIMIT, `${d.length}: ${d}`);
    assert.ok(d.includes("N2446X") && d.includes(WHEN));
  }
});

test("clip: word boundary plus ellipsis", () => {
  assert.equal(clip("short", 10), "short");
  const c = clip("one two three four five six", 15);
  assert.ok(c.length <= 15);
  assert.ok(c.endsWith("…"));
});
