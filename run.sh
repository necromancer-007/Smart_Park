#!/bin/bash

# A simple script to start the Smart Parking System

# Start backend in background
echo "Starting FastAPI Backend..."
cd backend
if [ -f "venv/bin/activate" ]; then
    echo "Activating virtual environment..."
    source venv/bin/activate
fi
uvicorn app:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

# Move back to root
cd ..

# Start frontend static server
echo "Starting Frontend Server..."
cd frontend
python3 -m http.server 3000 &
FRONTEND_PID=$!

echo "================================================="
echo " System is Running!"
echo " Frontend available at: http://localhost:3000"
echo " Backend running at:    http://localhost:8000"
echo "================================================="
echo "Press Ctrl+C to stop both servers."

# Wait for Ctrl+C
trap "echo 'Stopping servers...'; kill $BACKEND_PID $FRONTEND_PID; exit 0" SIGINT SIGTERM
wait
