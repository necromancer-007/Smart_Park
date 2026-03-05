import cv2
import pytesseract
import numpy as np
import re

def clean_plate_text(text: str) -> str:
    """
    Cleans the raw OCR output to extract alphanumeric characters.
    """
    # Remove all non-alphanumeric characters
    cleaned = re.sub(r'[^A-Z0-9]', '', text.upper())
    return cleaned

def process_image(image_bytes: bytes) -> str:
    """
    Processes an image byte stream using OpenCV and Tesseract OCR.
    Returns the cleaned detected plate text.
    """
    try:
        # Convert bytes to numpy array
        np_arr = np.frombuffer(image_bytes, np.uint8)
        # Decode image using OpenCV
        img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

        if img is None:
            raise ValueError("Could not decode image.")

        # Optional: Add image preprocessing here to improve OCR accuracy
        # Convert to grayscale
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        # Apply bilateral filter to remove noise but keep edges sharp
        filtered = cv2.bilateralFilter(gray, 11, 17, 17)
        
        # Apply thresholding
        _, thresh = cv2.threshold(filtered, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

        # Run Tesseract OCR on the thresholded image
        # Using PSM 7: Treat the image as a single text line.
        custom_config = r'--oem 3 --psm 7'
        raw_text = pytesseract.image_to_string(thresh, config=custom_config)
        
        # Clean and return text
        return clean_plate_text(raw_text)

    except Exception as e:
        print(f"OCR Error: {e}")
        return ""
