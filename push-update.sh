#!/bin/bash

echo "🔄 Building frontend..."
cd frontend && npm run build && cd ..

echo "📦 Staging all changes..."
git add -A

echo "💬 Enter commit message (or press Enter for default):"
read msg
msg=${msg:-"Update $(date '+%Y-%m-%d %H:%M')"}

git commit -m "$msg"
git push origin main

echo "✅ Done! Pushed to GitHub."
