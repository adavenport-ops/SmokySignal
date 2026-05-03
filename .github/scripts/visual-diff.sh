#!/usr/bin/env bash
# Walk two parallel sweep directories and emit a diff summary in JSON
# on stdout. Uses ImageMagick's compare metric AE (absolute error —
# count of differing pixels) and `identify` for total pixel count.
#
# Usage: visual-diff.sh <baseline-dir> <current-dir>
#
# Both dirs are expected to be `out/persona-walks/<stamp>/` shaped:
#   <stamp>/<persona>/<route>.png
#
# Threshold: route flagged as "changed" when diff ratio > 0.05 (5%).

set -euo pipefail

BASELINE_DIR="${1:?usage: visual-diff.sh <baseline-dir> <current-dir>}"
CURRENT_DIR="${2:?usage: visual-diff.sh <baseline-dir> <current-dir>}"
THRESHOLD="${VISUAL_DIFF_THRESHOLD:-0.05}"

results_file=$(mktemp)
echo "[]" > "$results_file"

walk() {
  local current_png base persona route ratio diff total
  while IFS= read -r -d '' current_png; do
    persona=$(basename "$(dirname "$current_png")")
    route=$(basename "$current_png" .png)
    base="$BASELINE_DIR/$persona/$route.png"

    if [ ! -f "$base" ]; then
      jq --arg p "$persona" --arg r "$route" \
        '. + [{persona:$p, route:$r, status:"new"}]' \
        "$results_file" > "$results_file.tmp" && mv "$results_file.tmp" "$results_file"
      continue
    fi

    total=$(identify -format "%[fx:w*h]" "$current_png" 2>/dev/null || echo 0)
    [ "$total" = "0" ] && continue
    diff=$(compare -metric AE "$current_png" "$base" /dev/null 2>&1 || true)
    diff="${diff%% *}"
    [[ "$diff" =~ ^[0-9]+$ ]] || diff=0
    ratio=$(awk "BEGIN{ printf \"%.4f\", $diff / $total }")

    if awk "BEGIN{ exit !($ratio > $THRESHOLD) }"; then
      status="changed"
    else
      status="ok"
    fi

    jq --arg p "$persona" --arg r "$route" --arg s "$status" \
       --argjson diff "$diff" --argjson total "$total" --argjson ratio "$ratio" \
      '. + [{persona:$p, route:$r, status:$s, diff_pixels:$diff, total:$total, ratio:$ratio}]' \
      "$results_file" > "$results_file.tmp" && mv "$results_file.tmp" "$results_file"
  done < <(find "$CURRENT_DIR" -mindepth 2 -maxdepth 2 -name '*.png' -print0)
}

walk
cat "$results_file"
rm -f "$results_file"
