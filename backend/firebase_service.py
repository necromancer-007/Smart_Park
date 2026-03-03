import firebase_admin
from firebase_admin import credentials, firestore
import os
import json

# Initialize Firebase Admin
def initialize_firebase():
    """
    Initializes the Firebase Admin SDK using the service account key.
    """
    try:
        # Resolve path to serviceAccountKey.json
        base_dir = os.path.dirname(os.path.abspath(__file__))
        key_path = os.path.join(base_dir, 'serviceAccountKey.json')

        if not os.path.exists(key_path):
            print(f"Warning: {key_path} not found. Firebase Admin SDK not initialized.")
            return None

        # Check if it's the placeholder key by reading first few non-comment lines
        with open(key_path, 'r') as f:
            content = "".join([line for line in f if not line.strip().startswith('//')])
            try:
                data = json.loads(content)
                if data.get('project_id') == 'your-project-id':
                    print("Warning: serviceAccountKey.json appears to be a placeholder.")
                    return None
            except Exception:
                pass


        cred = credentials.Certificate(key_path)
        if not firebase_admin._apps:
            firebase_admin.initialize_app(cred)
            print("Firebase Admin SDK initialized successfully.")
        
        return firestore.client()

    except Exception as e:
        print(f"Error initializing Firebase Admin SDK: {e}")
        return None

db = initialize_firebase()

def update_verified_plate(scanned_plate: str) -> bool:
    """
    Searches the main_lot_v1 document to see if this plate belongs to any
    unverified occupied slots, and marks them as verified.
    Returns True if a match was found and updated, False otherwise.
    """
    if db is None:
        print("Firebase is not initialized. Cannot update Firestore.")
        return False

    if not scanned_plate:
        return False

    try:
        doc_ref = db.collection('parking_data').document('main_lot_v1')
        doc = doc_ref.get()

        if not doc.exists:
            print("main_lot_v1 document does not exist.")
            return False

        data = doc.to_dict()
        slots = data.get('slots', [])
        
        match_found = False
        
        for slot in slots:
            if slot.get('status') == 'occupied':
                occupied_by = slot.get('occupiedBy', {})
                if not occupied_by.get('verified', False):
                    # Check if the scanned plate is present in the recorded vehicleNo
                    recorded_no = occupied_by.get('vehicleNo', '').upper().replace(" ", "")
                    # simple partial or full match logic
                    if scanned_plate in recorded_no or recorded_no in scanned_plate:
                        slot['occupiedBy']['verified'] = True
                        match_found = True
                        
                        # Add a history log to say backend verified it
                        history = data.get('history', [])
                        import datetime
                        time_str = datetime.datetime.now().strftime("%I:%M:%S %p")
                        history.insert(0, {
                            'msg': f"BACKEND VERIFIED: {scanned_plate}",
                            'color': 'text-green-400',
                            'time': time_str
                        })
                        data['history'] = history
                        break

        if match_found:
            # Update the entire slots and history back to firestore
            doc_ref.update({
                'slots': slots,
                'history': data['history']
            })
            print(f"Successfully verified plate: {scanned_plate} in Firestore.")
            return True
            
        return False

    except Exception as e:
        print(f"Error updating Firestore: {e}")
        return False
