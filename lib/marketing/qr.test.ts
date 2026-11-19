import { test } from "node:test";
import assert from "node:assert/strict";
import { BOARD_URL, POSTER_URL, qrSvg } from "./qr";

test("qrSvg returns an accessible, scannable svg", async () => {
  const svg = await qrSvg(POSTER_URL, "QR code for smokysignal.app");
  assert.match(svg, /^<svg /);
  assert.match(svg, /role="img"/);
  assert.match(svg, /aria-label="QR code for smokysignal.app"/);
  assert.match(svg, /viewBox="0 0 \d+ \d+"/);
  assert.match(svg, /#000000/);
});

test("different urls give different codes", async () => {
  const a = await qrSvg(POSTER_URL, "a");
  const b = await qrSvg(BOARD_URL, "b");
  assert.notEqual(a.replace(/aria-label="[^"]*"/, ""), b.replace(/aria-label="[^"]*"/, ""));
});

test("poster urls point at the canonical host", () => {
  assert.equal(POSTER_URL, "https://www.smokysignal.app/?ref=poster");
  assert.equal(BOARD_URL, "https://www.smokysignal.app/board");
});
