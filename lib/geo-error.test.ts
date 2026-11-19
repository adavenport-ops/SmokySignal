// Run: npx tsx --test lib/geo-error.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { geoErrorKind, geoErrorMessage, isIOS } from "./geo-error";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36";

test("only PERMISSION_DENIED counts as blocked", () => {
  assert.equal(geoErrorKind(1), "blocked");
  assert.equal(geoErrorKind(2), "waiting");
  assert.equal(geoErrorKind(3), "waiting");
  assert.equal(geoErrorKind(undefined), "waiting");
});

test("iOS block points at the system switch", () => {
  assert.equal(isIOS(IPHONE), true);
  assert.match(geoErrorMessage(1, IPHONE), /Safari Websites/);
  assert.match(geoErrorMessage(1, CHROME), /browser settings/);
  assert.match(geoErrorMessage(3, IPHONE), /Finding you/);
});
