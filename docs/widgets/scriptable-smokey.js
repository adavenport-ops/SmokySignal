// SmokySignal home screen widget for Scriptable (iOS).
//
// Install:
//   1. Get Scriptable from the App Store (free, by Simon B. Stovring).
//   2. Open it, tap +, paste this whole file, and name the script
//      "Smokey".
//   3. Long-press the home screen, tap +, pick Scriptable, choose the
//      small size, add it, then long-press the widget, Edit Widget, and
//      set Script to "Smokey".
//
// What it shows: "Smokey's up." in orange when an enforcement bird is
// airborne, "Smokey's down." in green when nothing is up, and "No
// signal." when the feed can't vouch for the read. Under it: the count
// and the time of the read, 24-hour Pacific. Tapping the widget opens
// smokysignal.app.
//
// Data: GET https://smokysignal.app/api/status.json
//   {"state":"up"|"down"|"stale","count":1,"fetched_at":"2026-...Z","age_s":10}
// See docs/beacon.md. iOS decides how often widgets refresh (roughly
// every 5 to 15 minutes); the script asks for a refresh in 5.

const STATUS_URL = "https://smokysignal.app/api/status.json";
const SITE_URL = "https://smokysignal.app";

const COLORS = {
  bg: new Color("#0B0D10"),
  fg0: new Color("#F2F4F7"),
  fg2: new Color("#82899A"),
  alert: new Color("#FF7A1A"),
  clear: new Color("#5DD9A7"),
};

async function readStatus() {
  try {
    const req = new Request(STATUS_URL);
    req.timeoutInterval = 10;
    req.headers = { Accept: "application/json" };
    const data = await req.loadJSON();
    if (!data || typeof data.state !== "string") return null;
    return data;
  } catch (e) {
    return null;
  }
}

function ptTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${fmt.format(d)} PT`;
}

function headline(status) {
  if (!status || status.state === "stale") {
    return { text: "No signal.", color: COLORS.fg2 };
  }
  if (status.state === "up") return { text: "Smokey's up.", color: COLORS.alert };
  return { text: "Smokey's down.", color: COLORS.clear };
}

function detail(status) {
  if (!status) return "Feed didn't answer.";
  if (status.state === "stale") {
    const t = ptTime(status.fetched_at);
    return t ? `Last read ${t}` : "Feed quiet.";
  }
  const t = ptTime(status.fetched_at);
  if (status.state === "up") {
    const n = Math.max(1, Number(status.count) || 1);
    return `${n} up · ${t}`;
  }
  return `All clear · ${t}`;
}

async function buildWidget() {
  const status = await readStatus();
  const w = new ListWidget();
  w.backgroundColor = COLORS.bg;
  w.url = SITE_URL;
  w.setPadding(14, 14, 14, 14);

  const eyebrow = w.addText("SMOKYSIGNAL");
  eyebrow.font = Font.semiboldMonospacedSystemFont(9);
  eyebrow.textColor = COLORS.fg2;

  w.addSpacer();

  const h = headline(status);
  const title = w.addText(h.text);
  title.font = Font.heavySystemFont(20);
  title.textColor = h.color;
  title.minimumScaleFactor = 0.6;
  title.lineLimit = 2;

  w.addSpacer(6);

  const sub = w.addText(detail(status));
  sub.font = Font.mediumMonospacedSystemFont(11);
  sub.textColor = COLORS.fg0;
  sub.lineLimit = 1;
  sub.minimumScaleFactor = 0.7;

  w.refreshAfterDate = new Date(Date.now() + 5 * 60 * 1000);
  return w;
}

const widget = await buildWidget();
if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentSmall();
}
Script.complete();
