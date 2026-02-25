#!/bin/bash

APP_DIR="/Users/ashutoshdubey/Documents/New project/webapp"
PORT="5500"

if [ ! -d "$APP_DIR" ]; then
  echo "Web app folder not found: $APP_DIR"
  read -r -p "Press Enter to close..."
  exit 1
fi

if lsof -iTCP:"$PORT" -sTCP:LISTEN -n -P >/dev/null 2>&1; then
  echo "Server already running on port $PORT."
  open "http://localhost:$PORT"
  read -r -p "Press Enter to close..."
  exit 0
fi

cd "$APP_DIR" || exit 1

echo "Starting SCADA web app on http://localhost:$PORT ..."
python3 -m http.server "$PORT" >/tmp/scada-webapp.log 2>&1 &
SERVER_PID=$!

sleep 1
open "http://localhost:$PORT"

echo "Server PID: $SERVER_PID"
echo "Log file: /tmp/scada-webapp.log"
echo ""
read -r -p "Press Enter to stop server and close..."

kill "$SERVER_PID" >/dev/null 2>&1 || true
exit 0
