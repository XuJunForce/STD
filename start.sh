#!/bin/bash

# Platform Scaffold One-Click Fullstack Launcher script
# 启动前自动检测并清理 8000 / 5173 端口的残留进程，然后启动所有服务

echo -e "\033[1;36m==================================================\033[0m"
echo -e "\033[1;36m      TOOLBOX PLATFORM CORE GATEWAY & FRONTEND     \033[0m"
echo -e "\033[1;36m==================================================\033[0m"

# ──────────────────────────────────────────────────────────────────
# 1. 检测并 kill 占用端口的已有进程
# ──────────────────────────────────────────────────────────────────
kill_port() {
    local PORT=$1
    # lsof -ti 返回该端口对应的所有 PID，没有则为空
    local PIDS
    PIDS=$(lsof -ti tcp:"$PORT" 2>/dev/null)
    if [ -n "$PIDS" ]; then
        echo -e "\033[1;33m[清理] 检测到端口 $PORT 已被占用 (PID: $PIDS)，正在 kill...\033[0m"
        echo "$PIDS" | xargs kill -9 2>/dev/null
        sleep 0.5
        echo -e "\033[1;32m[清理] 端口 $PORT 已释放 ✓\033[0m"
    else
        echo -e "\033[0;37m[清理] 端口 $PORT 未被占用，跳过。\033[0m"
    fi
}

kill_port 8000
kill_port 5173

echo ""

# ──────────────────────────────────────────────────────────────────
# 2. 追踪子进程 PID，用于 Ctrl+C 时优雅退出
# ──────────────────────────────────────────────────────────────────
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
    echo -e "\n\033[1;33m[System] 收到退出信号，正在优雅停止所有服务...\033[0m"

    if [ -n "$BACKEND_PID" ]; then
        echo "[System] 停止 FastAPI Backend (PID: $BACKEND_PID)..."
        kill "$BACKEND_PID" 2>/dev/null
    fi

    if [ -n "$FRONTEND_PID" ]; then
        echo "[System] 停止 Vite Frontend (PID: $FRONTEND_PID)..."
        kill "$FRONTEND_PID" 2>/dev/null
    fi

    echo -e "\033[1;32m[System] 所有服务已停止，再见！\033[0m"
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

# ──────────────────────────────────────────────────────────────────
# 3. 启动 FastAPI 后端
# ──────────────────────────────────────────────────────────────────
echo -e "\033[1;34m[Backend] 正在启动 FastAPI 后端服务 (port 8000)...\033[0m"
uv run --project backend uvicorn backend.main:app --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!

# 等待后端完成 MySQL 表初始化
sleep 2

# ──────────────────────────────────────────────────────────────────
# 4. 启动 Vite React 前端
# ──────────────────────────────────────────────────────────────────
echo -e "\033[1;35m[Frontend] 正在启动 Vite React 开发服务器 (port 5173)...\033[0m"
cd frontend
npm run dev -- --host 127.0.0.1 --port 5173 &
FRONTEND_PID=$!
cd ..

# ──────────────────────────────────────────────────────────────────
# 5. 打印访问地址
# ──────────────────────────────────────────────────────────────────
echo ""
echo -e "\033[1;32m==================================================\033[0m"
echo -e "\033[1;32m        PLATFORM 启动完成，所有服务运行中！         \033[0m"
echo -e "\033[1;32m==================================================\033[0m"
echo -e "\033[1;34m* Backend API:  \033[4;36mhttp://127.0.0.1:8000/health\033[0m"
echo -e "\033[1;34m* API Docs:     \033[4;36mhttp://127.0.0.1:8000/docs\033[0m"
echo -e "\033[1;35m* Frontend UI:  \033[4;35mhttp://127.0.0.1:5173\033[0m"
echo -e "\033[1;33mPress Ctrl+C 可停止所有服务。\033[0m"

# 保持进程活跃，等待 trap 事件
wait
