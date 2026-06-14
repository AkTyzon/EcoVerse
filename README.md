# 🌳 EcoVerse - A Multiplayer Sustainability World

EcoVerse is an interactive, gamified sustainability simulation web application. Builders log real-world green actions (like eco-friendly commuting, green meals, and recycling), manage resources (Green Energy and Nature Points), and watch their low-poly 3D isometric floating virtual island thrive. They can also upload utility bills for AI-driven carbon footprint extraction, chat with a wise simulated or real AI companion (the **Forest Guardian**), and cooperate in Eco Tribes.

This repository contains the complete codebase containerized and ready to deploy locally or serverlessly on Google Cloud Run.

---

## 🏆 Hackathon Judging Guide (Quick Test-Drive)

> [!IMPORTANT]
> **Live Demo URL:** [https://ecoverse-282925483383.us-central1.run.app](https://ecoverse-282925483383.us-central1.run.app)
> 
> *Test all features instantly in Guest/Demo Mode without creating any account, or sign up in seconds to enable live cloud multiplayer persistence!*

### 🎥 Project Walkthrough Video
![EcoVerse Walkthrough Video](./static/ecoverse_guest_demo.webp)

Here is the best way to evaluate all aspects of the EcoVerse application in **under 2 minutes**:


### 1. Interactive 3D World Simulation (Visuals & Mechanics)
- On the main dashboard page, click **"Log Commute"**, **"Log Green Meal"**, or **"Log Recycle"**.
- Watch the **Floating 3D Isometric Island** respond immediately:
  - Pine trees grow and sprout green foliage.
  - The river turns clean emerald-turquoise, waterfall mist rises, and the shadow deepens.
  - Aerodynamic wind turbine blades rotate, and solar panels get a sleek metallic glare highlight sweep.
  - Carbon indicators and your environmental aura shift colors based on your carbon offset score.
- *Note:* Daily logging limits are day-specific, preventing spam logs on the same calendar day.

### 2. AI Utility Bill Carbon Extraction (Gemini Multimodal)
- Go to the **Verify Bill** tab.
- Upload any mock utility bill image, PDF, or text file.
- The app uses Gemini to extract resource consumption (kWh, Litres, etc.), calculate the exact carbon footprint offsets, and award Green Energy.
- **Quota Resilience:** If the server's shared Gemini quota is exhausted, the backend returns a clean, detailed error advising you to use **Demo Mode** or configure your own key in the settings panel (gear icon) to bypass all rate limits.

### 3. Forest Guardian AI Chat
- Go to the **Forest Guardian** tab.
- Click any of the quick-prompt chips (e.g., flight emissions or green vegetarian recipes) or type your own question, then press **Enter** to submit instantly.
- The Forest Guardian dynamically responds using Gemini context aware of your island's score.

### 4. Eco Tribes (Multiplayer & Real-Time Chat)
- Select the **Eco Tribes** tab.
- In Guest mode, you're assigned to a simulated multiplayer tribe where you can text other members and press **Enter** to chat.
- Create an account using email or Google Sign-In, then create/join a live custom Tribe. Messages will poll and synchronize in real-time with other builders.

### 5. Carbon Battle Arena
- Navigate to the **Carbon Battle** tab.
- Compete directly with simulated or real tribe mates by matching your sustainability statistics.
- Click **"Challenge"** to see dual-card comparisons and dynamic outcome evaluations.

### 6. Quota Bypass (Developer settings)
- Click the **Gear settings icon** next to the user profile badge in the header.
- Provide your own Gemini API key (saved securely inside browser `localStorage`). A glowing green key badge appears in the header, and the app routes Gemini API queries using your personal key with **zero daily limits**!

---

## 🚀 Key Features
1. **Isometric 3D World Rendering:** Dynamically updates tree growth, solar panels, active wind turbines, waterfall spray, and weather effects based on player and community carbon levels.
2. **Dual-Mode AI Forest Guardian:** Supports local mock simulation or real-time Gemini 1.5 Flash AI connection for sustainability tips, carbon tracking, and gamified advice.
3. **AI Utility Bill Carbon Footprint Extraction:** Uses Gemini Multimodal AI to extract usage units, calculate carbon emissions, and award Green Energy and Nature Points.
4. **Developer Key Override:** Bypasses server-side daily API rate limits by enabling builders to input their own Gemini API key directly into the settings gear panel (cached safely in their browser's local storage).
5. **Secure Multiplayer & Tribes:** Integrates Firebase Auth (email & Google Sign-In) and Firestore mediated securely through a FastAPI backend to protect data integrity and prevent security rules violations.

---

## 🛠️ Local Development Setup

### 1. Prerequisites
- **Python 3.9+**
- **Docker** (Optional, for containerized local runs)
- A **Google AI Studio** Gemini API Key ([Get one here](https://aistudio.google.com/))
- A **Firebase Project** ([Create one here](https://console.firebase.google.com/))

### 2. Configure Local Settings
Clone this repository and create a `.env` file in the project root based on `.env.example`:

```ini
# Your Gemini API Key from Google AI Studio
GEMINI_API_KEY="your-gemini-api-key"

# Path to your Firebase service account JSON key file (e.g. ./firebase-adminsdk.json)
FIREBASE_SERVICE_ACCOUNT_KEY="./firebase-adminsdk.json"

# Firebase Client Configuration (Exposed dynamically to frontend)
FIREBASE_API_KEY="your-client-api-key"
FIREBASE_AUTH_DOMAIN="your-project-id.firebaseapp.com"
FIREBASE_PROJECT_ID="your-project-id"
FIREBASE_STORAGE_BUCKET="your-project-id.firebasestorage.app"
FIREBASE_MESSAGING_SENDER_ID="your-sender-id"
FIREBASE_APP_ID="your-app-id"
```

> [!NOTE]
> - Put your Firebase Admin SDK service account key JSON file in the root directory and name it `firebase-adminsdk.json`.
> - Both `.env` and `firebase-adminsdk.json` are listed in `.gitignore` to prevent sensitive credentials from leaking to git.

### 3. Run Locally (Virtual Environment)
1. **Create and activate a virtual environment:**
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```
2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```
3. **Launch the FastAPI app:**
   ```bash
   python app.py
   ```
4. Open [http://localhost:8000](http://localhost:8000) in your browser!

---

## 🐳 Containerized Local Execution
Verify the container builds and runs locally:
1. **Build the image:**
   ```bash
   docker build -t ecoverse:latest .
   ```
2. **Run the container:**
   ```bash
   docker run -d \
     -p 8080:8000 \
     -e PORT=8000 \
     --env-file .env \
     ecoverse:latest
   ```
3. Open [http://localhost:8080](http://localhost:8080) to inspect.

---

## ☁️ Google Cloud Deployment (Cloud Run)

To host the container serverlessly on GCP without exposing credentials:

### 1. Enable Required GCP APIs
Ensure Artifact Registry and Cloud Run APIs are enabled:
```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
```

### 2. Build and Push OCI Container
Cloud Run requires `linux/amd64` architecture. Build the image with cross-platform targets and push to your Artifact Registry:
```bash
# Authenticate Docker
gcloud auth configure-docker us-central1-docker.pkg.dev

# Create the repo in Artifact Registry
gcloud artifacts repositories create ecoverse-repo \
  --repository-format=docker \
  --location=us-central1

# Build container for AMD64
docker build --platform linux/amd64 -t us-central1-docker.pkg.dev/[PROJECT_ID]/ecoverse-repo/ecoverse:latest .

# Push to Artifact Registry
docker push us-central1-docker.pkg.dev/[PROJECT_ID]/ecoverse-repo/ecoverse:latest
```

### 3. Save Private Credentials in Secret Manager
Instead of exposing credentials, create secrets inside **GCP Secret Manager**:
1. Create a secret named `GEMINI_API_KEY` containing your Google AI Studio key.
2. Create a secret named `FIREBASE_ADMIN_SDK_JSON` containing the raw string contents of your `firebase-adminsdk.json` file.
3. Grant the default Compute service account access to read secrets:
   ```bash
   gcloud projects add-iam-policy-binding [PROJECT_ID] \
     --member="serviceAccount:[PROJECT_NUMBER]-compute@developer.gserviceaccount.com" \
     --role="roles/secretmanager.secretAccessor"
   ```

### 4. Deploy to Cloud Run
Deploy the application, linking secrets and providing client-side Firebase environment configurations:
```bash
gcloud run deploy ecoverse \
  --image us-central1-docker.pkg.dev/[PROJECT_ID]/ecoverse-repo/ecoverse:latest \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-secrets="GEMINI_API_KEY=GEMINI_API_KEY:latest" \
  --set-secrets="FIREBASE_ADMIN_SDK_JSON=FIREBASE_ADMIN_SDK_JSON:latest" \
  --set-env-vars="FIREBASE_API_KEY=[API_KEY],FIREBASE_AUTH_DOMAIN=[PROJECT_ID].firebaseapp.com,FIREBASE_PROJECT_ID=[PROJECT_ID],FIREBASE_STORAGE_BUCKET=[PROJECT_ID].firebasestorage.app,FIREBASE_MESSAGING_SENDER_ID=[SENDER_ID],FIREBASE_APP_ID=[APP_ID]"
```

---

## 🔒 Crucial Post-Deployment Step: Authorize Google Sign-In
If you use Google Sign-In in your auth tab, Firebase will block authentication requests from the live Cloud Run domain by default. 

**To resolve this:**
1. Go to the **Firebase Console** -> **Authentication** -> **Settings** tab.
2. Select **Authorized Domains** on the left menu.
3. Click **Add Domain** and insert your Cloud Run URL domains:
   - `[YOUR-SERVICE-NAME]-[PROJECT-NUMBER].us-central1.run.app`
   - `[YOUR-SERVICE-NAME]-cyuz5dcbsq-uc.a.run.app`
4. Save the changes. Google Sign-In will work immediately on the live app!
