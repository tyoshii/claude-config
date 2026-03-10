#!/bin/bash
set -euo pipefail

# ── Read stdin JSON ──────────────────────────────────────────────
INPUT=$(cat)
# Debug: uncomment to inspect stdin
# echo "$INPUT" > /tmp/claude-statusline-debug.json

# ── Extract stdin fields ─────────────────────────────────────────
MODEL_NAME=$(echo "$INPUT" | jq -r '
  (.model.display_name // .model // "Unknown")
' 2>/dev/null || echo "Unknown")

CONTEXT_PCT=$(echo "$INPUT" | jq -r '
  (.context_window.used_percentage // .context.used_percentage // 0)
' 2>/dev/null || echo "0")
CONTEXT_PCT=$(printf "%.0f" "$CONTEXT_PCT" 2>/dev/null || echo "0")

WORK_DIR=$(echo "$INPUT" | jq -r '
  (.workspace.current_dir // .workingDir // .projectDir // ".")
' 2>/dev/null || echo ".")

# ── Git info ─────────────────────────────────────────────────────
GIT_BRANCH=""
GIT_ADDS=0
GIT_DELS=0
IS_WORKTREE=false

if git -C "$WORK_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  GIT_BRANCH=$(git -C "$WORK_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

  # Detect worktree: git-dir differs from git-common-dir in a worktree
  GIT_DIR=$(git -C "$WORK_DIR" rev-parse --git-dir 2>/dev/null || echo "")
  GIT_COMMON_DIR=$(git -C "$WORK_DIR" rev-parse --git-common-dir 2>/dev/null || echo "")
  if [ -n "$GIT_DIR" ] && [ -n "$GIT_COMMON_DIR" ] && [ "$GIT_DIR" != "$GIT_COMMON_DIR" ]; then
    IS_WORKTREE=true
  fi

  # Count additions/deletions (staged + unstaged vs HEAD)
  DIFF_STAT=$(git -C "$WORK_DIR" diff HEAD --numstat 2>/dev/null || true)
  if [ -n "$DIFF_STAT" ]; then
    GIT_ADDS=$(echo "$DIFF_STAT" | awk '{s+=$1} END{print s+0}')
    GIT_DELS=$(echo "$DIFF_STAT" | awk '{s+=$2} END{print s+0}')
  fi
fi

# ── Active dev server ports ──────────────────────────────────────
ACTIVE_PORTS=""
if git -C "$WORK_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  MAIN_REPO=$(git -C "$WORK_DIR" rev-parse --path-format=absolute --git-common-dir 2>/dev/null | sed 's/\/\.git$//')
  if [ -n "$MAIN_REPO" ]; then
    ENCODED_PATH=$(echo "$MAIN_REPO" | sed 's/\//-/g')
    DEV_SERVER_YML="$HOME/.claude/projects/${ENCODED_PATH}/dev-server.yml"
    if [ -f "$DEV_SERVER_YML" ]; then
      # Parse branch:port pairs from YAML and check if port is alive
      CURRENT_BRANCH=""
      CURRENT_PORT=""
      while IFS= read -r line; do
        # Match branch line (e.g. "  main:" or "  team/firebase-auth:")
        if echo "$line" | grep -qE '^  [^ ].*:$'; then
          CURRENT_BRANCH=$(echo "$line" | sed 's/^  //;s/:$//')
        fi
        # Match port line (e.g. "    port: 8085")
        if echo "$line" | grep -qE '^    port:'; then
          CURRENT_PORT=$(echo "$line" | awk '{print $2}')
          if [ -n "$CURRENT_PORT" ] && lsof -i :"$CURRENT_PORT" -t >/dev/null 2>&1; then
            if [ -n "$ACTIVE_PORTS" ]; then
              ACTIVE_PORTS+=", "
            fi
            ACTIVE_PORTS+="${CURRENT_BRANCH}→:${CURRENT_PORT}"
          fi
        fi
      done < "$DEV_SERVER_YML"
    fi
  fi
fi

# ── Rate limit usage (cached) ───────────────────────────────────
CACHE_FILE="/tmp/claude-usage-cache.json"
CACHE_TTL=360

fetch_usage() {
  local creds token resp
  creds=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null || echo "")
  if [ -z "$creds" ]; then
    echo '{"five_hour":{"utilization":0,"resets_at":""},"seven_day":{"utilization":0,"resets_at":""}}'
    return
  fi
  token=$(echo "$creds" | jq -r '.claudeAiOauth.accessToken // empty' 2>/dev/null || echo "")
  if [ -z "$token" ]; then
    echo '{"five_hour":{"utilization":0,"resets_at":""},"seven_day":{"utilization":0,"resets_at":""}}'
    return
  fi
  resp=$(curl -s --max-time 5 \
    -H "Authorization: Bearer $token" \
    -H "anthropic-beta: oauth-2025-04-20" \
    -H "Content-Type: application/json" \
    "https://api.anthropic.com/api/oauth/usage" 2>/dev/null || echo "")
  if echo "$resp" | jq -e '.five_hour' >/dev/null 2>&1; then
    echo "$resp"
  else
    echo '{"five_hour":{"utilization":0,"resets_at":""},"seven_day":{"utilization":0,"resets_at":""}}'
  fi
}

USAGE_JSON=""
if [ -f "$CACHE_FILE" ]; then
  CACHE_MTIME=$(stat -f %m "$CACHE_FILE" 2>/dev/null || echo "0")
  NOW=$(date +%s)
  CACHE_AGE=$(( NOW - CACHE_MTIME ))
  if [ "$CACHE_AGE" -lt "$CACHE_TTL" ]; then
    USAGE_JSON=$(cat "$CACHE_FILE" 2>/dev/null || echo "")
  fi
fi

if [ -z "$USAGE_JSON" ] || ! echo "$USAGE_JSON" | jq -e '.five_hour' >/dev/null 2>&1; then
  USAGE_JSON=$(fetch_usage)
  echo "$USAGE_JSON" > "$CACHE_FILE" 2>/dev/null || true
fi

FIVE_HOUR_PCT=$(echo "$USAGE_JSON" | jq -r '.five_hour.utilization // 0' 2>/dev/null || echo "0")
FIVE_HOUR_PCT=$(printf "%.0f" "$FIVE_HOUR_PCT" 2>/dev/null || echo "0")
FIVE_HOUR_RESET=$(echo "$USAGE_JSON" | jq -r '.five_hour.resets_at // ""' 2>/dev/null || echo "")

SEVEN_DAY_PCT=$(echo "$USAGE_JSON" | jq -r '.seven_day.utilization // 0' 2>/dev/null || echo "0")
SEVEN_DAY_PCT=$(printf "%.0f" "$SEVEN_DAY_PCT" 2>/dev/null || echo "0")
SEVEN_DAY_RESET=$(echo "$USAGE_JSON" | jq -r '.seven_day.resets_at // ""' 2>/dev/null || echo "")

# ── Format reset times (UTC → Asia/Tokyo) ────────────────────────
# API returns ISO8601 with timezone (e.g. 2026-03-05T00:59:59.846525+00:00)
# macOS date -jf needs +0000 format (no colon in tz offset)
format_reset_time() {
  local iso="$1" fmt="$2"
  if [ -z "$iso" ] || [ "$iso" = "null" ]; then echo "N/A"; return; fi
  # Remove fractional seconds, convert +00:00 → +0000
  local clean
  clean=$(echo "$iso" | sed 's/\.[0-9]*//' | sed 's/\([+-][0-9][0-9]\):\([0-9][0-9]\)$/\1\2/')
  TZ=Asia/Tokyo date -jf "%Y-%m-%dT%H:%M:%S%z" "$clean" "+$fmt" 2>/dev/null \
    | sed 's/AM/am/;s/PM/pm/' || echo "N/A"
}

FIVE_RESET_STR=$(format_reset_time "$FIVE_HOUR_RESET" "%-l%p")
SEVEN_RESET_STR=$(format_reset_time "$SEVEN_DAY_RESET" "%b %-d at %-l%p")

# ── ANSI color helpers ───────────────────────────────────────────
C_GREEN="\033[38;2;151;201;195m"
C_YELLOW="\033[38;2;229;192;123m"
C_RED="\033[38;2;224;108;117m"
C_GRAY="\033[38;2;74;88;92m"
C_DIM="\033[38;2;58;68;72m"
C_LABEL="\033[38;2;140;150;155m"
C_RESET="\033[0m"

color_for_pct() {
  local pct=$1
  if [ "$pct" -ge 80 ]; then
    echo "$C_RED"
  elif [ "$pct" -ge 50 ]; then
    echo "$C_YELLOW"
  else
    echo "$C_GREEN"
  fi
}

# ── Progress bar (10 segments, colored) ──────────────────────────
progress_bar() {
  local pct=$1 color=$2
  local filled=$(( pct / 10 ))
  if [ "$filled" -gt 10 ]; then filled=10; fi
  local empty=$(( 10 - filled ))
  local bar="${color}"
  for ((i=0; i<filled; i++)); do bar+="▰"; done
  bar+="${C_DIM}"
  for ((i=0; i<empty; i++)); do bar+="▱"; done
  bar+="${C_RESET}"
  echo "$bar"
}

# ── Build output ─────────────────────────────────────────────────
SEP="${C_GRAY} │ ${C_RESET}"

# Line 1: model | context | changes | branch
CTX_COLOR=$(color_for_pct "$CONTEXT_PCT")
LINE1="\xF0\x9F\xA4\x96 ${MODEL_NAME}${SEP}${CTX_COLOR}\xF0\x9F\x93\x8A ${CONTEXT_PCT}%${C_RESET}${SEP}\xE2\x9C\x8F\xEF\xB8\x8F  ${C_GREEN}+${GIT_ADDS}${C_RESET}${C_GRAY}/${C_RESET}${C_RED}-${GIT_DELS}${C_RESET}"
if [ -n "$GIT_BRANCH" ]; then
  if [ "$IS_WORKTREE" = true ]; then
    LINE1+="${SEP}\xF0\x9F\x8C\xB3 ${C_YELLOW}[worktree]${C_RESET} ${GIT_BRANCH}"
  else
    LINE1+="${SEP}\xF0\x9F\x94\x80 ${GIT_BRANCH}"
  fi
fi

# Line 2: Active dev server ports
LINE2=""
if [ -n "$ACTIVE_PORTS" ]; then
  LINE2="\xF0\x9F\x96\xA5\xEF\xB8\x8F  ${C_LABEL}${ACTIVE_PORTS}${C_RESET}"
fi

# Line 3: 5-hour rate limit
FIVE_COLOR=$(color_for_pct "$FIVE_HOUR_PCT")
FIVE_BAR=$(progress_bar "$FIVE_HOUR_PCT" "$FIVE_COLOR")
LINE3="\xE2\x8F\xB1\xEF\xB8\x8F ${FIVE_COLOR}5h${C_RESET}  ${FIVE_BAR}  ${FIVE_COLOR}${FIVE_HOUR_PCT}%${C_RESET}  ${C_LABEL}Resets ${FIVE_RESET_STR} (Asia/Tokyo)${C_RESET}"

# Line 4: 7-day rate limit
SEVEN_COLOR=$(color_for_pct "$SEVEN_DAY_PCT")
SEVEN_BAR=$(progress_bar "$SEVEN_DAY_PCT" "$SEVEN_COLOR")
LINE4="\xF0\x9F\x97\x93\xEF\xB8\x8F ${SEVEN_COLOR}7d${C_RESET}  ${SEVEN_BAR}  ${SEVEN_COLOR}${SEVEN_DAY_PCT}%${C_RESET}  ${C_LABEL}Resets ${SEVEN_RESET_STR} (Asia/Tokyo)${C_RESET}"

if [ -n "$LINE2" ]; then
  printf "%b\n%b\n%b\n%b\n" "$LINE1" "$LINE2" "$LINE3" "$LINE4"
else
  printf "%b\n%b\n%b\n" "$LINE1" "$LINE3" "$LINE4"
fi
