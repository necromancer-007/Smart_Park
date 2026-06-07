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

@app.get("/debug")
def debug_info():
    import platform
    import paddle
    import paddleocr
    
    version = None
    paddle_version = None
    error = None
    try:
        version = paddleocr.__version__
        paddle_version = paddle.__version__
    except Exception as e:
        error = str(e)
        
    return {
        "platform": platform.system(),
        "platform_release": platform.release(),
        "paddleocr_version": version,
        "paddle_version": paddle_version,
        "error": error
    }

@app.post("/scan")
async def scan_plate(image: UploadFile = File(...)):
    """
    Receives an image file from the frontend camera, 
    processes it with OCR to find an alphanumeric number plate, 
    and checks Firestore to verify a booking. Returns success with plate and bbox.
    """
    if not image.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail="Invalid file type. Please upload an image.")

    try:
        contents = await image.read()
        result = process_image(contents)
        detected_text = result["text"]
        
        if not detected_text:
            return {"success": False, "message": "No valid plate detected", "plate": None, "bbox": result["bbox"], "confidence": result["confidence"]}

        # Attempt to verify the plate via Firebase Service
        updated = update_verified_plate(detected_text) if result["confidence"] >= 45 else False
        message = "Match found and verified" if updated else "Plate detected but no unverified matches found"

        return {
            "success": True, 
            "message": message, 
            "plate": detected_text,
            "bbox": result["bbox"],
            "confidence": result["confidence"],
            "database_updated": updated
        }
    except Exception as e:
        print(f"Error processing scan: {e}")
        raise HTTPException(status_code=500, detail="An error occurred while processing the scan")

@app.post("/detect")
async def detect_plate(image: UploadFile = File(...)):
    """
    Specifically for live feedback: Returns only the bounding box info.
    """
    try:
        contents = await image.read()
        result = process_image(contents)
        return {"bbox": result["bbox"]}
    except Exception as e:
        return {"bbox": None}

if __name__ == "__main__":
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
