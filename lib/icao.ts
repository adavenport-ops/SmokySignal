// FAA N-number ↔ ICAO24 hex address conversion.
// Port of github.com/guillaumemichel/icao-nnumber_converter (MIT).
// US registry occupies hex range 0xA00001 – 0xADF7C7.

const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // 24 letters, no I or O
const DIGITSET = "0123456789";
// Order matters: reference puts letters before digits so that at the final
// position, allchars.index('A')==0 and allchars.index('0')==24.
const ALLCHARS = CHARSET + DIGITSET;
const NNUMBER_MAX_SIZE = 6; // "N" + up to 5 chars

// Suffix space: 0–2 letters, "" + "A".."Z" + "AA".."ZZ" minus 0
const SUFFIX_SIZE = 1 + CHARSET.length * (1 + CHARSET.length); // 601

const BUCKET4_SIZE = 1 + CHARSET.length + DIGITSET.length;          // 35
const BUCKET3_SIZE = DIGITSET.length * BUCKET4_SIZE + SUFFIX_SIZE;  // 951
const BUCKET2_SIZE = DIGITSET.length * BUCKET3_SIZE + SUFFIX_SIZE;  // 10111
const BUCKET1_SIZE = DIGITSET.length * BUCKET2_SIZE + SUFFIX_SIZE;  // 101711

const US_BASE = 0xa00001;

function isLetter(c: string): boolean {
  return CHARSET.includes(c);
}

function suffixOffset(suffix: string): number {
  if (suffix.length === 0) return 0;
  if (![...suffix].every(isLetter)) return -1;
  let count = (CHARSET.length + 1) * CHARSET.indexOf(suffix[0]!) + 1;
  if (suffix.length === 2) count += CHARSET.indexOf(suffix[1]!) + 1;
  return count;
}

/**
 * Convert "N305DK" → "a4a9bd" (lowercase 6-char hex).
 * Returns null on invalid input.
 */
export function nNumberToIcao(n: string): string | null {
  if (!n || n[0] !== "N" || n.length > NNUMBER_MAX_SIZE) return null;
  const body = n.slice(1).toUpperCase();
  if (body.length === 0) return null;
  // first char must be 1-9
  if (!/[1-9]/.test(body[0]!)) return null;

  let output = US_BASE;

  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;

    if (i === NNUMBER_MAX_SIZE - 2) {
      // Last possible position — only a single digit or letter allowed here.
      const idx = ALLCHARS.indexOf(c);
      if (idx < 0) return null;
      output += idx + 1;
      break;
    }

    if (isLetter(c)) {
      const off = suffixOffset(body.slice(i));
      if (off < 0) return null;
      output += off;
      break;
    }

    if (!DIGITSET.includes(c)) return null;
    const d = Number(c);

    if (i === 0) {
      output += (d - 1) * BUCKET1_SIZE;
    } else if (i === 1) {
      output += d * BUCKET2_SIZE + SUFFIX_SIZE;
    } else if (i === 2) {
      output += d * BUCKET3_SIZE + SUFFIX_SIZE;
    } else if (i === 3) {
      output += d * BUCKET4_SIZE + SUFFIX_SIZE;
    } else if (i === 4) {
      output += d + SUFFIX_SIZE;
    }
  }

  return output.toString(16).padStart(6, "0");
}

export function nNumberToIcaoOrThrow(n: string): string {
  const hex = nNumberToIcao(n);
  if (!hex) throw new Error(`Invalid N-number: ${n}`);
  return hex;
}
