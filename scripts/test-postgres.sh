#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
project="survey-preflight-$(date +%s)-$$"
compose=(docker compose -p "$project" -f infra/compose.preflight.yaml)
cleanup() { "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT
"${compose[@]}" pull
"${compose[@]}" up -d --wait
"${compose[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U survey_preflight -d survey_preflight -c "CREATE TABLE smoke (id integer PRIMARY KEY, label text NOT NULL); INSERT INTO smoke VALUES (1, 'before_restart');"
"${compose[@]}" restart postgres
ready=0
for i in $(seq 1 30); do
  if "${compose[@]}" exec -T postgres pg_isready -U survey_preflight -d survey_preflight >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[ "$ready" = 1 ] || { echo 'POSTGRES_BLOCKED: restart readiness' >&2; exit 1; }
result=$("${compose[@]}" exec -T postgres psql -At -v ON_ERROR_STOP=1 -U survey_preflight -d survey_preflight -c 'SELECT label FROM smoke WHERE id=1;')
[ "$result" = 'before_restart' ] || { echo 'POSTGRES_BLOCKED: persistence assertion failed' >&2; exit 1; }
echo 'POSTGRES_RUNTIME_PASS: real SQL and restart persistence confirmed (disposable test data only)'
