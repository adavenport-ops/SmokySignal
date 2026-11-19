// Display-layer wording for registry nicknames. The registry keeps its
// own labels (lib/seed.ts, KV); riders see plain words. "Guardian One
// (legacy)" is the second, older KCSO airframe that still carries the
// Guardian One name, so it reads "Guardian One (older airframe)".
//
// Pure, so it can run on a nickname or on a whole line that contains
// one ("Guardian One (legacy) · 3 takeoffs").

const LEGACY_TAG = /\(legacy\)/gi;
const OLDER_AIRFRAME = "(older airframe)";

/** Rider-facing nickname. null/undefined/empty pass through as null. */
export function displayNickname(nickname: string | null | undefined): string | null {
  if (!nickname) return null;
  return displayNicknameText(nickname);
}

/** Same rewrite on any line of rider-facing text. */
export function displayNicknameText(text: string): string {
  return text.replace(LEGACY_TAG, OLDER_AIRFRAME).replace(/Guardian One legacy/gi, "Guardian One older-airframe");
}

/** True when the nickname marks an older airframe (for a one-line note). */
export function isOlderAirframe(nickname: string | null | undefined): boolean {
  return Boolean(nickname && /\(legacy\)/i.test(nickname));
}
