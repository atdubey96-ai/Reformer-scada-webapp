#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEMO_LOG_FILE="/tmp/scada-demo-publisher.log"
DEMO_PID_FILE="/tmp/scada-demo-publisher.pid"
HELPER_LOG_FILE="/tmp/scada-excel-helper.log"
HELPER_PORT="${SCADA_HELPER_PORT:-8766}"

echo "Preparing demo workbook..."
python3 "$SCRIPT_DIR/scripts/demo/generate_demo_workbook.py"

if ! lsof -iTCP:"$HELPER_PORT" -sTCP:LISTEN -n -P >/dev/null 2>&1; then
  if command -v node >/dev/null 2>&1; then
    echo "Starting Excel helper on http://127.0.0.1:$HELPER_PORT ..."
    SCADA_HELPER_PORT="$HELPER_PORT" node "$SCRIPT_DIR/excel-launch-helper.js" >"$HELPER_LOG_FILE" 2>&1 &
    sleep 1
  else
    echo "Node.js not found. The browser toggle will still work, but the Open demo Excel button will not auto-launch the workbook."
  fi
fi

if [ -f "$DEMO_PID_FILE" ] && kill -0 "$(cat "$DEMO_PID_FILE")" >/dev/null 2>&1; then
  echo "Demo publisher is already running with PID $(cat "$DEMO_PID_FILE")."
else
  echo "Starting demo publisher..."
  nohup node "$SCRIPT_DIR/scripts/demo/demo-publisher.js" >>"$DEMO_LOG_FILE" 2>&1 &
  echo $! >"$DEMO_PID_FILE"
  sleep 1
fi

if [ -f "$SCRIPT_DIR/webapp/Data_website_demo.xlsx" ]; then
  open -a "Microsoft Excel" "$SCRIPT_DIR/webapp/Data_website_demo.xlsx" >/dev/null 2>&1 || open "$SCRIPT_DIR/webapp/Data_website_demo.xlsx" >/dev/null 2>&1 || true
fi

echo ""
echo "Demo mode is running."
echo "Website toggle: switch Plant Source to Demo."
echo "Publisher log: $DEMO_LOG_FILE"
echo "Helper log: $HELPER_LOG_FILE"
echo "Stop script: $SCRIPT_DIR/stop_demo_mode.command"
echo ""
read -r -p "Press Enter to close..."
