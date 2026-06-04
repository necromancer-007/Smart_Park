#!/bin/bash

# A simple script to start the Smart Parking System

# Kill any existing processes on ports 3000 and 8000
echo "Cleaning up existing processes on ports 3000 and 8000..."
lsof -ti:3000 | xargs kill -9 2>/dev/null
lsof -ti:8000 | xargs kill -9 2>/dev/null

# Start backend in background
echo "Starting FastAPI Backend..."
cd backend
if [ -f "venv/bin/activate" ]; then
    echo "Activating virtual environment..."
    source venv/bin/activate
fi
if [ -f "venv/bin/python3" ]; then
    venv/bin/python3 -m uvicorn app:app --host 0.0.0.0 --port 8000 --reload &
else
    python3 -m uvicorn app:app --host 0.0.0.0 --port 8000 --reload &
fi
BACKEND_PID=$!

# Move back to root
cd ..

# Start frontend static server
echo "Starting Frontend Server..."
# Frontend files are in the frontend directory
cd frontend
python3 -m http.server 3000 &
FRONTEND_PID=$!
cd ..

echo "================================================="
echo " System is Running!"
echo " Frontend available at: http://localhost:3000"
echo " Backend running at:    http://localhost:8000"
echo "================================================="
echo "Press Ctrl+C to stop both servers."

# Wait for Ctrl+C
trap "echo 'Stopping servers...'; kill $BACKEND_PID $FRONTEND_PID; exit 0" SIGINT SIGTERM
wait
