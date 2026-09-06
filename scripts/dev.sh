#!/bin/bash

# Development server startup script
# This script starts backend and frontend in the background and manages them

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# Ensure logs directory exists
mkdir -p "$PROJECT_ROOT/logs"

BACKEND_PORT=8000
FRONTEND_PORT=3001
BACKEND_PID=""
FRONTEND_PID=""

# Cleanup function
cleanup() {
    echo ""
    echo -e "${YELLOW}Shutting down servers...${NC}"
    
    if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
        echo -e "${BLUE}Stopping backend (PID: $BACKEND_PID)${NC}"
        kill "$BACKEND_PID" 2>/dev/null || true
    fi
    
    if [ -n "$FRONTEND_PID" ] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
        echo -e "${BLUE}Stopping frontend (PID: $FRONTEND_PID)${NC}"
        kill "$FRONTEND_PID" 2>/dev/null || true
    fi
    
    # Kill any remaining processes on ports
    lsof -ti:$BACKEND_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
    lsof -ti:$FRONTEND_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
    
    echo -e "${GREEN}Servers stopped${NC}"
    exit 0
}

# Set up trap for cleanup
trap cleanup SIGINT SIGTERM EXIT

# Check prerequisites
echo -e "${BLUE}Checking prerequisites...${NC}"

if ! command -v pnpm &> /dev/null; then
    echo -e "${RED}Error: pnpm is not installed${NC}"
    exit 1
fi

if ! command -v poetry &> /dev/null; then
    echo -e "${RED}Error: poetry is not installed${NC}"
    exit 1
fi

# Check if backend .env exists
if [ ! -f "apps/backend/.env" ]; then
    echo -e "${YELLOW}Creating backend .env from example...${NC}"
    cp apps/backend/.env.example apps/backend/.env
fi

# Ensure data directory exists
mkdir -p apps/backend/data

# Build SDK if not already built
if [ ! -d "packages/wallet-connector/dist" ]; then
    echo -e "${BLUE}Building SDK...${NC}"
    pnpm build:sdk
fi

# Check if ports are available
if lsof -Pi :$BACKEND_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${RED}Error: Port $BACKEND_PORT is already in use${NC}"
    echo -e "${YELLOW}Run: lsof -ti:$BACKEND_PORT | xargs kill -9${NC}"
    exit 1
fi

if lsof -Pi :$FRONTEND_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${RED}Error: Port $FRONTEND_PORT is already in use${NC}"
    echo -e "${YELLOW}Run: lsof -ti:$FRONTEND_PORT | xargs kill -9${NC}"
    exit 1
fi

echo -e "${GREEN}Prerequisites OK${NC}"
echo ""

# Start backend
echo -e "${BLUE}Starting backend on http://127.0.0.1:$BACKEND_PORT${NC}"
DEBUG=true ENVIRONMENT=development MULTIVAULT_HOST=127.0.0.1 MULTIVAULT_PORT=$BACKEND_PORT bash apps/backend/scripts/dev-backend.sh > "$PROJECT_ROOT/logs/backend.log" 2>&1 &
BACKEND_PID=$!

# Wait for backend to start
echo -e "${YELLOW}Waiting for backend to start...${NC}"
for i in {1..30}; do
    if curl -s http://127.0.0.1:$BACKEND_PORT/api/v1/health > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Backend is ready${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}Backend failed to start. Check logs/backend.log${NC}"
        exit 1
    fi
    sleep 1
done

# Start frontend
echo -e "${BLUE}Starting frontend on http://localhost:$FRONTEND_PORT${NC}"
pnpm --filter @multivault/frontend dev > "$PROJECT_ROOT/logs/frontend.log" 2>&1 &
FRONTEND_PID=$!

# Wait for frontend to start
echo -e "${YELLOW}Waiting for frontend to start...${NC}"
sleep 3

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                                            ║${NC}"
echo -e "${GREEN}║    MultiVault Development Servers       ║${NC}"
echo -e "${GREEN}║                                            ║${NC}"
echo -e "${GREEN}║  Frontend: ${NC}http://localhost:${FRONTEND_PORT}       ${GREEN}║${NC}"
echo -e "${GREEN}║  Backend:  ${NC}http://127.0.0.1:${BACKEND_PORT}        ${GREEN}║${NC}"
echo -e "${GREEN}║                                            ║${NC}"
echo -e "${GREEN}║  Press Ctrl+C to stop all servers         ║${NC}"
echo -e "${GREEN}║                                            ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Logs:${NC}"
echo -e "  Backend:  tail -f logs/backend.log"
echo -e "  Frontend: tail -f logs/frontend.log"
echo ""

# Keep script running
wait
