from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from ocr_service import process_image
from firebase_service import update_verified_plate
import uvicorn

app = FastAPI(title="Smart Parking System API")

# Configure CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Allow any origin for local dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"status": "ok", "message": "Smart Parking API is running"}

@app.post("/scan")
async def scan_plate(image: UploadFile = File(...)):
    """
    Receives an image file from the frontend camera, 
    processes it with OCR to find an alphanumeric number plate, 
    and checks Firestore to verify a booking.
    """
    if not image.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail="Invalid file type. Please upload an image.")

    try:
        # Read the file contents as bytes
        contents = await image.read()
        
        # Process the image using OCR Service
        detected_text = process_image(contents)
        
        if not detected_text:
            return {"success": False, "message": "No valid plate detected", "plate": None}

        # Attempt to verify the plate via Firebase Service
        # Note: If firebase wasn't initialized (e.g., missing service account key), 
        # this will just politely return False and we only send the plate back to the client.
        updated = update_verified_plate(detected_text)

        message = "Match found and verified" if updated else "Plate detected but no unverified matches found"

        return {
            "success": True, 
            "message": message, 
            "plate": detected_text,
            "database_updated": updated
        }

    except Exception as e:
        print(f"Error processing scan: {e}")
        raise HTTPException(status_code=500, detail="An error occurred while processing the scan")

if __name__ == "__main__":
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
