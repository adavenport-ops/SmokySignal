// Run: npx tsx --test lib/bots/telegram-profile.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { TELEGRAM_DESCRIPTION, TELEGRAM_SHORT_DESCRIPTION } from "./telegram-profile";

test("profile copy fits Telegram limits and brand rules", () => {
  assert.ok(TELEGRAM_SHORT_DESCRIPTION.length <= 120, `short ${TELEGRAM_SHORT_DESCRIPTION.length}`);
  assert.ok(TELEGRAM_DESCRIPTION.length <= 512, `long ${TELEGRAM_DESCRIPTION.length}`);
  for (const s of [TELEGRAM_SHORT_DESCRIPTION, TELEGRAM_DESCRIPTION]) assert.ok(!s.includes("!"));
});
