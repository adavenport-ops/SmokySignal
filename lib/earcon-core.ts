// Alert earcons (B23): a short generated tone before each spoken alert.
//
// Helmet coms (Cardo, Sena) duck or clip the first half second of phone
// audio while the Bluetooth channel wakes up, so a spoken alert loses its
// first word. A tone goes first and takes the clip; the words land after.
// Three shapes tell the alerts apart without words:
//
//   up    : two notes rising      (a bird just took off)
//   near  : three quick notes, high (a bird inside your range)
//   clear : two notes falling     (nothing we track is up)
//
// Pure: no Web Audio here, so the shapes and timing are unit tested.
// `lib/earcon.ts` plays a schedule with OscillatorNodes. No audio files.

export type EarconKind = "up" | "near" | "clear";

export const EARCON_KINDS: readonly EarconKind[] = ["up", "near", "clear"];

/** One note: a sine at `hz` for `ms`, after `gapMs` of silence. */
export type EarconNote = { hz: number; ms: number; gapMs: number };

// Frequencies sit inside 300 to 3400 Hz, the band a Bluetooth hands-free
// link carries, so the tone survives the narrowest helmet path.
export const EARCONS: Record<EarconKind, readonly EarconNote[]> = {
  up: [
    { hz: 660, ms: 150, gapMs: 0 },
    { hz: 880, ms: 190, gapMs: 50 },
  ],
  near: [
    { hz: 1175, ms: 90, gapMs: 0 },
    { hz: 1175, ms: 90, gapMs: 60 },
    { hz: 1175, ms: 90, gapMs: 60 },
  ],
  clear: [
    { hz: 880, ms: 150, gapMs: 0 },
    { hz: 587, ms: 220, gapMs: 50 },
  ],
};

/** Silence between the end of the tone and the first spoken word. */
export const EARCON_SPEECH_GAP_MS = 180;

/** Linear attack and release per note, so the tone starts and stops without a click. */
export const EARCON_RAMP_MS = 12;

/** Peak gain per note (0..1). Loud enough to wake the channel, under the voice. */
export const EARCON_GAIN = 0.28;

export function earconDurationMs(kind: EarconKind): number {
  return EARCONS[kind].reduce((sum, n) => sum + n.gapMs + n.ms, 0);
}

/** Absolute note timings in seconds from `t0`, ready for Web Audio. */
export type ScheduledNote = { hz: number; start: number; end: number };

export function earconSchedule(kind: EarconKind, t0 = 0): ScheduledNote[] {
  const out: ScheduledNote[] = [];
  let t = t0;
  for (const n of EARCONS[kind]) {
    t += n.gapMs / 1000;
    const start = t;
    t += n.ms / 1000;
    out.push({ hz: n.hz, start, end: t });
  }
  return out;
}

/**
 * Which tone a pushed alert gets. Pushes are takeoffs today ("Smokey's
 * up.", "SAR run."); a title that says down, landed or clear gets the
 * falling tone so a future landing push needs no change here.
 */
export function earconForPushTitle(title: string | undefined | null): EarconKind {
  const t = (title ?? "").toLowerCase();
  if (/\b(clear|down|landed)\b/.test(t)) return "clear";
  return "up";
}

/**
 * Plan for one spoken alert: which tone to play (or none) and how long to
 * hold the words back. Tones only play when the rider left them on and
 * the browser can make sound; otherwise the words go straight out.
 */
export function planSpokenAlert(args: {
  kind: EarconKind | null | undefined;
  tonesOn: boolean;
  audioAvailable: boolean;
}): { tone: EarconKind | null; speakDelayMs: number } {
  if (!args.kind || !args.tonesOn || !args.audioAvailable) {
    return { tone: null, speakDelayMs: 0 };
  }
  return {
    tone: args.kind,
    speakDelayMs: earconDurationMs(args.kind) + EARCON_SPEECH_GAP_MS,
  };
}

/** Labels for the settings preview row. */
export const EARCON_LABELS: Record<EarconKind, string> = {
  up: "Bird up",
  near: "Bird near",
  clear: "All clear",
};
