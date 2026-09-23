#!/usr/bin/env bash
# Production deploy for MarketingOS on the AWS VPS.
#
# GitHub Actions connects with a forced-command deploy key:
#   command="/home/ubuntu/apps/marketingos/scripts/deploy.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty
# Remote SSH arguments are ignored. This script always performs the deploy.
#
# Steps: git fetch origin; git checkout main; git reset --hard origin/main;
# npm ci; npm run db:migrate; npm run build; pm2 restart marketingos;
# then poll http://127.0.0.1:3021/api/health until HTTP 200.
#
# .env, .env.local, and the database are kept. This script never runs git clean.
# It aborts before any git update when both env files are missing.
# Nothing in this script prints env values or other secrets.
#
# The process re-execs from a temp copy first so `git reset --hard` can replace
# scripts/deploy.sh while bash is still running. The app root is resolved from
# the original path: APP_DIR=$(cd "$(dirname "$0")/.." && pwd).

set -euo pipefail

if [[ "${MARKETINGOS_DEPLOY_REEXEC:-}" != "1" ]]; then
  APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
  deploy_copy="$(mktemp /tmp/marketingos-deploy.XXXXXX.sh)"
  trap 'rm -f "$deploy_copy"' EXIT
  cp -- "$0" "$deploy_copy"
  chmod 700 "$deploy_copy"
  export MARKETINGOS_DEPLOY_REEXEC=1
  export MARKETINGOS_APP_DIR="$APP_DIR"
  exec bash "$deploy_copy"
fi

APP_DIR="${MARKETINGOS_APP_DIR:?}"
unset MARKETINGOS_DEPLOY_REEXEC MARKETINGOS_APP_DIR
cd "$APP_DIR"

HEALTH_URL="http://127.0.0.1:3021/api/health"
HEALTH_ATTEMPTS=30
HEALTH_INTERVAL_SECONDS=2
UNTRACKED_DEPLOY_BACKUP=""
DEPLOY_REPORTED=0

log() {
  printf '%s\n' "$*"
}

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  DEPLOY_REPORTED=1
  exit 1
}

# EXIT trap callback. Shellcheck cannot see this invocation.
# shellcheck disable=SC2317
on_exit() {
  local code=$?
  if [[ -n "$UNTRACKED_DEPLOY_BACKUP" && -f "$UNTRACKED_DEPLOY_BACKUP" ]]; then
    if [[ "$code" -ne 0 && ! -e "$APP_DIR/scripts/deploy.sh" ]]; then
      mv "$UNTRACKED_DEPLOY_BACKUP" "$APP_DIR/scripts/deploy.sh"
      chmod +x "$APP_DIR/scripts/deploy.sh" || true
      printf '%s\n' "FAIL: restored untracked scripts/deploy.sh after a deploy error" >&2
      DEPLOY_REPORTED=1
    else
      rm -f "$UNTRACKED_DEPLOY_BACKUP"
    fi
  fi
  if [[ "$code" -ne 0 && "$DEPLOY_REPORTED" -ne 1 ]]; then
    printf 'FAIL: deploy aborted (exit %s) HEAD %s\n' \
      "$code" "$(git -C "$APP_DIR" rev-parse HEAD 2>/dev/null || printf '%s' unknown)" >&2
  fi
  case "$0" in
    /tmp/marketingos-deploy.*) rm -f -- "$0" ;;
  esac
}
trap on_exit EXIT

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "required command not found: $1"
  fi
}

require_cmd git
require_cmd node
require_cmd npm
require_cmd pm2
require_cmd curl

if [[ ! -f .env && ! -f .env.local ]]; then
  fail "no .env or .env.local in ${APP_DIR}; aborting before git updates"
fi

log "Deploying MarketingOS in ${APP_DIR}"

export GIT_TERMINAL_PROMPT=0
git fetch origin

# An untracked scripts/deploy.sh (the bootstrap copy already on the VPS)
# makes `git reset --hard` refuse to check out the tracked file. Move it
# aside; this process is already running from the temp copy.
if [[ -f scripts/deploy.sh ]] && ! git ls-files --error-unmatch -- scripts/deploy.sh >/dev/null 2>&1; then
  UNTRACKED_DEPLOY_BACKUP="/tmp/marketingos-deploy.sh.untracked.$$"
  log "Moving untracked scripts/deploy.sh aside so the tracked copy can be checked out"
  mv scripts/deploy.sh "$UNTRACKED_DEPLOY_BACKUP"
fi

git checkout main
git reset --hard origin/main
chmod +x scripts/deploy.sh

sha="$(git rev-parse HEAD)"
log "HEAD ${sha}"

npm ci
npm run db:migrate
npm run build
pm2 restart marketingos

log "Waiting for ${HEALTH_URL}"
http_code="000"
attempt=1
while [[ "$attempt" -le "$HEALTH_ATTEMPTS" ]]; do
  http_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" || true)"
  if [[ -z "$http_code" ]]; then
    http_code="000"
  fi
  if [[ "$http_code" == "200" ]]; then
    log "SUCCESS: MarketingOS deployed at HEAD ${sha}"
    log "health ${HEALTH_URL} returned 200"
    exit 0
  fi
  log "health attempt ${attempt}/${HEALTH_ATTEMPTS}: HTTP ${http_code}"
  attempt=$((attempt + 1))
  if [[ "$attempt" -le "$HEALTH_ATTEMPTS" ]]; then
    sleep "$HEALTH_INTERVAL_SECONDS"
  fi
done

fail "health check did not return 200 at ${HEALTH_URL} (last HTTP ${http_code}) HEAD ${sha}"
