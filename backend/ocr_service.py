import os
import platform
import re

import cv2
import numpy as np
from paddleocr import PaddleOCR

# Initialize PaddleOCR once at startup
ocr = PaddleOCR(use_angle_cls=False, lang='en')


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


def is_perfect_plate(text: str, confidence: float) -> bool:
    score = plate_pattern_score(text)
    if score >= 75 and confidence >= 50:
        return True
    if score >= 30 and confidence >= 75:
        return True
    return False


def detect_candidates(img):
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
            return []
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
        boxes = []
        for contour in contours:
            x, y, box_width, box_height = cv2.boundingRect(contour)
            aspect_ratio = box_width / float(max(box_height, 1))
            area = box_width * box_height
            if 1.8 < aspect_ratio < 6.5 and box_width > 55 and box_height > 15:
                # Prioritize aspect ratio closer to standard plate (approx 4.2)
                ar_score = 1.0 / (1.0 + abs(aspect_ratio - 4.2))
                score = area * ar_score
                boxes.append((score, x, y, box_width, box_height))

        if not boxes:
            return []

        # Sort descending by score
        boxes.sort(reverse=True, key=lambda val: val[0])
        
        top_boxes = []
        inverse_ratio = 1.0 / ratio
        for _, x, y, box_width, box_height in boxes[:3]:
            top_boxes.append({
                "x": int(x * inverse_ratio),
                "y": int(y * inverse_ratio),
                "w": int(box_width * inverse_ratio),
                "h": int(box_height * inverse_ratio),
            })
        return top_boxes
    except Exception as error:
        print(f"Plate detection error: {error}")
        return []


def detect_bbox(img):
    candidates = detect_candidates(img)
    return candidates[0] if candidates else None


def read_candidate(image):
    try:
        # PaddleOCR predict runs detection & recognition on the crop
        result = ocr.predict(image)
        if result and result[0] and result[0].get('rec_texts'):
            text = result[0]['rec_texts'][0]
            confidence = result[0]['rec_scores'][0]
            return clean_plate_text(text), confidence * 100
    except Exception as error:
        print(f"PaddleOCR error in read_candidate: {error}")
    return "", 0


def process_image(image_bytes: bytes) -> dict:
    try:
        image = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            return {"text": "", "bbox": None, "confidence": 0}

        # 1. Detect up to 3 candidate bounding boxes sorted by score
        bboxes = detect_candidates(image)
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        
        scored_candidates = []
        
        # 2. Try OCR on each cropped ROI
        for idx, bbox in enumerate(bboxes):
            padding_x = max(10, int(bbox["w"] * 0.08))
            padding_y = max(8, int(bbox["h"] * 0.25))
            x1 = max(0, bbox["x"] - padding_x)
            y1 = max(0, bbox["y"] - padding_y)
            x2 = min(image.shape[1], bbox["x"] + bbox["w"] + padding_x)
            y2 = min(image.shape[0], bbox["y"] + bbox["h"] + padding_y)
            roi = image[y1:y2, x1:x2]
            
            # Simple pre-processing: resize slightly to improve character definition
            if roi.shape[0] > 0 and roi.shape[1] > 0:
                h, w = roi.shape[:2]
                scale = 64.0 / float(h)
                roi_resized = cv2.resize(roi, (int(w * scale), 64), interpolation=cv2.INTER_CUBIC)
                
                # Single-pass OCR on cropped ROI
                candidate, confidence = read_candidate(roi_resized)
                if candidate:
                    score = plate_pattern_score(candidate)
                    scored_candidates.append((confidence + score, confidence, candidate, bbox))
                    
                    # Early exit check: if it's a very good plate match, return immediately!
                    if is_perfect_plate(candidate, confidence):
                        return {
                            "text": candidate,
                            "bbox": bbox,
                            "confidence": round(confidence, 1)
                        }

        # 3. If ROI OCR failed to find a valid license plate pattern, run on the full image
        best_roi_candidate = None
        if scored_candidates:
            best_roi_candidate = max(scored_candidates, key=lambda x: x[0])
            
        run_full_image = True
        if best_roi_candidate:
            _, confidence, text, bbox = best_roi_candidate
            if plate_pattern_score(text) >= 0:
                run_full_image = False

        if run_full_image:
            try:
                # Runs full image PaddleOCR
                result = ocr.predict(image)
                if result and result[0] and result[0].get('rec_texts'):
                    texts = result[0]['rec_texts']
                    scores = result[0]['rec_scores']
                    boxes = result[0].get('rec_boxes', [None] * len(texts))
                    for text, confidence, bbox_coords in zip(texts, scores, boxes):
                        text = clean_plate_text(text)
                        if text:
                            score = plate_pattern_score(text)
                            bbox = None
                            if bbox_coords is not None and len(bbox_coords) >= 4:
                                x1, y1, x2, y2 = bbox_coords[0], bbox_coords[1], bbox_coords[2], bbox_coords[3]
                                bbox = {"x": int(x1), "y": int(y1), "w": int(x2 - x1), "h": int(y2 - y1)}
                            
                            scored_candidates.append((confidence * 100 + score, confidence * 100, text, bbox))
                            if is_perfect_plate(text, confidence * 100):
                                return {
                                    "text": text,
                                    "bbox": bbox,
                                    "confidence": round(confidence * 100, 1)
                                }
            except Exception as error:
                print(f"Full image OCR error: {error}")

        # 4. Return the best overall candidate
        if not scored_candidates:
            fallback_bbox = bboxes[0] if bboxes else None
            return {"text": "", "bbox": fallback_bbox, "confidence": 0}

        # Get highest scored candidate
        _, confidence, text, bbox = max(scored_candidates, key=lambda x: x[0])
        fallback_bbox = bbox if bbox else (bboxes[0] if bboxes else None)
        
        if plate_pattern_score(text) < 0:
            return {"text": "", "bbox": fallback_bbox, "confidence": round(confidence, 1)}
            
        return {"text": text, "bbox": fallback_bbox, "confidence": round(confidence, 1)}
    except Exception as error:
        print(f"OCR pipeline error: {error}")
        try:
            if bboxes:
                return {"text": "", "bbox": bboxes[0], "confidence": 0}
        except:
            pass
        return {"text": "", "bbox": None, "confidence": 0}
