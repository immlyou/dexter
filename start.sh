#!/bin/bash
# Dexter - AI Financial Research Agent
# Usage: ./start.sh

export PATH="$HOME/.bun/bin:$PATH"
cd "$(dirname "$0")"

echo "🤖 Starting Dexter..."
echo "📊 AI Financial Research Agent"
echo ""
bun start
