#!/bin/bash
# Start ngrok tunnel for local API server

echo "Starting ngrok tunnel to http://localhost:3001"
echo "Make sure the API server is running first: npm run dev:api"
echo ""
echo "Once started, use the Forwarding URL shown below to test your endpoints"
echo ""

ngrok http 3001
