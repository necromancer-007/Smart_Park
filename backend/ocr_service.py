import os
import platform
import re

import cv2
import numpy as np
import pytesseract
from pytesseract import Output


if platform.system() == "Darwin":
    for path in ("/opt/homebrew/bin/tesseract", "/usr/local/bin/tesseract"):
        if os.path.exists(path):
            pytesseract.pytesseract.tesseract_cmd = path
            break
elif platform.system() == "Linux":
    for path in ("/usr/bin/tesseract", "/usr/local/bin/tesseract"):
        if os.path.exists(path):
            pytesseract.pytesseract.tesseract_cmd = path
            break


PLATE_CONFIGS = (
    "--oem 3 --psm 7 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    "--oem 3 --psm 8 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
)


def clean_plate_text(text: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", text.upper())


def plate_pattern_score(text: str) -> int:
    """Favor realistic registration numbers and reject short OCR noise."""
    if not 5 <= len(text) <= 12:
        return -40

    score = 10
    letters = sum(char.isalpha() for char in text)
    digits = sum(char.isdigit() for char in text)
    if letters >= 2 and digits >= 2:
        score += 20
    if re.fullmatch(r"[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{3,4}", text):
        score += 45
    if len(set(text)) <= 2:
        score -= 30
    return score


def detect_bbox(img):
    try:
        height, width = img.shape[:2]
        ratio = min(1.0, 900.0 / width)
        resized = cv2.resize(img, (int(width * ratio), int(height * ratio)), interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
        gray = cv2.bilateralFilter(gray, 9, 35, 35)

        blackhat_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (17, 5))
        blackhat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, blackhat_kernel)
        grad_x = cv2.Sobel(blackhat, cv2.CV_32F, 1, 0, ksize=-1)
        grad_x = np.absolute(grad_x)
        max_value = np.max(grad_x)
        if max_value == 0:
            return None
        grad_x = (255 * (grad_x / max_value)).astype("uint8")
        grad_x = cv2.GaussianBlur(grad_x, (5, 5), 0)
        grad_x = cv2.morphologyEx(grad_x, cv2.MORPH_CLOSE, blackhat_kernel)
        threshold = cv2.threshold(grad_x, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]
        threshold = cv2.morphologyEx(
            threshold,
            cv2.MORPH_CLOSE,
            cv2.getStructuringElement(cv2.MORPH_RECT, (5, 3)),
            iterations=2,
        )

        contours, _ = cv2.findContours(threshold, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        candidates = []
        for contour in contours:
            x, y, box_width, box_height = cv2.boundingRect(contour)
            aspect_ratio = box_width / float(max(box_height, 1))
            area = box_width * box_height
            if 1.8 < aspect_ratio < 6.5 and box_width > 55 and box_height > 15:
                candidates.append((area, x, y, box_width, box_height))

        if not candidates:
            return None

        _, x, y, box_width, box_height = max(candidates)
        inverse_ratio = 1.0 / ratio
        return {
            "x": int(x * inverse_ratio),
            "y": int(y * inverse_ratio),
            "w": int(box_width * inverse_ratio),
            "h": int(box_height * inverse_ratio),
        }
    except Exception as error:
        print(f"Plate detection error: {error}")
        return None


def build_ocr_variants(gray):
    target_width = 700
    scale = target_width / float(max(gray.shape[1], 1))
    resized = cv2.resize(gray, (target_width, max(80, int(gray.shape[0] * scale))), interpolation=cv2.INTER_CUBIC)
    denoised = cv2.bilateralFilter(resized, 9, 45, 45)
    sharpened = cv2.filter2D(denoised, -1, np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]]))
    otsu = cv2.threshold(sharpened, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    adaptive = cv2.adaptiveThreshold(
        sharpened, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 7
    )
    return (sharpened, otsu, cv2.bitwise_not(otsu), adaptive)


def read_candidate(image, config):
    try:
        data = pytesseract.image_to_data(image, config=config, output_type=Output.DICT)
    except Exception as error:
        print(f"Tesseract OCR error in read_candidate: {error}")
        return "", 0

    words = []
    confidences = []
    for raw_text, raw_confidence in zip(data["text"], data["conf"]):
        text = clean_plate_text(raw_text)
        try:
            confidence = float(raw_confidence)
        except (TypeError, ValueError):
            confidence = -1
        if text and confidence >= 0:
            words.append(text)
            confidences.append(confidence)

    candidate = clean_plate_text("".join(words))
    confidence = sum(confidences) / len(confidences) if confidences else 0
    return candidate, confidence


def process_image(image_bytes: bytes) -> dict:
    try:
        image = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            return {"text": "", "bbox": None, "confidence": 0}

        bbox = detect_bbox(image)
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        
        scored_candidates = []
        
        # 1. Try OCR on the cropped ROI if bounding box is found
        if bbox:
            padding_x = max(10, int(bbox["w"] * 0.08))
            padding_y = max(8, int(bbox["h"] * 0.25))
            x1 = max(0, bbox["x"] - padding_x)
            y1 = max(0, bbox["y"] - padding_y)
            x2 = min(image.shape[1], bbox["x"] + bbox["w"] + padding_x)
            y2 = min(image.shape[0], bbox["y"] + bbox["h"] + padding_y)
            roi = gray[y1:y2, x1:x2]
            
            roi_variants = build_ocr_variants(roi)
            # Sharpened variant gets both configs
            for config in PLATE_CONFIGS:
                candidate, confidence = read_candidate(roi_variants[0], config)
                if candidate:
                    scored_candidates.append((confidence + plate_pattern_score(candidate), confidence, candidate))
            # Binary thresholds only get PSM 7
            for var in roi_variants[1:]:
                candidate, confidence = read_candidate(var, PLATE_CONFIGS[0])
                if candidate:
                    scored_candidates.append((confidence + plate_pattern_score(candidate), confidence, candidate))
        
        # 2. Check if we got a valid high-scoring candidate from the ROI
        best_candidate_valid = False
        if scored_candidates:
            _, confidence, text = max(scored_candidates)
            if plate_pattern_score(text) >= 0:
                best_candidate_valid = True
        
        # 3. If no bbox was detected, or ROI OCR failed to find a valid license plate pattern, run on the full image
        if not best_candidate_valid:
            full_variants = build_ocr_variants(gray)
            for config in PLATE_CONFIGS:
                candidate, confidence = read_candidate(full_variants[0], config)
                if candidate:
                    scored_candidates.append((confidence + plate_pattern_score(candidate), confidence, candidate))
            for var in full_variants[1:]:
                candidate, confidence = read_candidate(var, PLATE_CONFIGS[0])
                if candidate:
                    scored_candidates.append((confidence + plate_pattern_score(candidate), confidence, candidate))

        if not scored_candidates:
            return {"text": "", "bbox": bbox, "confidence": 0}

        _, confidence, text = max(scored_candidates)
        if plate_pattern_score(text) < 0:
            return {"text": "", "bbox": bbox, "confidence": round(confidence, 1)}
        return {"text": text, "bbox": bbox, "confidence": round(confidence, 1)}
    except Exception as error:
        print(f"OCR pipeline error: {error}")
        return {"text": "", "bbox": None, "confidence": 0}
