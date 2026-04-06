# Smart Parking System

A fully-fleshed out smart parking interface separated into a modern backend/frontend architecture.

<<<<<<< HEAD
=======
This project was developed with the assistance of AI tools for code structuring, optimization guidance, and implementation support. Final design decisions, architecture, and integration were completed manually.

>>>>>>> 00858bb97747d3e04cc37432b6fa09e536f347f6
## Architecture
- **Backend**: Python (FastAPI). Exposes a `/scan` OCR endpoint and connects securely to Firebase Firestore via the official Admin SDK. Uses `pytesseract` and `opencv-python`.
- **Frontend**: Lightweight HTML/JS/CSS, styled with TailwindCSS. Listens in real-time to Firebase Firestore for immediate cross-device sync. Connects the device camera natively and streams individual frames to the backend for OCR.

## Setup Instructions

### 1. Prerequisites
- Python 3.9+
- Python `pip`
- Node.js (Optional, recommended for development servers like `http-server` or `live-server`)
- Tesseract OCR engine installed on your hosting system
  - macOS: `brew install tesseract`
  - Linux (Ubuntu): `sudo apt install tesseract-ocr`
  - Windows: Download the latest installer from [UB-Mannheim/tesseract](https://github.com/UB-Mannheim/tesseract/wiki)

### 2. Backend Configuration
1. Navigate to the `backend/` directory.
2. We highly recommend creating a virtual environment:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```
3. Install the requirements:
   ```bash
   pip install -r requirements.txt
   ```
4. **Firebase Admin Setup:** 
   Generate a new private key from your [Firebase settings](https://console.firebase.google.com/project/_/settings/serviceaccounts/adminsdk) and save it **exactly** as `backend/serviceAccountKey.json`. (This file is git-ignored).

### 3. Frontend Configuration
The frontend automatically syncs with Firebase using the web credentials provided directly in the UI (`Setup Cloud`). You will need the standard Web JSON object from your Firebase settings.

### 4. Running the System
You can use the provided bash script at the root of the project to run both servers concurrently:
```bash
chmod +x run.sh
./run.sh
```

Alternatively, run them separately:

**Backend:**
```bash
cd backend
<<<<<<< HEAD
source venv/bin/activate
python3 -m uvicorn app:app --host 0.0.0.0 --port 8000 --reload
=======
uvicorn app:app --host 0.0.0.0 --port 8000 --reload
>>>>>>> 00858bb97747d3e04cc37432b6fa09e536f347f6
```

**Frontend:**
```bash
cd frontend
python -m http.server 3000
# Then visit http://localhost:3000
```
