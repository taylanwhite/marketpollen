#!/bin/bash
# Start ngrok tunnel to Vercel dev server

echo "Starting ngrok tunnel to http://localhost:3000"
echo "Make sure the dev server is running first: npm run dev:vercel"
echo ""
echo "Once started, use the Forwarding URL shown below to test your endpoints"
echo ""

ngrok http 3000
