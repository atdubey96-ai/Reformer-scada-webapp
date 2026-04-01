#!/bin/bash

set -euo pipefail

DEMO_PID_FILE="/tmp/scada-demo-publisher.pid"

if [ -f "$DEMO_PID_FILE" ]; then
  PID="$(cat "$DEMO_PID_FILE")"
  if kill -0 "$PID" >/dev/null 2>&1; then
    kill "$PID" >/dev/null 2>&1 || true
    echo "Stopped demo publisher PID $PID."
  else
    echo "Demo publisher PID file was stale."
  fi
  rm -f "$DEMO_PID_FILE"
else
  echo "No demo publisher PID file was found."
fi
