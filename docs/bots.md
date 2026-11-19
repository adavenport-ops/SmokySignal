# Bots: Telegram, Discord, Bluesky

Three ways to hear about Smokey without opening the app. Each bot is off
until its env vars are set in Vercel. While a bot is off, its routes
answer `503 {"error":"not_configured"}` and the takeoff dispatcher skips
it without touching KV or the network. No accounts on our side.

| Bot | Env vars | Routes |
|---|---|---|
| Telegram | `TELEGRAM_BOT_TOKEN` | `POST /api/telegram/webhook`, `POST /api/admin/telegram/register` |
| Discord | `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN` | `POST /api/discord/interactions`, `POST /api/admin/discord/register` |
| Bluesky | `BSKY_HANDLE`, `BSKY_APP_PASSWORD` (optional `BSKY_SERVICE`, default `https://bsky.social`) | none (autopost only) |

Code: `lib/bots/*`. Takeoffs reach the bots through `dispatchBots()`,
called from `lib/activity.ts` in the same `waitUntil` as the web-push
dispatcher. KV keys are listed in `lib/storage-keys.ts` (`bots:*`).

All three need the Upstash KV binding (`KV_REST_API_URL`,
`KV_REST_API_TOKEN`) for subscribers, cooldowns and the Bluesky session.
Without KV, Telegram `/status` still answers but alerts are off.

## Telegram

The in-car path. Riders DM the bot; CarPlay (Siri), Android Auto (Google
Assistant) and most helmet intercoms read Telegram messages out loud.
Alerts are written for the ear:

> Smokey 4 up. I-5 near Fife. 2,600 feet. 14:22.

### Set up

1. In Telegram, message `@BotFather`, send `/newbot`, pick a name and a
   username. Copy the token.
2. Optional, in BotFather: `/setdescription`, `/setabouttext`,
   `/setuserpic`. Leave privacy mode on (the default): in a group the bot
   then only sees commands.
3. Vercel → Project → Settings → Environment Variables: add
   `TELEGRAM_BOT_TOKEN` (Production, mark it Sensitive). Redeploy.
4. Register the webhook and the command menu (see below).

The webhook secret is not an env var. It is derived from the token
(`HMAC-SHA256(token, "smokysignal:telegram-webhook:v1")`, hex), so
rotating the token rotates the secret. After a token rotation, run the
register step again.

### Register

Log in at `https://smokysignal.app/admin`, then in the browser console
on that tab:

```js
await (await fetch("/api/admin/telegram/register", { method: "POST" })).json()
```

This calls `setWebhook` with `url = <this origin>/api/telegram/webhook`,
the derived `secret_token`, `allowed_updates: ["message"]`, then
`setMyCommands`. Run it on the production host: the webhook URL is the
origin you call it from. Expect `{"ok": true, ...}`.

### Commands

| Command | Does |
|---|---|
| `/start` | Subscribe. Default: Smokey (police) takeoffs, all of Washington. |
| `/stop` | Unsubscribe and delete the record. |
| `/status`, or plain text `status` / `is smokey up` | Current status, one spoken sentence. |
| `/corridor I-5, I-405` | Only takeoffs within 5 nm of these corridors. Fuzzy: `5`, `i5`, `sr 167`, `hood canal`. `/corridor any` clears. |
| `/region puget_sound` | One region (`puget_sound`, `north_sound`, `olympic`, `sw_wa`, `central_wa`, `east_wa`), or `all`. |
| `/quiet 22-06` | Quiet hours, Pacific time. `/quiet off` clears. |
| `/missions police wildfire` | Which missions ping. Aliases: `smokey`, `federal`, `rescue`, `fire`, `medical`, `survey`, `transport`, `unknown`, `all`. |
| `/settings` | Read back the filters. |
| `/help` | The list. |

Replies ride back in the webhook response (`method: "sendMessage"`), so
a command costs no outbound call. Per-chat limit: 20 commands a minute.

### Delivery

- One alert per (chat, tail) per 20 minutes, claimed atomically with
  `SET NX EX` before the send and released if the send does not land.
- Rolling pool of 8, paced to about 25 messages a second, 8 s timeout per
  call, 24 s overall deadline (inside the 30 s function ceiling).
- A 429 pauses every worker for `retry_after` and retries once when the
  wait is 5 s or less. A 403 (bot blocked) or 400 "chat not found"
  prunes the subscriber.
- Cap: 20,000 subscribers. Past it, `/start` answers that the channel is
  full.
