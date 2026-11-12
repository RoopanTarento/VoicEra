#!/usr/bin/env bash
# Start, stop or check the local persistent VoicEra backend (no Docker):
# MongoDB from ~/.voicera/mongodb (data in ~/.voicera/data/db) plus the API,
# campaign worker and orchestrator (scripts/secure/run_local_backend.py).
#
#   scripts/secure/local-backend.sh start | stop | status | logs
#
# Reads MONGODB_PORT from .env. Logs go to ~/.voicera/logs/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VOICERA_HOME="${VOICERA_HOME:-$HOME/.voicera}"
MONGOD="$VOICERA_HOME/mongodb/bin/mongod"
LOGS="$VOICERA_HOME/logs"
PORT="$(grep -E '^MONGODB_PORT=' "$ROOT/.env" | cut -d= -f2)"
PORT="${PORT:-27017}"
API_PORT="${LOCAL_API_PORT:-8000}"

pid_on() { lsof -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null || true; }

wait_for() {
  for _ in $(seq 1 60); do
    [ -n "$(pid_on "$1")" ] && return 0
    sleep 0.5
  done
  return 1
}

start() {
  mkdir -p "$VOICERA_HOME/data/db" "$LOGS"
  if [ -z "$(pid_on "$PORT")" ]; then
    [ -x "$MONGOD" ] || { echo "MongoDB not found at $MONGOD"; exit 1; }
    nohup "$MONGOD" --dbpath "$VOICERA_HOME/data/db" --port "$PORT" --bind_ip 127.0.0.1 \
      --logpath "$LOGS/mongod.log" --logappend >/dev/null 2>&1 &
    wait_for "$PORT" || { echo "MongoDB did not start; see $LOGS/mongod.log"; exit 1; }
    echo "MongoDB started on 127.0.0.1:$PORT"
  else
    echo "MongoDB already running on 127.0.0.1:$PORT"
  fi
  if [ -z "$(pid_on "$API_PORT")" ]; then
    (cd "$ROOT" && PYTHONPATH="$ROOT:$ROOT/apps/api" nohup .venv/bin/python scripts/secure/run_local_backend.py \
      >"$LOGS/backend.log" 2>&1 &)
    wait_for "$API_PORT" || { echo "Backend did not start; see $LOGS/backend.log"; exit 1; }
    echo "Backend started: http://127.0.0.1:$API_PORT/docs (dashboard: http://localhost:3000)"
  else
    echo "Something is already listening on port $API_PORT"
  fi
}

stop() {
  local api mongo
  api="$(pid_on "$API_PORT")"
  [ -n "$api" ] && kill $api && echo "Backend stopped"
  mongo="$(pid_on "$PORT")"
  [ -n "$mongo" ] && kill $mongo && echo "MongoDB stopped (data kept in $VOICERA_HOME/data/db)"
  return 0
}

status() {
  [ -n "$(pid_on "$PORT")" ] && echo "MongoDB:  running on 127.0.0.1:$PORT" || echo "MongoDB:  stopped"
  if curl -sf "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1; then
    echo "Backend:  running, $(curl -s "http://127.0.0.1:$API_PORT/health")"
  else
    echo "Backend:  stopped"
  fi
}

case "${1:-status}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  logs) tail -n 50 -f "$LOGS/backend.log" ;;
  *) echo "usage: $0 start|stop|status|logs"; exit 2 ;;
esac
