#!/bin/bash
# Install the SmokySignal pinger as a launchd agent on helm (macOS).
# Usage (on helm, from the repo):  ./scripts/helm-pinger/install.sh
# Reads CRON_SECRET from $CRON_SECRET, or prompts for it (input hidden).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
LABEL="app.smokysignal.pinger"
BIN="$HOME/.local/bin/smokysignal-ping.sh"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/.config/smokysignal" "$HOME/.local/bin" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
if [ -z "${CRON_SECRET:-}" ]; then read -rsp "CRON_SECRET (from Vercel → Settings → Environment Variables): " CRON_SECRET; echo; fi
umask 077; printf '%s' "$CRON_SECRET" >"$HOME/.config/smokysignal/cron-secret"
install -m 0755 "$DIR/ping.sh" "$BIN"
cat >"$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$BIN</string></array>
  <key>StartInterval</key><integer>30</integer>
  <key>RunAtLoad</key><true/>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
sleep 3; tail -n 2 "$HOME/Library/Logs/smokysignal-pinger.log" || true
echo "Installed. Uninstall: launchctl bootout gui/\$(id -u)/$LABEL && rm $PLIST"