- Throughput note: at 25 messages a second the 24 s deadline delivers
  about 600 alerts per takeoff. Riders past that are skipped for that
  takeoff. If the list grows past a few hundred active riders, move the
  fan-out to a queue.

## Discord

A `/smokey` slash command for servers.

- `/smokey`: embed with status, the airborne Smokeys (tail, corridor,
  altitude) and the time. Orange `#FF7A1A` only when Smokey is up, green
  when nothing is, grey when the feed is quiet. Visible to the channel.
- `/smokey plane:N305DK`: that tail, whether it is up, and its last
  flight, linking to `/plane/N305DK`.
- `allowed_mentions` is always `{"parse": []}`: nothing in a reply can
  ping anyone.

### Set up

1. https://discord.com/developers/applications → New Application.
2. General Information: copy the Application ID and the Public Key.
3. Bot: Reset Token, copy it. No privileged intents needed.
4. Vercel env vars (Production): `DISCORD_APPLICATION_ID`,
   `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN` (Sensitive). Redeploy.
5. Register (below), then set the Interactions Endpoint URL.

### Register

Logged in at `/admin`, in the console:

```js
await (await fetch("/api/admin/discord/register?set_endpoint=1", { method: "POST" })).json()
```

This bulk-overwrites the global command set
(`PUT /applications/{id}/commands`) with `/smokey`, then sets the
Interactions Endpoint URL to `<this origin>/api/discord/interactions`.
Discord sends a signed PING to the URL before saving it, so the deploy
with the env vars must be live first. Without `?set_endpoint=1`, paste
the returned `interactions_endpoint_url` into General Information →
Interactions Endpoint URL by hand. Global commands can take a few
minutes to show up in clients.

The endpoint verifies `X-Signature-Ed25519` over
`X-Signature-Timestamp + raw body` with the public key (node:crypto) and
answers 401 to anything that fails. Discord probes with bad signatures
on purpose; a 401 is what keeps the endpoint registered.

### Install link

When `DISCORD_APPLICATION_ID` is set, `/relay` shows "Add to Discord" (and a Telegram card when `TELEGRAM_BOT_TOKEN` is set):
`https://discord.com/oauth2/authorize?client_id=<id>&scope=applications.commands+bot&permissions=0`.
The page only receives the public application id; the key and token stay
on the server.

## Bluesky

Autopost on each Smokey (police) takeoff:

> Smokey 4 up · I-5 · Fife · 14:22 PT
> smokysignal.app/plane/N305DK

with the live status share card (the `/opengraph-image` card, rendered
in-process so it matches the takeoff, not a 60 s CDN copy) as the image,
and a link facet over the plane URL. Facet offsets are UTF-8 bytes.

- Global cooldown: one post per tail per 30 minutes.
- Hard cap: 30 posts per Pacific day.
- Both guards fail closed: on a KV error nothing posts.
- Session: `com.atproto.server.createSession` once, cached in KV
  (`bots:bsky:session`), refreshed with `refreshSession` when the access
  JWT has under 5 minutes left. A 401 / `ExpiredToken` forces one refresh
  and retry.
- Mutual-aid police only post while inside Washington airspace, same as
  push and the status pill.

### Set up

1. Create the account (for example `smokysignal.app` as a domain handle).
2. Settings → Privacy and security → App passwords → Add. Do not use the
   account password.
3. Vercel env vars: `BSKY_HANDLE` (the handle, no `@`) and
   `BSKY_APP_PASSWORD` (Sensitive). Optional `BSKY_SERVICE` if the
   account lives on a PDS other than bsky.social. Redeploy.

Nothing to register. The next Smokey takeoff posts.

## Privacy

- Telegram: we store the chat id and the filters (missions, corridors,
  region, quiet hours). A chat id is treated like a push endpoint:
  PII-equivalent. KV keys carry a SHA-256 hash of it
  (`bots:tg:sub:{hash}`); the raw id lives only inside the record,
  because sending needs it. No names, usernames, phone numbers or message
  history are stored. `/stop` deletes the record; a blocked bot prunes it.
- Discord: nothing is stored. The command reads the public snapshot.
- Bluesky: we post public aircraft data only. The session JWTs are cached
  in KV; the app password stays in Vercel env.
- Location: the bots never ask for or store a rider's location.

## Verification

- `npm test` covers command parsing, the spoken formatter, Discord
  signature checks and embeds, Bluesky facets, the cooldowns and the env
  gate (`lib/bots/*.test.ts`).
- `npm run verify-prod` assertion 48: both interaction routes answer 401
  to an unsigned POST, or 503 `not_configured` while the env vars are
  unset, never 500.
