#!/bin/zsh
cd "/Users/shiadu/.openclaw/workspaceopenclaw configur/Startup/Apps/iCalendar"
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example. Please fill in Google/SMTP values if needed."
fi

# start server in background if not already running
if ! lsof -i :3000 -sTCP:LISTEN >/dev/null 2>&1; then
  nohup npm run dev >/tmp/icalendar_app.log 2>&1 &
  sleep 2
fi

open "http://localhost:3000"

echo "iCalendar app is running at http://localhost:3000"
