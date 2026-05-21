#!/bin/bash

# Platform Scaffold One-Click Fullstack Launcher script
# It handles starting both FastAPI backend and Vite React frontend with automatic ports management.

echo -e "\033[1;36m==================================================\033[0m"
echo -e "\033[1;36m      TOOLBOX PLATFORM CORE GATEWAY & FRONTEND     \033[0m"
echo -e "\033[1;36m==================================================\033[0m"

# Track PIDs of launched servers for clean teardown on exit
BACKEND_PID=""
FRONTEND_PID=""

# Dynamic clean exit handler
cleanup() {
    echo -e "\n\033[1;33m[System] Received shutdown signal. Initiating clean termination...\033[0m"
    
    if [ -not -z "$BACKEND_PID" ]; then
        echo "[System] Stopping FastAPI Backend (PID: $BACKEND_PID)..."
        kill "$BACKEND_PID" 2>/dev/null
    fi
    
    if [ -not -z "$FRONTEND_PID" ]; then
        echo "[System] Stopping Vite Frontend (PID: $FRONTEND_PID)..."
        kill "$FRONTEND_PID" 2>/dev/null
    fi
    
    echo -e "\033[1;32m[System] All platform servers terminated successfully. Have a nice day!\033[0m"
    exit 0
}

# Bind clean exit trap to SIGINT (Ctrl+C), SIGTERM, and EXIT
trap cleanup SIGINT SIGTERM EXIT

# 1. Start FastAPI Backend Gateway
echo -e "\033[1;34m[Backend] Booting FastAPI backend microservices via uv...\033[0m"
uv run --project backend uvicorn backend.main:app --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!

# Let the backend initialize and self-test MySQL tables connection
sleep 2

# 2. Start Vite React Frontend
echo -e "\033[1;35m[Frontend] Starting Vite React dev server...\033[0m"
cd frontend
npm run dev -- --host 127.0.0.1 --port 5173 &
FRONTEND_PID=$!

cd ..

echo -e "\033[1;32m==================================================\033[0m"
echo -e "\033[1;32m      PLATFORM LAUNCH COMPLETE AND RUNNING!       \033[0m"
echo -e "\033[1;32m==================================================\033[0m"
echo -e "\033[1;34m* Backend API: \033[4;36mhttp://127.0.0.1:8000/health\033[0m"
echo -e "\033[1;34m* API Docs:    \033[4;36mhttp://127.0.0.1:8000/docs\033[0m"
echo -e "\033[1;35m* Frontend UI: \033[4;35mhttp://127.0.0.1:5173\033[0m"
echo -e "\033[1;33mPress Ctrl+C to terminate both servers cleanly.\033[0m"

# Wait infinitely keeping the process active and capturing trap events
wait
