# Relay

Smokey's takeoffs, posted where riders and clubs already talk. No
accounts. Set one up at [smokysignal.app/relay](https://smokysignal.app/relay).

Four ways in, from most setup to none:

1. **Discord channel webhook.** An embed in the channel on every takeoff.
2. **Generic HTTPS webhook.** Signed JSON to any endpoint you run
   (n8n, Zapier, Make, Home Assistant, a Cloudflare Worker).
3. **Feeds.** `/feed.xml` (Atom) and `/rss.xml` for readers and RSS bots.
4. **Phone.** A Siri Shortcut, a Scriptable widget, KWGT or Tasker.

## 1. Discord

### Make the webhook

1. In Discord, open the channel's settings (the gear next to its name).
   You need the Manage Webhooks permission on that channel.
2. **Integrations**, then **Webhooks**, then **New Webhook**.
3. Name it anything; Relay posts as "SmokySignal" with its own avatar.
4. **Copy Webhook URL**. It looks like
   `https://discord.com/api/webhooks/123456789012345678/AbC...xyz`.

### Arm the relay

1. Open [/relay](https://smokysignal.app/relay) and paste the URL.
2. Pick events (takeoff by default, landing optional), a region, and
   missions. The default is Smokey only: the `police` mission (WSP,
   county sheriffs, city and tribal units, and neighbors on mutual aid).
   Federal, search and rescue, wildfire, medevac, survey, transport and
   unconfirmed birds are opt-in. Mutual-aid units only post while they
   are inside Washington airspace.
3. Optional quiet hours, in Pacific time. Nothing posts inside the window.
4. **Arm relay.** You get a **manage link** once. Save it. It is the
   only key to the relay: we store a SHA-256 of the token in it, not the
   token, so a lost link can't be recovered. Arm a new relay and delete
   the old webhook in Discord instead.

The manage link lets you pause, resume, edit, send a test, or delete.
The key sits after the `#`, so browsers never send it to our server in
the URL or a Referer header; the page sends it as an `Authorization`
header to `/api/relay/manage`.

### What a post looks like

- Username **SmokySignal**, mentions switched off (`allowed_mentions`
  is empty, so nothing can ping `@everyone` or a role).
- Title **Smokey's up.** for police takeoffs. Every other mission names
  itself, in the same voice as push alerts: "Federal up.", "SAR run.",
  "Fire run.", "Medevac up.", "Survey up.", "Transport up.",
  "Unconfirmed bird up."; landings read "... down.".
- The bird's nickname, tail and police unit (WSP, Sheriff, ...), the corridor ("I-5 · Fife"), altitude,
  and the time in 24-hour PT.
- A link to `/plane/{tail}` and the live status card as the image.
- Orange side bar (`#FF7A1A`) for Smokey up; neutral for everything else.

### Rules

- One post per bird per event per 20 minutes for each relay.
- Discord's 429 `retry_after` is honoured once.
- A webhook that answers 404, 401, 410, or Discord's "Unknown Webhook"
  (code 10015) three times is deleted. Delete the webhook in Discord and
  the relay cleans itself up.
- The webhook URL is a secret. After you save it, every screen shows it
  masked (`discord.com/api/webhooks/…/••••xyz1`).

## 2. Generic HTTPS webhook

Paste any `https://` URL on a public host. Refused: `http`, custom ports,
`user:pass@` in the URL, IP literals, internal names (`localhost`,
`.local`, `.internal`, `.lan`, ...), and any host whose DNS answers land
in a private, loopback, link-local, CGNAT, or reserved range. The DNS
check runs when you save and again on every connection, so a host can't
be pointed inward later. Redirects are not followed.

### Payload, version 1

`POST`, `Content-Type: application/json`.

```json
{
  "v": 1,
  "type": "takeoff",
  "tail": "N305DK",
  "nickname": "Smokey 4",
  "mission": "police",
  "police_unit": "wsp",
  "lat": 47.2393,
  "lon": -122.3571,
  "alt_ft": 1800,
  "corridor": "I-5 · Fife",
  "ts_iso": "2026-11-18T22:22:00.000Z",
  "url": "https://smokysignal.app/plane/N305DK"
}
```

| Field | Type | Meaning |
|---|---|---|
| `v` | `1` | Schema version. Fields are only ever added; a breaking change bumps this. |
| `type` | `"takeoff"` \| `"landing"` | The event. |
| `tail` | string | FAA N-number (or USCG airframe id). |
| `nickname` | string \| null | Registry nickname, e.g. "Smokey 4". |
| `mission` | `"police"` \| `"federal_le"` \| `"sar"` \| `"wildfire"` \| `"medevac"` \| `"survey"` \| `"transport"` \| `"unknown"` | Mission class from the registry (lib/mission.ts). `police` is Smokey and the default filter. |
| `police_unit` | `"wsp"` \| `"sheriff"` \| `"city"` \| `"tribal"` \| `"state"` \| null | Present only when `mission` is `"police"`. `state` is an out-of-state state patrol on mutual aid. Null when the registry doesn't know the unit. |
| `lat`, `lon` | number \| null | Position at the event, 4 decimals. For a landing, the last airborne fix. |
| `alt_ft` | number \| null | Altitude in feet. |
| `corridor` | string \| null | Nearest named corridor and place ("I-5 · Fife"), else the region ("Puget Sound"), else null. |
| `ts_iso` | string | Event time, ISO 8601 UTC. |
| `url` | string | The bird's page. |
| `test` | `true` | Present only on a manage-page test send. |

Headers on every post:

| Header | Value |
|---|---|
| `X-SmokySignal-Event` | `takeoff`, `landing`, or `test` |
| `X-SmokySignal-Delivery` | Random UUID per post |
| `X-SmokySignal-Timestamp` | Unix seconds when the post was signed |
| `X-SmokySignal-Signature` | `v1=` + hex HMAC-SHA256 |

### Verify the signature

You get a signing secret (`whsec_...`) once, when the relay is created.
The signature is HMAC-SHA256 over `"{timestamp}.{raw body}"` with that
secret, hex-encoded, prefixed `v1=`. Check it against the raw request
body (before any JSON parsing), compare in constant time, and reject
timestamps more than 5 minutes off to blunt replays.

Node:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verify(secret, rawBody, headers) {
  const ts = headers["x-smokysignal-timestamp"];
  const sig = headers["x-smokysignal-signature"] ?? "";
  if (!/^\d+$/.test(ts ?? "")) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const want = createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  const got = sig.replace(/^v1=/, "");
  return got.length === want.length &&
    timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(want, "hex"));
}
```

Python:

```python
import hmac, hashlib, time

def verify(secret: str, raw_body: bytes, headers) -> bool:
    ts = headers.get("X-SmokySignal-Timestamp", "")
    sig = headers.get("X-SmokySignal-Signature", "")
    if not ts.isdigit() or abs(time.time() - int(ts)) > 300:
        return False
    want = hmac.new(secret.encode(), f"{ts}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, f"v1={want}")
```

Shell, to check by hand:

```sh
printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET"
```

Answer with any 2xx quickly (within 5 seconds). Non-2xx answers are not
retried, except a 429 with a short `retry_after`.

## 3. Feeds (zero setup)

| URL | Format | Contents |
|---|---|---|
| `/feed.xml` | Atom 1.0 | Last 100 takeoffs and landings, Smokey (police) only |
| `/rss.xml` | RSS 2.0 | Same |
| `/feed.xml?all=1`, `/rss.xml?all=1` | | Every mission, not just Smokey |

Entry titles read `Smokey 4 up · I-5 · Fife · 14:22 PT`. Each links to
the bird's page. Edge-cached for 60 seconds. Every page also advertises
the feeds with `<link rel="alternate">`, so most readers find them from
`https://smokysignal.app` alone.

### RSS bot in Discord, no webhook

If you'd rather not paste a webhook anywhere, an RSS bot does the job:

1. Invite an RSS bot to the server (MonitoRSS is a common one; any bot
   that reads Atom or RSS works).
2. Point it at `https://smokysignal.app/feed.xml` for the channel.
3. Expect a delay: bots poll on their own schedule, often every 10 to 20
   minutes. The webhook relay posts within a minute of the takeoff.

Slack, Teams, Feedly, and Inoreader can all read the same feed.

## 4. Phone: Siri and widgets

### Apple Shortcuts: "Hey Siri, is Smokey up"

Build it by hand in the Shortcuts app (there is no shared link to
install; that's on purpose, you can see every step):

1. Open **Shortcuts**, tap **+**, and name the shortcut **Is Smokey up**.
2. Add the action **Get Contents of URL**. Set the URL to
   `https://www.smokysignal.app/api/status.txt`. Method GET, no headers.
3. Add **Speak Text** and set its input to **Contents of URL**.
4. Done. Say "Hey Siri, is Smokey up". Siri reads the status back.

The first line of `status.txt` is `up`, `down`, or `stale`, followed by
`count=`, `fetched_at=` and `age_s=` lines. To hear only the first word,
put these between steps 2 and 3: **Split Text** by **New Lines**, then
**Get Item from List** (First Item), and speak that instead. `stale`
means the feed can't vouch for the read: treat it as unknown, not clear.

### Scriptable widget (iOS)

[`docs/widgets/scriptable-smokey.js`](widgets/scriptable-smokey.js) is a
complete small-widget script. Install Scriptable, paste the file into a
new script, then add a Scriptable widget to the home screen and pick the
script. It reads `/api/status.json` and shows "Smokey's up." in orange,
"Smokey's down." in green, or "No signal." when stale, with the count
and the read time in 24-hour PT.

### Android: KWGT or Tasker

- **KWGT**: add a Text item and set its formula to
  `$wg("https://smokysignal.app/api/status.json", json, .state)$`. Under
  the layer's settings, set the refresh to 5 minutes. Use a Global or a
  conditional colour on `$wg(..., json, .state)$ = up` for orange.
- **Tasker**: a Time profile every 5 minutes running an **HTTP Request**
  (GET `https://smokysignal.app/api/status.txt`), then **Variable Split**
  `%http_data` on a newline. `%http_data1` is `up`, `down`, or `stale`.
  Feed it to a **Notify**, **Say**, or a KWGT variable.

Poll no faster than once a minute; the read only changes that often.
