// Telegram bot profile copy. Brand voice: no emoji, no exclamation marks.
// Limits (Bot API): description 512 chars, short description 120.

/** Display name in chats and search (BotFather /setname). */
export const TELEGRAM_NAME = "SmokySignal";

/** Shown on the bot's profile and in shares ("About"). */
export const TELEGRAM_SHORT_DESCRIPTION =
  "Hear when Smokey is up. Live alerts for Washington State Patrol and police aircraft, from public flight data.";

/** Shown in an empty chat before the rider taps Start. */
export const TELEGRAM_DESCRIPTION = [
  "SmokySignal tells you when the patrol aircraft are flying, from public ADS-B flight data.",
  "",
  "Tap Start for alerts when Smokey takes off. Narrow them to your roads with /corridor, quiet them overnight with /quiet, and ask /status any time.",
  "",
  "On iPhone, turn on Announce Notifications for Telegram and alerts are read into your AirPods or CarPlay, even with the phone locked.",
  "",
  "No account. We keep your chat id and your filters, nothing else. /stop deletes it.",
  "",
  "smokysignal.app",
].join("\n");
