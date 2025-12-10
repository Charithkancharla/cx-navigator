#!/bin/bash

# Setup script for CX Navigator Telephony Backend

echo "📞 Setting up Telephony Backend..."

# 1. Install dependencies
echo "📦 Installing dependencies..."
npm install

# 2. Check for .env
if [ ! -f .env ]; then
  echo "⚠️  .env file not found. Creating from example..."
  if [ -f .env.example ]; then
    cp .env.example .env
  else
    echo "❌ .env.example not found. Please create .env manually with TWILIO credentials."
  fi
else
  echo "✅ .env file exists."
fi

echo ""
echo "🚀 To start the server, run:"
echo "   npm run start:server"
echo ""
echo "🌍 To expose it to the internet (required for Convex):"
echo "   ngrok http 3000"
echo ""
echo "📝 Then update your Convex Env Var:"
echo "   npx convex env set TELEPHONY_BACKEND_URL https://<your-ngrok-url>.ngrok-free.app"
echo ""
