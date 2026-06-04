# Smart Parking System

A modern, cloud-synced Smart Parking Command Center and Driver booking platform. The project is structured with a lightweight, premium frontend designed for Vercel, and an AI-powered detection/OCR backend designed for Render.

---

## 🎨 Premium Features & Interface

### 1. Role-Aware settings panel
A fully integrated settings suite customized by role:
- **Driver Preferences**: Pre-configure default vehicle type, default payment method (UPI, FASTag, Card), default building, and up to 3 saved license plates for fast-track bookings.
- **Admin System Controls**: Configure Car/Bike hourly rates, OCR confidence threshold (%), default building, Auto-Verify scans option, and an **Alert Threshold (%)** to fire warnings when capacity limits are exceeded.

### 2. Interactive Admin Command Center (3 Tabs)
- **Tab 1: Slots & Logs**: Displays a custom 2-lane lane blueprint for Building 1. Slots are color-coded (Green for Available, Red/Yellow for Occupied, Hatching for Maintenance) with instant click controls and a live system log.
- **Tab 2: Camera & Logs**: Starts a camera feed overlaying green detection bounding boxes on license plates at 5 FPS, combined with manual OCR scanners and synced logs. Swapping tabs automatically suspends the camera stream to optimize performance.
- **Tab 3: Analytics Dashboard**: A full Power BI-style dashboard:
  - **KPI Cards**: Gross Earnings, Capacity Utilization (%), and Total Bookings.
  - **Filters**: Palette switchers (Cyber Neon, Emerald Sea, Golden Amber), Grid Line toggles, timeframe controls (Today, Week, Month), and Building selectors.
  - **Charts**: Interactive line/bar charts for Revenue Over Time, Occupancy Distribution, Peak Traffic Hours, and Vehicle Category breakdowns.

### 3. Realtime & Actual Data Analytics
- Calculates all KPIs and graphs dynamically from actual slot states and log history metadata (action, amount, vehicle, building, timestamp).
- Zero simulated placeholders or makeup multipliers—empty states reflect pure, live data.

### 4. Unverified Vehicle Aesthetics
- Parked vehicles awaiting verification showcase a smooth, flowing golden background shimmer (`yellow-shimmer`), breathing yellow border glow, pulsing caution badge, and yellow vehicle icons. Once verified via OCR or admin details, they transition cleanly into a solid red state with a green shield checkmark.

---

## 🚀 How to Deploy

### Frontend (Vercel)
1. Push the repository to GitHub.
2. Import the project into **Vercel** and select the `frontend/` directory as the root.
3. Configure Firestore Security Rules using the included `firestore.rules`.
4. Once deployed, open the web app, click **Setup Cloud** in the navbar, and paste your Firebase Web SDK config JSON object to link your database.

### Backend (Render)
1. Create a Web Service on **Render** pointing to the `backend/` directory.
2. Select the **Python** environment.
3. Install Tesseract OCR on the Render instance (or configure the environment package manager to include `tesseract-ocr`).
4. Generate a Firebase Service Account key JSON file from your Firebase console, save it as `serviceAccountKey.json` inside the `backend/` folder, and configure Render to reference it or upload it securely.

---

## 🧪 How to Test (Driver to Admin Portal Workflow)

To test the end-to-end cloud communication and visual states, perform the following steps:

1. **Book a Slot (Driver Portal):**
   - Log in as a driver (e.g., `driver@smartpark.com` / `driver123` in offline mode).
   - Go to the **Fast Track** panel at the top, enter a demo license plate number (e.g., `MH 12 AB 1234`), select **Car**, and click **Book**.
   - *Alternative:* Click on any green "Open" slot on the blueprint grid, enter the plate, and confirm.

2. **Verify Unverified Visual States (Admin Portal):**
   - Log in as an admin on another browser window/tab (e.g., `admin@smartpark.com` / `admin123`).
   - Navigate to the **Slots & Logs** tab.
   - **Result**: You will see the slot you booked immediately turn yellow with a **pulsing warning shield** and a **smooth flowing gold shimmer gradient**. This indicates the vehicle is unverified.
   - The log stream will display a yellow line: `[Time] PARK: MH12AB1234` or `AUTO-BOOK: Slot X for MH12AB1234`.

3. **Check Live Analytics Updates:**
   - Click the **Analytics** tab.
   - **Result**: The **Capacity Utilization** card and chart will show the exact 5% occupancy increase. The **Total Bookings** KPI will increment by 1, and the **Vehicle Categories** chart will update to show 1 Car.

4. **Verify the Plate (OCR/Admin Scan):**
   - On the **Camera & Logs** tab, standard scans matching the plate will mark it verified, or offline mock verification will automatically fire if Auto-Verify is enabled.
   - **Result**: The slot on the blueprint turns solid red and the yellow caution shield changes into a **green check shield**, signaling a verified state. The log stream adds: `[Time] VERIFIED: MH12AB1234`.

5. **Perform Checkout & Earnings Tracking:**
   - In the **Driver Portal**, click on the occupied slot.
   - A Checkout modal will pop up, calculating the duration and pricing (using your custom configured settings rates) and defaulting to your saved payment preference.
   - Click **Confirm & Pay**.
   - **Result**: The slot returns to green ("Open"). In the **Admin Portal** -> **Analytics** tab, the **Gross Earnings** KPI card and the **Revenue Over Time** chart instantly reflect the paid amount.
