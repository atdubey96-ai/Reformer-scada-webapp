#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$SCRIPT_DIR/webapp"
PORT="${PORT:-5500}"
EXCEL_FILE="$APP_DIR/Data_website2.xlsm"
LOG_FILE="/tmp/scada-webapp.log"
SERVER_PID=""

open_excel_file() {
  if [ ! -f "$EXCEL_FILE" ]; then
    echo "Excel workbook not found: $EXCEL_FILE"
    return 1
  fi

  if [ -d "/Applications/Microsoft Excel.app" ]; then
    open -a "Microsoft Excel" "$EXCEL_FILE"
  else
    open "$EXCEL_FILE"
  fi
}

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

if [ ! -d "$APP_DIR" ]; then
  echo "Web app folder not found: $APP_DIR"
  read -r -p "Press Enter to close..."
  exit 1
fi

if lsof -iTCP:"$PORT" -sTCP:LISTEN -n -P >/dev/null 2>&1; then
  echo "Server already running on port $PORT."
  open "http://localhost:$PORT"
  open_excel_file || true
  read -r -p "Press Enter to close..."
  exit 0
fi

cd "$APP_DIR" || exit 1

echo "Starting SCADA web app on http://localhost:$PORT ..."
python3 -m http.server "$PORT" >"$LOG_FILE" 2>&1 &
SERVER_PID=$!

sleep 1
open "http://localhost:$PORT"
open_excel_file || true

echo "Server PID: $SERVER_PID"
echo "Log file: $LOG_FILE"
echo "Excel file: $EXCEL_FILE"
echo ""
read -r -p "Press Enter to stop server and close..."

exit 0
