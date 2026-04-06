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

<<<<<<< HEAD
def detect_bbox(img):
    """
    Expert-level License Plate Detection using Sobel gradients and Morphological ops.
    Extremely reliable at a distance.
    """
    try:
        # Resize for consistent processing speed
        h, w = img.shape[:2]
        ratio = 600.0 / w
        dim = (600, int(h * ratio))
        resized = cv2.resize(img, dim, interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)

        # 1. Morphological Blackhat: Highlights dark objects (Characters) on light backgrounds (Plates)
        rectKernel = cv2.getStructuringElement(cv2.MORPH_RECT, (13, 5))
        blackhat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, rectKernel)

        # 2. Sobel Gradients: Finding regions with high vertical edge density (common for plate numbers)
        gradX = cv2.Sobel(blackhat, ddepth=cv2.CV_32F, dx=1, dy=0, ksize=-1)
        gradX = np.absolute(gradX)
        (minVal, maxVal) = (np.min(gradX), np.max(gradX))
        gradX = 255 * ((gradX - minVal) / (maxVal - minVal))
        gradX = gradX.astype("uint8")

        # 3. Blur and Closing: Group character regions together
        gradX = cv2.GaussianBlur(gradX, (5, 5), 0)
        gradX = cv2.morphologyEx(gradX, cv2.MORPH_CLOSE, rectKernel)
        thresh = cv2.threshold(gradX, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]

        # 4. Clean up small noise with erosions/dilations
        thresh = cv2.erode(thresh, None, iterations=2)
        thresh = cv2.dilate(thresh, None, iterations=2)

        # 5. Find Contours and Filter by Aspect Ratio and Density
        cnts, _ = cv2.findContours(thresh.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cnts = sorted(cnts, key=cv2.contourArea, reverse=True)[:10]

        best_bbox = None
        for c in cnts:
            (x, y, v_w, v_h) = cv2.boundingRect(c)
            aspect_ratio = v_w / float(v_h)
            
            # Typical Plate Ratios are between 2.0 and 5.0
            if 2.0 < aspect_ratio < 5.5:
                # Basic area threshold (scaled to resized image)
                if v_w > 40 and v_h > 15:
                    # Return scaled back to original image size
                    inv_ratio = 1.0 / ratio
                    best_bbox = {
                        "x": int(x * inv_ratio),
                        "y": int(y * inv_ratio),
                        "w": int(v_w * inv_ratio),
                        "h": int(v_h * inv_ratio)
                    }
                    break

        return best_bbox
    except Exception as e:
        print(f"Detailed Detection Error: {e}")
        return None

def process_image(image_bytes: bytes) -> dict:
    """
    Expert vision pipeline: Detect -> Crop -> Normalize -> OCR
    """
    try:
        np_arr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

        if img is None:
            return {"text": "", "bbox": None}

        # 1. Advanced Detection
        bbox = detect_bbox(img)

        # 2. Smart OCR Target Extraction
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        if bbox:
            # Padding for OCR context
            p = 8
            y1, y2 = max(0, bbox["y"] - p), min(img.shape[0], bbox["y"] + bbox["h"] + p)
            x1, x2 = max(0, bbox["x"] - p), min(img.shape[1], bbox["x"] + bbox["w"] + p)
            roi = gray[y1:y2, x1:x2]
            
            # Rescale ROI to standard size (300px width) for Tesseract consistency
            roi_w = 400
            roi_h = int(roi.shape[0] * (roi_w / float(roi.shape[1])))
            roi = cv2.resize(roi, (roi_w, roi_h), interpolation=cv2.INTER_CUBIC)
            
            # Sharpen and Threshold specialized for text
            roi = cv2.bilateralFilter(roi, 11, 17, 17)
            _, search_img = cv2.threshold(roi, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        else:
            # Fallback (whole frame) - low probability of success but worth the try
            search_img = cv2.threshold(cv2.bilateralFilter(gray, 11, 17, 17), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]

        # Tesseract execution with whitelist for ONLY plates (optional but helpful)
        custom_config = r'--oem 3 --psm 6'
        raw_text = pytesseract.image_to_string(search_img, config=custom_config)
        
        detected_text = clean_plate_text(raw_text)
        
        # Log detected bbox found but OCR failed
        if not detected_text and bbox:
             # Try one more aggressive threshold if first failed
             alt_thresh = cv2.adaptiveThreshold(roi, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2)
             raw_text = pytesseract.image_to_string(alt_thresh, config=r'--oem 3 --psm 7')
             detected_text = clean_plate_text(raw_text)

        return {"text": detected_text, "bbox": bbox}

    except Exception as e:
        print(f"Final OCR Pipeline Error: {e}")
        return {"text": "", "bbox": None}
=======
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
>>>>>>> 00858bb97747d3e04cc37432b6fa09e536f347f6
