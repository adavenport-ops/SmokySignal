import { test } from "node:test";
import assert from "node:assert/strict";
import { displayNickname, displayNicknameText, isOlderAirframe } from "./nickname-display";

test("legacy tag reads as older airframe", () => {
  assert.equal(displayNickname("Guardian One (legacy)"), "Guardian One (older airframe)");
  assert.equal(displayNickname("Guardian One (Legacy)"), "Guardian One (older airframe)");
});

test("other nicknames pass through untouched", () => {
  assert.equal(displayNickname("Smokey 4"), "Smokey 4");
  assert.equal(displayNickname("Guardian One"), "Guardian One");
  assert.equal(displayNickname(null), null);
  assert.equal(displayNickname(undefined), null);
  assert.equal(displayNickname(""), null);
});

test("works on a whole line", () => {
  assert.equal(
    displayNicknameText("Guardian One (legacy) · 3 takeoffs"),
    "Guardian One (older airframe) · 3 takeoffs",
  );
  assert.equal(displayNicknameText("N215SC on watch"), "N215SC on watch");
  assert.equal(
    displayNicknameText("Guardian One legacy assignment unverified"),
    "Guardian One older-airframe assignment unverified",
  );
});

test("isOlderAirframe flags only the legacy tag", () => {
  assert.equal(isOlderAirframe("Guardian One (legacy)"), true);
  assert.equal(isOlderAirframe("Guardian One"), false);
  assert.equal(isOlderAirframe(null), false);
});
