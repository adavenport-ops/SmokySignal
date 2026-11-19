// Telegram + Discord bot cards for /relay. Server component: it only
// ever receives booleans and public links (lib/bots/public-info.ts),
// never a token. Each card renders only when its bot is configured.

import { SS_TOKENS } from "@/lib/tokens";

type Props = {
  telegramEnabled: boolean;
  telegramUsername: string | null;
  discordInstallUrl: string | null;
};

const card: React.CSSProperties = {
  background: SS_TOKENS.bg1,
  border: `.5px solid ${SS_TOKENS.hairline}`,
  borderRadius: 14,
  padding: "14px 16px",
};

const h3: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: SS_TOKENS.fg0,
  letterSpacing: "-.01em",
  margin: 0,
  marginBottom: 6,
};

const body: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.5,
  color: SS_TOKENS.fg1,
  margin: 0,
};

const small: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.5,
  color: SS_TOKENS.fg2,
  margin: 0,
  marginTop: 8,
};

const link: React.CSSProperties = {
  color: SS_TOKENS.fg0,
  textDecoration: "underline",
  display: "inline-flex",
  alignItems: "center",
  minHeight: 44,
};

export function BotsCallout({ telegramEnabled, telegramUsername, discordInstallUrl }: Props) {
  if (!telegramEnabled && !discordInstallUrl) return null;
  return (
    <>
      {telegramEnabled ? (
        <section style={card} data-bot="telegram">
          <div className="ss-eyebrow" style={{ marginBottom: 8 }}>
            Telegram · read aloud
          </div>
          <h3 style={h3}>Ears on, hands on the bars.</h3>
          <p style={body}>
            DM the SmokySignal bot on Telegram and send{" "}
            <span className="ss-mono">/start</span>. When Smokey goes up it
            drops one short line in the chat: who, which corridor, how high,
            what time. CarPlay, Android Auto and most helmet intercoms read
            Telegram messages out loud, so the word reaches you without a
            glance at the phone. Say <span className="ss-mono">status</span>{" "}
            any time for the current read.
          </p>
          <p style={small}>
            <span className="ss-mono">/corridor I-5</span> narrows it.{" "}
            <span className="ss-mono">/quiet 22-06</span> holds it overnight.{" "}
            <span className="ss-mono">/stop</span> and the bot forgets the
            chat. It keeps your chat id and your filters, nothing else.
          </p>
          {telegramUsername ? (
            <p style={{ ...small, marginTop: 4 }}>
              <a
                href={`https://t.me/${telegramUsername}`}
                className="ss-mono"
                rel="noopener noreferrer"
                style={link}
              >
                @{telegramUsername}
              </a>
            </p>
          ) : null}
        </section>
      ) : null}
      {discordInstallUrl ? (
        <section style={card} data-bot="discord">
          <div className="ss-eyebrow" style={{ marginBottom: 8 }}>
            Discord · slash command
          </div>
          <h3 style={h3}>Put the bird in your server.</h3>
          <p style={body}>
            Type <span className="ss-mono">/smokey</span> in any channel for
            the live read: up or down, who is airborne, which corridor, what
            time. <span className="ss-mono">/smokey plane N305DK</span> pulls
            one tail and its last flight.
          </p>
          <p style={{ ...small, marginTop: 4 }}>
            <a
              href={discordInstallUrl}
              rel="noopener noreferrer"
              style={link}
              data-testid="discord-install"
            >
              Add to Discord
            </a>
          </p>
        </section>
      ) : null}
    </>
  );
}
