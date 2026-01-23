#!/bin/bash
echo "Starting Vercel dev server..."
echo ""
echo "If you get 'yarn: command not found', the vercel.json should fix it."
echo "If you get API connection errors, try:"
echo "  vercel dev --yes  (to skip prompts)"
echo ""
echo "Starting..."
vercel dev --listen 3000
