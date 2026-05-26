#!/usr/bin/env bash
# fetch-threat.sh — Cascaded fetch for OWASP AI Exchange threat content.
#
# Usage:   ./fetch-threat.sh <slug>
# Output:  JSON to stdout: { slug, url, title, content_md, source, fetched_at }
# Exit codes:
#   0 — success (check `source` field for live|cache|snapshot)
#   1 — slug not in taxonomy index
#   2 — all sources exhausted (live fail + no snapshot)
#   3 — invalid invocation

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INDEX="$REPO_ROOT/reference/taxonomy-index.json"
SNAPSHOT_DIR="$REPO_ROOT/reference/snapshot"
CACHE_DIR="${OWASP_AI_AUDIT_CACHE:-$HOME/.cache/owasp-ai-audit}"
CACHE_TTL_SECONDS=$((7 * 24 * 60 * 60))  # 7 days

if [[ $# -lt 1 ]]; then
  echo "usage: fetch-threat.sh <slug>" >&2
  exit 3
fi

SLUG="$1"

# Resolve slug → url + title from taxonomy index
URL=$(jq -r --arg s "$SLUG" '.threats[] | select(.slug == $s) | .url' "$INDEX" 2>/dev/null || true)
TITLE=$(jq -r --arg s "$SLUG" '.threats[] | select(.slug == $s) | .title' "$INDEX" 2>/dev/null || true)

if [[ -z "$URL" || "$URL" == "null" ]]; then
  # Maybe it's a control, not a threat
  URL=$(jq -r --arg s "$SLUG" '.controls[] | select(.slug == $s) | .url' "$INDEX" 2>/dev/null || true)
  TITLE=$(jq -r --arg s "$SLUG" '.controls[] | select(.slug == $s) | .title' "$INDEX" 2>/dev/null || true)
fi

if [[ -z "$URL" || "$URL" == "null" ]]; then
  echo "{\"error\":\"slug not in taxonomy index\",\"slug\":\"$SLUG\"}" >&2
  exit 1
fi

mkdir -p "$CACHE_DIR"
CACHE_FILE="$CACHE_DIR/${SLUG}.json"

now_epoch() { date -u +%s; }
iso_now() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

emit() {
  local source="$1"
  local content_md="$2"
  local etag="${3:-}"
  jq -n \
    --arg slug "$SLUG" \
    --arg url "$URL" \
    --arg title "$TITLE" \
    --arg content_md "$content_md" \
    --arg source "$source" \
    --arg fetched_at "$(iso_now)" \
    --arg etag "$etag" \
    '{slug:$slug, url:$url, title:$title, content_md:$content_md, source:$source, fetched_at:$fetched_at, etag:$etag}'
}

# --- Layer 1: Disk cache, if fresh ---
if [[ -f "$CACHE_FILE" ]]; then
  CACHED_AT=$(jq -r '.fetched_at_epoch // 0' "$CACHE_FILE" 2>/dev/null || echo 0)
  AGE=$(( $(now_epoch) - CACHED_AT ))
  if [[ $AGE -lt $CACHE_TTL_SECONDS ]]; then
    CONTENT=$(jq -r '.content_md' "$CACHE_FILE")
    ETAG=$(jq -r '.etag // ""' "$CACHE_FILE")
    emit "cache" "$CONTENT" "$ETAG"
    exit 0
  fi
fi

# --- Layer 2: Live fetch (with conditional GET if we have an ETag) ---
HEADERS_FILE=$(mktemp)
BODY_FILE=$(mktemp)
trap 'rm -f "$HEADERS_FILE" "$BODY_FILE"' EXIT

CURL_OPTS=(--silent --show-error --location --max-time 15
           --user-agent "owasp-ai-audit/0.1 (+https://github.com/aydinfer/owasp-ai-audit)"
           --dump-header "$HEADERS_FILE"
           --output "$BODY_FILE")

if [[ -f "$CACHE_FILE" ]]; then
  PREV_ETAG=$(jq -r '.etag // ""' "$CACHE_FILE")
  if [[ -n "$PREV_ETAG" ]]; then
    CURL_OPTS+=(--header "If-None-Match: $PREV_ETAG")
  fi
fi

if HTTP_CODE=$(curl "${CURL_OPTS[@]}" --write-out "%{http_code}" "$URL" 2>/dev/null); then
  if [[ "$HTTP_CODE" == "304" && -f "$CACHE_FILE" ]]; then
    # Not modified — refresh timestamp, return cached
    CONTENT=$(jq -r '.content_md' "$CACHE_FILE")
    ETAG=$(jq -r '.etag // ""' "$CACHE_FILE")
    jq --arg fa "$(now_epoch)" '.fetched_at_epoch=($fa|tonumber)' "$CACHE_FILE" > "$CACHE_FILE.tmp" && mv "$CACHE_FILE.tmp" "$CACHE_FILE"
    emit "cache" "$CONTENT" "$ETAG"
    exit 0
  elif [[ "$HTTP_CODE" =~ ^2 ]]; then
    # Success — extract markdown-ish content from HTML.
    # Strip HTML tags and collapse whitespace. Crude but deterministic.
    CONTENT=$(sed -e 's/<script[^>]*>.*<\/script>//gI' \
                   -e 's/<style[^>]*>.*<\/style>//gI' \
                   -e 's/<[^>]*>//g' \
                   -e 's/&nbsp;/ /g' -e 's/&amp;/\&/g' -e 's/&lt;/</g' -e 's/&gt;/>/g' \
                   "$BODY_FILE" | tr -s '[:space:]' ' ' | sed 's/^ //;s/ $//')
    NEW_ETAG=$(grep -i '^etag:' "$HEADERS_FILE" | head -1 | sed 's/^[Ee][Tt][Aa][Gg]: *//; s/\r$//')
    # Write cache
    jq -n \
      --arg slug "$SLUG" \
      --arg url "$URL" \
      --arg title "$TITLE" \
      --arg content_md "$CONTENT" \
      --arg etag "$NEW_ETAG" \
      --arg fa "$(now_epoch)" \
      '{slug:$slug, url:$url, title:$title, content_md:$content_md, etag:$etag, fetched_at_epoch:($fa|tonumber)}' \
      > "$CACHE_FILE"
    emit "live" "$CONTENT" "$NEW_ETAG"
    exit 0
  fi
fi

# --- Layer 3: Bundled snapshot ---
SNAPSHOT_FILE="$SNAPSHOT_DIR/${SLUG}.json"
if [[ -f "$SNAPSHOT_FILE" ]]; then
  CONTENT=$(jq -r '.content_md' "$SNAPSHOT_FILE")
  emit "snapshot" "$CONTENT" ""
  exit 0
fi

# --- Hard fail ---
echo "{\"error\":\"all sources exhausted\",\"slug\":\"$SLUG\",\"url\":\"$URL\"}" >&2
exit 2
