#!/bin/bash
# SmokySignal snapshot pinger. launchd runs this every 30s on helm.
# Hits the refresh-snapshot cron route so tracks, activity and takeoff
# pushes keep flowing with zero rider traffic (Vercel Hobby crons are
# daily only). Secret lives in ~/.config/smokysignal/cron-secret (0600).
set -u
SECRET_FILE="$HOME/.config/smokysignal/cron-secret"
URL="${SS_REFRESH_URL:-https://www.smokysignal.app/api/cron/refresh-snapshot}"
LOG="$HOME/Library/Logs/smokysignal-pinger.log"
[ -r "$SECRET_FILE" ] || { echo "$(date -u +%FT%TZ) missing $SECRET_FILE" >>"$LOG"; exit 1; }
SECRET=$(tr -d '\n' <"$SECRET_FILE")
OUT=$(curl -sS -m 25 -w ' http=%{http_code}' -H "Authorization: Bearer $SECRET" "$URL" 2>&1)
echo "$(date -u +%FT%TZ) $OUT" >>"$LOG"
# Keep the log bounded (~2 days at 30s).
if [ "$(wc -l <"$LOG")" -gt 6000 ]; then tail -n 3000 "$LOG" >"$LOG.tmp" && mv "$LOG.tmp" "$LOG"; fi
