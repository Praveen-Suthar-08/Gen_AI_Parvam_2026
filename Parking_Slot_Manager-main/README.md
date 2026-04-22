# 🚗 Smart Parking Slot Manager (PSM)

An Enterprise-grade, Highly Responsive Parking Management System built with **Flask** and **Vanilla JS (Chart.js & Tailwind CSS)**. This system runs two highly-decoupled microservice portals capable of securely managing real-time slots, generating digital QR checks, tracking offline cash drawers, and dynamically surging prices during peak facility occupancy. 

---

## ⚡ Features Snapshot

* **Live Occupancy Tracking:** Natively tracks slot allocations, visually projecting capacity limits and localized zone-based metrics in real-time.
* **3D Virtual Renderings:** Built-in Three.js modeling for a digital twin overview of the entire physical parking layout.
* **Enterprise Features:**
  * **Surge Pricing Integrations:** Automatic +1.5x fee escalation upon >85% facility utilization.
  * **Centralized Blacklisting:** Dynamic license plate interception (returns 403 Forbidden on check-in if banned).
  * **Digital QR Check-Ins:** Dynamic self-service API hooks using QR Code endpoints.
  * **Offline Shift Reconciliations:** Digital "Shift Drawer" tracking built-in for accurate analog cash calculations across different manager shifts.
  * **Membership Passes:** Native fee-bypassing mechanisms for monthly or pre-paid subscriber license plates.
* **Intelligent Dashboarding:** Features dual tracking metrics, Peak Hour analysis, Chart.js integrations, and seamless checkout logs.
* **Decoupled Payment Gateway Module:** Completely independent Gateway portal dedicated to OTP validation and simulating integrated API transactions.

---

## 💻 Tech Stack

- **Backend:** Python + Flask
- **Frontend architecture:** Vanilla JS + Standard HTML/CSS
- **Data Persistence:** Local JSON files (`data/parking_data.json` & `data/payment_data.json`)
- **Styling:** Tailwind CSS (via CDN)
- **Charts / Visualizations:** Chart.js, Three.js 

---

## 🚀 Setup & Installation Instructions

This project requires **Python 3.8+** to run locally.

### 1. Install Dependencies
Open your command prompt or terminal and install the required Python packages:

```bash
pip install flask flask-cors qrcode
```

### 2. Run the System 
Because the Payment Gateway acts as a standalone external payment processor, **you must run both servers securely side-by-side**.

Open **two separate terminals** inside your project folder (`c:\Praveen\Projects\psm`):

**Terminal 1: Start the Main Parking Manager (Port 5000)**
```bash
cd parking_manager
python app.py
```

**Terminal 2: Start the Standalone Payment Gateway (Port 5001)**
```bash
cd payment_gateway
python payment_app.py
```

*Note: Both terminals need to remain open/running to simulate the interconnected features properly.*

### 3. Open the Application
Once both terminal instances are actively running, open your web browser and navigate directly to the Main Dashboard:

👉 **[http://localhost:5000](http://localhost:5000)**

*(The Payment Gateway on port `5001` operates natively in the background and will be routed to automatically during Check-Outs).*

---

## 🛠 Basic Operating Instructions

* **Check-In a Vehicle**: Go to the "Parking Slots" page, click an available green slot, and select "Check In". Enter the plate to start the timer (Try entering a plate placed on the Blacklist to test the security perimeter!).
* **Closing a Shift**: In the top right header, click your "Shift Status" to open the drawer calculator. It will log all standard Cash transactions and allow you to quickly log out your drawer securely.
* **Check-Out a Vehicle**: Find an occupied slot, click Check Out! You will be securely navigated to the independent Payment Gateway where simulating the payment creates the native digital receipt! 
