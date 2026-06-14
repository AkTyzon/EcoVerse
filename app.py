# EcoVerse FastAPI Server
import os
import time
import random
import json
from datetime import date as datetime_date
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import google.generativeai as genai
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, auth as firebase_auth, firestore

# Load environment variables
load_dotenv(override=True)

app = FastAPI(title="EcoVerse API", description="Backend APIs for EcoVerse sustainability simulation")

# Configure Gemini if API Key is available
gemini_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
if gemini_key:
    genai.configure(api_key=gemini_key)
    print("Gemini API successfully configured.")
else:
    print("No Gemini API key found. Using rich local simulator for AI Companion.")

# Initialize Firebase Admin SDK
firebase_enabled = False
db_client = None

firebase_service_account = os.getenv("FIREBASE_SERVICE_ACCOUNT_KEY")
firebase_admin_sdk_json = os.getenv("FIREBASE_ADMIN_SDK_JSON")
firebase_project_id = os.getenv("FIREBASE_PROJECT_ID")

if firebase_admin_sdk_json:
    try:
        cred_info = json.loads(firebase_admin_sdk_json)
        cred = credentials.Certificate(cred_info)
        try:
            firebase_admin.initialize_app(cred)
        except ValueError:
            pass
        db_client = firestore.client()
        firebase_enabled = True
        print("Firebase Admin successfully initialized using FIREBASE_ADMIN_SDK_JSON environment variable.")
    except Exception as e:
        print(f"Failed to initialize Firebase Admin with FIREBASE_ADMIN_SDK_JSON: {e}")
elif firebase_service_account and os.path.exists(firebase_service_account):
    try:
        cred = credentials.Certificate(firebase_service_account)
        try:
            firebase_admin.initialize_app(cred)
        except ValueError:
            # Already initialized (e.g., during uvicorn reload)
            pass
        db_client = firestore.client()
        firebase_enabled = True
        print(f"Firebase Admin successfully initialized using service account: {firebase_service_account}")
    except Exception as e:
        print(f"Failed to initialize Firebase Admin with service account: {e}")
elif firebase_project_id:
    try:
        try:
            firebase_admin.initialize_app()
        except ValueError:
            # Already initialized
            pass
        db_client = firestore.client()
        firebase_enabled = True
        print("Firebase Admin successfully initialized using application default credentials.")
    except Exception as e:
        print(f"Failed to initialize Firebase Admin using default credentials: {e}")
else:
    print("No Firebase configuration found or active. Running in Local Mode (in-memory rate limit checking).")

# Local session tracking for query limits (mock fallback)
# Structure: { uid: { "count": int, "date": "YYYY-MM-DD" } }
local_query_registry = {}

def check_and_increment_limit(uid: str, is_guest: bool) -> tuple[bool, int, str]:
    """
    Checks if user is within their limit.
    Returns: (is_allowed, remaining_count, message)
    """
    if is_guest:
        return False, 0, "AI Mode is only available for registered builders. Please register or sign in to use the real AI Companion!"

    today_str = datetime_date.today().isoformat()
    daily_limit = 5
    
    limit_msg = f"You have reached your daily limit of {daily_limit} AI chats today. Please try again tomorrow, or switch back to Demo Mode to chat with the local simulation!"
    
    if firebase_enabled and db_client:
        try:
            # Query Firestore for this user
            user_ref = db_client.collection("users").document(uid).collection("stats").document("ai_limits")
            doc = user_ref.get()
            
            if doc.exists:
                data = doc.to_dict()
                last_reset = data.get("last_reset_date", "")
                count = data.get("ai_query_count", 0)
                
                if last_reset != today_str:
                    # Reset counter for a new day
                    user_ref.set({
                        "ai_query_count": 1,
                        "last_reset_date": today_str
                    }, merge=True)
                    return True, daily_limit - 1, ""
                
                if count >= daily_limit:
                    return False, 0, limit_msg
                
                # Increment count
                user_ref.update({
                    "ai_query_count": count + 1
                })
                return True, daily_limit - (count + 1), ""
            else:
                # Create record
                user_ref.set({
                    "ai_query_count": 1,
                    "last_reset_date": today_str
                })
                return True, daily_limit - 1, ""
        except Exception as e:
            print(f"Firestore limit check error: {e}. Falling back to in-memory check.")
            # Fall through to local query registry if Firestore fails
            
    if uid not in local_query_registry:
        local_query_registry[uid] = {
            "count": 1,
            "date": today_str
        }
        return True, daily_limit - 1, ""
    
    user_data = local_query_registry[uid]
    if user_data["date"] != today_str:
        user_data["count"] = 1
        user_data["date"] = today_str
        return True, daily_limit - 1, ""
        
    if user_data["count"] >= daily_limit:
        return False, 0, limit_msg
        
    user_data["count"] += 1
    return True, daily_limit - user_data["count"], ""

def get_user_limits(uid: str, is_guest: bool) -> tuple[int, int]:
    """
    Returns: (current_count, daily_limit)
    """
    if is_guest:
        return 0, 0
        
    today_str = datetime_date.today().isoformat()
    daily_limit = 5
    
    if firebase_enabled and db_client:
        try:
            user_ref = db_client.collection("users").document(uid).collection("stats").document("ai_limits")
            doc = user_ref.get()
            if doc.exists:
                data = doc.to_dict()
                last_reset = data.get("last_reset_date", "")
                count = data.get("ai_query_count", 0)
                if last_reset != today_str:
                    return 0, daily_limit
                return count, daily_limit
            return 0, daily_limit
        except Exception as e:
            print(f"Firestore get limits error: {e}")
            
    if uid not in local_query_registry:
        return 0, daily_limit
        
    user_data = local_query_registry[uid]
    if user_data["date"] != today_str:
        return 0, daily_limit
    return user_data["count"], daily_limit

async def get_uid_from_request(request: Request) -> tuple[str, bool]:
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        id_token = auth_header[7:]
        if id_token.startswith("mock_"):
            return id_token, True
        if firebase_enabled:
            try:
                decoded_token = firebase_auth.verify_id_token(id_token)
                # Check sign in provider to determine if they are an anonymous guest
                provider = decoded_token.get("firebase", {}).get("sign_in_provider", "")
                is_guest = (provider == "anonymous")
                return decoded_token["uid"], is_guest
            except Exception as e:
                print(f"Token verification failed: {e}")
                raise HTTPException(status_code=401, detail="Invalid Firebase session token. Please sign in again.")
        else:
            return f"local_{id_token[:20]}", True
            
    local_uid = request.headers.get("X-Local-User-Id")
    if local_uid:
        return f"local_{local_uid}", True
        
    client_host = request.client.host if request.client else "unknown_ip"
    return f"ip_{client_host}", True


# Define Pydantic models for request validation
class ChatRequest(BaseModel):
    message: str
    carbon_level: str  # e.g., 'very_low', 'low', 'average', 'high', 'very_high'
    green_energy: int
    nature_points: int
    demo_mode: bool = True

# Local rich fallback advisor response generator
def generate_local_fallback(message: str, carbon_level: str) -> str:
    msg = message.lower()
    
    # Strictly check if message is related to sustainability/ecology/EcoCity
    sustainability_keywords = [
        "carbon", "footprint", "emission", "eco", "green", "energy", "nature", "tree", "plant", 
        "solar", "wind", "recycle", "compost", "water", "gas", "bill", "electricity", "flight", 
        "travel", "commute", "bike", "cycle", "walk", "food", "vegetarian", "vegan", "meat", 
        "recipe", "challenge", "city", "island", "smog", "pollute", "forest", "guardian"
    ]
    
    # If none of the keywords are present, politely refuse to answer
    is_related = any(keyword in msg for keyword in sustainability_keywords)
    if not is_related:
        return "🦉 *The Forest Guardian looks at you gently...* \n\n" \
               "\"I am here to guide you on protecting our virtual island and lowering your carbon footprint! " \
               "Let's focus on green actions. Ask me about travel footprints, daily challenges, electricity tips, or recipes!\""
    
    # 1. Travel Advice
    if "fly" in msg or "flight" in msg or "travel" in msg or "mumbai" in msg or "delhi" in msg:
        co2_flight = random.randint(140, 180)
        co2_train = random.randint(15, 25)
        reduction = round(((co2_flight - co2_train) / co2_flight) * 100)
        return f"✈️ **Travel Carbon analysis:** Flying from Delhi to Mumbai generates approximately **{co2_flight} kg CO₂** per passenger. \n\n" \
               f"🚂 **Green Alternative:** Taking the train instead would emit only **{co2_train} kg CO₂**, a massive **{reduction}% reduction**!\n\n" \
               f"💡 **Forest Guardian Tip:** If you must fly, you can offset this trip by planting 8 virtual trees in your EcoCity (requiring 400 Green Energy) or logging 5 days of bicycle commuting. What do you think?"
               
    # 2. Challenge suggestion
    if "challenge" in msg or "daily" in msg or "today" in msg or "do next" in msg:
        challenges = [
            ("🚴 **Bike Commute Challenge:** Avoid using a car or ride-share today. Commute by cycle, walk, or take the metro. (Reward: +50 Green Energy)", "transport"),
            ("🥗 **Green Plate Challenge:** Eat entirely plant-based meals today (no meat or dairy). (Reward: +40 Green Energy)", "food"),
            ("🔌 **Vampire Power Challenge:** Unplug all electronics and chargers that are not actively in use. (Reward: +30 Green Energy)", "energy"),
            ("♻️ **Zero-Waste Hero:** Avoid using any single-use plastics today and log your recycling. (Reward: +35 Green Energy)", "waste")
        ]
        chosen = random.choice(challenges)
        return f"🌿 **Here is your daily Climate Challenge!**\n\n{chosen[0]}\n\n" \
               f"Let me know when you complete it! Completing this will instantly lower your carbon score and help clean up the rivers in your EcoVerse island."

    # 3. Energy bills or home advice
    if "energy" in msg or "bill" in msg or "electricity" in msg or "power" in msg:
        return "🔌 **Eco-Home Energy Advice:**\n\n" \
               "1. **Switch to LED bulbs**: They consume 75% less energy and last 25 times longer than incandescent lighting.\n" \
               "2. **Thermostat settings**: Lowering your thermostat by just 1°C in winter can reduce your heating bill by up to 10%.\n" \
               "3. **Unplug Standby Devices**: Standby power (vampire load) accounts for 5-10% of household electricity use.\n\n" \
               "🔋 *Tip:* Log your electricity savings in the logging panel to earn Green Energy to install Solar Panels on your island!"

    # 4. Vegetarian / Food
    if "food" in msg or "vegetarian" in msg or "vegan" in msg or "meat" in msg or "recipe" in msg:
        return "🥗 **Sustainable Diet Advisor:**\n\n" \
               "A plant-based meal has a carbon footprint that is up to **70% smaller** than a meat-heavy meal. Beef alone generates 60 kg of greenhouse gases per kg of meat, compared to just 0.9 kg for peas.\n\n" \
               "🌱 **Quick Recipe Idea (Eco-Bowl):** Quinoa base, roasted chickpeas, steamed broccoli, avocado, tahini-lemon dressing. Healthy for you, healthy for the planet!"

    # Default responses based on carbon level
    if carbon_level in ["high", "very_high"]:
        return "🦉 *The Forest Guardian looks concerned...* \n\n" \
               "Your island is currently shrouded in smog and the rivers look polluted. Don't worry, we can fix this! " \
               "I suggest we start with simple actions: **log a vegetarian meal** or **unplug idle appliances** today. " \
               "Every action will clean up the smog and make the sky blue again. What green action would you like to log first?"
    else:
        return "🌳 *The Forest Guardian smiles warmly!* \n\n" \
               "Your island is looking beautiful, with emerald skies and active wildlife. " \
               "To maintain this level, you can keep logging daily green streaks. " \
               "Would you like to try a **Climate Challenge** today to unlock rare landmarks or boost your tribe's progress?"

@app.post("/api/ai-chat")
async def ai_chat(req: ChatRequest, request: Request):
    # Dynamically reload environment in case key is updated
    load_dotenv(override=True)
    custom_key = request.headers.get("X-Gemini-API-Key")
    active_key = custom_key or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    
    if not req.demo_mode and active_key:
        if not custom_key:
            uid, is_guest = await get_uid_from_request(request)
            allowed, remaining, err_msg = check_and_increment_limit(uid, is_guest)
            if not allowed:
                return {"reply": f"🦉 *The Forest Guardian holds up a wing...* \n\n\"{err_msg}\""}
            
        try:
            # We construct a strict system instruction for Gemini to act as the companion
            system_prompt = (
                f"You are the 'Forest Guardian' (or 'Eco Owl'), a friendly and wise animated companion "
                f"living in the user's multiplayer sustainability world called 'EcoVerse'.\n"
                f"The user's current carbon/environmental level is: '{req.carbon_level.replace('_', ' ')}'.\n"
                f"Their stats: Green Energy = {req.green_energy}, Nature Points = {req.nature_points}.\n"
                f"Your role is to give helpful, positive, and gamified advice.\n"
                f"If they ask about travel, calculate approximate emissions (e.g. flights generate ~150-200 kg CO2, trains generate ~80-90% less) "
                f"and relate it to how it affects their virtual virtual island (e.g. high carbon causes smog and dry trees, green actions grow forests).\n"
                f"Be conversational, concise, and encourage friendly tribe competition. Use bullet points and emojis.\n"
                f"CRITICAL DOMAIN SAFETY RULE: You must ONLY answer questions, discuss topics, or assist with tasks related to ecology, sustainability, climate change, carbon footprints, green energy, environmental conservation, recycling/composting, eco-friendly lifestyle choices, and the EcoVerse game itself. "
                f"If the user asks about unrelated topics (such as writing software code, math, history, general programming, general knowledge, or unrelated tasks), you must politely but firmly refuse to answer. Suggest a green task or action instead. Maintain your character as the Forest Guardian at all times."
            )
            
            # Initialize model
            genai.configure(api_key=active_key)
            model = genai.GenerativeModel('gemini-flash-latest', system_instruction=system_prompt)
            
            # Generate response
            response = model.generate_content(req.message)
            return {"reply": response.text}
        except Exception as e:
            print(f"Gemini API Error: {str(e)}. Falling back to local responder.")
            return {"reply": generate_local_fallback(req.message, req.carbon_level)}
    else:
        # Simulate small network delay for authenticity
        time.sleep(0.8)
        # Check if real mode was requested but key is missing
        if not req.demo_mode and not active_key:
            return {"reply": "🦉 *The Forest Guardian looks at you...* \n\n\"I tried to connect to the real Gemini AI network, but your API Key is missing! Please configure `GEMINI_API_KEY` in the server `.env` file, set your custom key in **Settings**, or toggle back to **Demo Mode** to chat with my simulated self.\""}
        return {"reply": generate_local_fallback(req.message, req.carbon_level)}

@app.post("/api/utility-bill")
async def upload_utility_bill(
    request: Request,
    file: UploadFile = File(...),
    bill_type: str = Form("electricity"),  # electricity, water, gas
    demo_mode: bool = Form(True)
):
    if demo_mode:
        # Simulate processing time for AI analysis
        time.sleep(2.0)
        
        # Generate some realistic footprint data
        if bill_type == "electricity":
            units = random.randint(180, 320)
            co2_emitted = round(units * 0.85, 1) # ~0.85 kg CO2 per kWh in carbon heavy grids
            avg_co2 = 250.0
            
            # Calculate comparison
            diff = round(((co2_emitted - avg_co2) / avg_co2) * 100, 1)
            if diff < 0:
                status = "efficient"
                energy_reward = 200
                points_reward = 80
                msg = f"🎉 Excellent! Your bill shows {units} kWh used, which is {abs(diff)}% below the neighborhood average. Your sky aura gets a green boost!"
            else:
                status = "high"
                energy_reward = 120  # Still reward for logging!
                points_reward = 30
                msg = f"🔌 Your bill shows {units} kWh used, which is {diff}% above the neighborhood average. Consider setting a daily 'Vampire Power' challenge to optimize this next month."
                
            return {
                "success": True,
                "filename": file.filename,
                "bill_type": bill_type,
                "metrics": {
                    "units": f"{units} kWh",
                    "carbon_footprint": f"{co2_emitted} kg CO₂",
                    "status": status,
                    "comparison": f"{abs(diff)}% {'lower' if diff < 0 else 'higher'} than regional average"
                },
                "rewards": {
                    "green_energy": energy_reward,
                    "nature_points": points_reward
                },
                "message": msg
            }
        else:
            # Other bill types
            units = random.randint(10, 30)
            co2_emitted = round(units * 12.5, 1) # kg CO2
            unit_label = "m³" if bill_type == "gas" else "Units"
            return {
                "success": True,
                "filename": file.filename,
                "bill_type": bill_type,
                "metrics": {
                    "units": f"{units} {unit_label}",
                    "carbon_footprint": f"{co2_emitted} kg CO₂",
                    "status": "efficient",
                    "comparison": "12% lower than regional average"
                },
                "rewards": {
                    "green_energy": 150,
                    "nature_points": 50
                },
                "message": "🌍 Thanks for logging! Your utility consumption details have been verified, adding resources to your eco arsenal."
            }
    else:
        # AI integration with Gemini 1.5 Flash
        load_dotenv(override=True)
        custom_key = request.headers.get("X-Gemini-API-Key")
        active_key = custom_key or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        
        if not active_key:
            return {
                "success": False,
                "error": "Gemini API key is not configured. Please add GEMINI_API_KEY to your .env file, configure your custom key in Settings, or enable Demo Mode."
            }
        
        if not custom_key:
            uid, is_guest = await get_uid_from_request(request)
            allowed, remaining, err_msg = check_and_increment_limit(uid, is_guest)
            if not allowed:
                return {
                    "success": False,
                    "error": err_msg
                }
            
        try:
            # Load the file bytes and mime type
            file_bytes = await file.read()
            mime_type = file.content_type or "application/octet-stream"
            
            # Configure model
            genai.configure(api_key=active_key)
            model = genai.GenerativeModel('gemini-flash-latest')
            
            prompt = (
                f"You are the Forest Guardian analyzing a utility bill upload of type '{bill_type}'.\n"
                f"First, inspect the document carefully. If the document is NOT a utility bill at all (e.g., it is a photo of a pet, a random book page, a blank document, or completely unrelated to a utility bill) or if it does not contain utility consumption information corresponding to '{bill_type}', you MUST return a JSON object with a single key 'error' containing a detailed explanation of why the document cannot be processed (e.g., 'The uploaded file does not appear to be a valid {bill_type} bill. Please upload a clear image or PDF of your utility statement.').\n"
                f"Otherwise, if it is a valid bill, extract the consumption details and return them strictly in a JSON object with these keys:\n"
                f"- 'units': The numeric value of consumption (e.g. kWh for electricity, gallons/liters/m3 for water, therms/m3 for gas).\n"
                f"- 'units_label': The unit string (e.g. 'kWh', 'liters', 'm³').\n"
                f"- 'carbon_footprint': The estimated carbon footprint in kg CO2. If not specified on the bill, estimate it. For electricity, assume 0.85 kg CO2 per kWh. For water, assume 0.0003 kg CO2 per liter. For gas, assume 5.3 kg CO2 per therm or 2.0 kg CO2 per m³.\n"
                f"- 'status': Either 'efficient' (if below regional average) or 'high' (if above average). Averages for reference:\n"
                f"  - Electricity: 250 kWh/month\n"
                f"  - Water: 15,000 liters/month\n"
                f"  - Gas: 30 therms/month or 40 m³/month\n"
                f"- 'comparison': Description of comparison with average (e.g. '14.2% lower than average' or '5% higher than average').\n"
                f"- 'message': A brief, friendly, gamified message from the 'Forest Guardian' summarizing the bill analysis and giving one tip to reduce emissions.\n"
                f"Make sure to return only the JSON object."
            )
            
            contents = [
                {
                    "mime_type": mime_type,
                    "data": file_bytes
                },
                prompt
            ]
            
            # Run model
            response = model.generate_content(
                contents,
                generation_config={"response_mime_type": "application/json"}
            )
            
            # Parse output
            response_text = response.text.strip()
            if response_text.startswith("```json"):
                response_text = response_text[7:]
            if response_text.endswith("```"):
                response_text = response_text[:-3]
            response_text = response_text.strip()
            
            parsed_data = json.loads(response_text)
            if "error" in parsed_data:
                return {
                    "success": False,
                    "error": parsed_data["error"]
                }
            
            # Map rewards based on status
            status = parsed_data.get("status", "efficient").lower()
            if status == "efficient":
                energy_reward = 200
                points_reward = 80
            else:
                energy_reward = 120
                points_reward = 30
                
            units_val = parsed_data.get("units", 0)
            units_lbl = parsed_data.get("units_label", "Units")
            co2_val = parsed_data.get("carbon_footprint", 0)
            
            return {
                "success": True,
                "filename": file.filename,
                "bill_type": bill_type,
                "metrics": {
                    "units": f"{units_val} {units_lbl}",
                    "carbon_footprint": f"{co2_val} kg CO₂",
                    "status": status,
                    "comparison": parsed_data.get("comparison", "Calculated by AI")
                },
                "rewards": {
                    "green_energy": energy_reward,
                    "nature_points": points_reward
                },
                "message": parsed_data.get("message", "AI extraction complete!")
            }
            
        except Exception as e:
            err_str = str(e)
            print(f"Error in Gemini bill analyzer: {err_str}")
            
            friendly_err = f"AI extraction failed: {err_str}. Please check your bill format/connection."
            if "429" in err_str or "quota" in err_str.lower() or "exhausted" in err_str.lower():
                friendly_err = "⚠️ Gemini API Quota Exceeded: You have exceeded the free tier daily rate limit (20 requests). Please toggle back to **Demo Mode** in the top-right panel to continue testing utility uploads without any restrictions, or try again later."
                
            return {
                "success": False,
                "error": friendly_err
            }

@app.get("/api/firebase-config")
async def get_firebase_config():
    return {
        "firebase_enabled": firebase_enabled,
        "config": {
            "apiKey": os.getenv("FIREBASE_API_KEY", ""),
            "authDomain": os.getenv("FIREBASE_AUTH_DOMAIN", ""),
            "projectId": os.getenv("FIREBASE_PROJECT_ID", ""),
            "storageBucket": os.getenv("FIREBASE_STORAGE_BUCKET", ""),
            "messagingSenderId": os.getenv("FIREBASE_MESSAGING_SENDER_ID", ""),
            "appId": os.getenv("FIREBASE_APP_ID", "")
        }
    }

@app.get("/api/user-limits")
async def user_limits(request: Request):
    uid, is_guest = await get_uid_from_request(request)
    count, limit = get_user_limits(uid, is_guest)
    return {
        "count": count,
        "limit": limit,
        "remaining": max(0, limit - count)
    }

# ==========================================
# CENTRALIZED SECURE MULTIPLAYER API (FIRESTORE)
# ==========================================

class ProfileRequest(BaseModel):
    displayName: str
    email: str
    carbonScore: int
    greenEnergy: int
    naturePoints: int
    treesCount: int
    solarUnits: int
    riverClean: bool
    wildlifeActive: bool

class CreateTribeRequest(BaseModel):
    name: str
    invitedUids: list[str]

class JoinTribeRequest(BaseModel):
    tribeId: str

class ChatMessageRequest(BaseModel):
    text: str

class ContributeRequest(BaseModel):
    count: int = 1

# In-memory registries for Local/Mock fallback mode
local_user_profiles = {
    "sarah_uid": {
        "uid": "sarah_uid",
        "displayName": "Sarah",
        "email": "sarah@ecoverse.org",
        "carbonScore": 65,
        "greenEnergy": 450,
        "naturePoints": 320,
        "treesCount": 8,
        "solarUnits": 2,
        "riverClean": True,
        "wildlifeActive": False
    },
    "david_uid": {
        "uid": "david_uid",
        "displayName": "David",
        "email": "david@ecoverse.org",
        "carbonScore": 120,
        "greenEnergy": 150,
        "naturePoints": 120,
        "treesCount": 3,
        "solarUnits": 0,
        "riverClean": False,
        "wildlifeActive": False
    },
    "marcus_uid": {
        "uid": "marcus_uid",
        "displayName": "Marcus",
        "email": "marcus@ecoverse.org",
        "carbonScore": 180,
        "greenEnergy": 50,
        "naturePoints": 45,
        "treesCount": 0,
        "solarUnits": 0,
        "riverClean": False,
        "wildlifeActive": False
    }
}

local_user_states = {
    "sarah_uid": {
        "carbonScore": 65,
        "greenEnergy": 450,
        "naturePoints": 320,
        "treesCount": 8,
        "solarUnits": 2,
        "riverClean": True,
        "wildlifeActive": False
    },
    "david_uid": {
        "carbonScore": 120,
        "greenEnergy": 150,
        "naturePoints": 120,
        "treesCount": 3,
        "solarUnits": 0,
        "riverClean": False,
        "wildlifeActive": False
    },
    "marcus_uid": {
        "carbonScore": 180,
        "greenEnergy": 50,
        "naturePoints": 45,
        "treesCount": 0,
        "solarUnits": 0,
        "riverClean": False,
        "wildlifeActive": False
    }
}

local_tribes = {
    "solar_squad_id": {
        "id": "solar_squad_id",
        "name": "Solar Squad",
        "creatorUid": "sarah_uid",
        "members": ["sarah_uid", "david_uid"],
        "weeklyGoal": 1000,
        "progress": 250
    }
}

local_tribe_messages = {
    "solar_squad_id": [
        {
            "id": "msg1",
            "sender": "Sarah",
            "senderUid": "sarah_uid",
            "text": "Hey Solar Squad! Let's get our carbon score down this week! ☀️",
            "timestamp": int((time.time() - 3600) * 1000)
        },
        {
            "id": "msg2",
            "sender": "David",
            "senderUid": "david_uid",
            "text": "Count me in! I am planning to add solar panels today.",
            "timestamp": int((time.time() - 1800) * 1000)
        }
    ]
}

local_global_stats = {
    "totalTrees": 843219,
    "totalCarbon": 142500
}

@app.post("/api/multiplayer/profile")
async def sync_profile(req: ProfileRequest, request: Request):
    uid, is_guest = await get_uid_from_request(request)
    if is_guest:
        return {"success": False, "error": "Guests cannot sync profile"}
    
    # Always keep local fallbacks in sync
    local_user_profiles[uid] = {
        "uid": uid,
        "displayName": req.displayName,
        "email": req.email,
        "carbonScore": req.carbonScore,
        "greenEnergy": req.greenEnergy,
        "naturePoints": req.naturePoints,
        "treesCount": req.treesCount,
        "solarUnits": req.solarUnits,
        "riverClean": req.riverClean,
        "wildlifeActive": req.wildlifeActive
    }
    local_user_states[uid] = {
        "carbonScore": req.carbonScore,
        "greenEnergy": req.greenEnergy,
        "naturePoints": req.naturePoints,
        "treesCount": req.treesCount,
        "solarUnits": req.solarUnits,
        "riverClean": req.riverClean,
        "wildlifeActive": req.wildlifeActive
    }
    
    if firebase_enabled and db_client:
        try:
            db_client.collection("users").document(uid).set({
                "uid": uid,
                "displayName": req.displayName,
                "email": req.email,
                "carbonScore": req.carbonScore,
                "greenEnergy": req.greenEnergy,
                "naturePoints": req.naturePoints,
                "treesCount": req.treesCount,
                "solarUnits": req.solarUnits,
                "riverClean": req.riverClean,
                "wildlifeActive": req.wildlifeActive,
                "isAnonymous": False,
                "updatedAt": firestore.SERVER_TIMESTAMP
            }, merge=True)
            return {"success": True}
        except Exception as e:
            print(f"Error syncing profile to Firestore: {e}. Using local fallback.")
            return {"success": True, "note": "Synced to local session fallback"}
            
    return {"success": True, "note": "Synced to local session"}

@app.get("/api/multiplayer/users")
async def get_multiplayer_users(request: Request):
    uid, is_guest = await get_uid_from_request(request)
    if is_guest:
        return {"success": False, "error": "Guests cannot list users"}
    
    users = []
    if firebase_enabled and db_client:
        try:
            users_ref = db_client.collection("users").where("isAnonymous", "==", False).limit(100).get()
            for u in users_ref:
                data = u.to_dict()
                if data.get("uid") != uid:
                    users.append({
                        "uid": data.get("uid"),
                        "displayName": data.get("displayName", "Eco Builder"),
                        "carbonScore": data.get("carbonScore", 150),
                        "treesCount": data.get("treesCount", 0),
                        "solarUnits": data.get("solarUnits", 0),
                        "riverClean": data.get("riverClean", False),
                        "wildlifeActive": data.get("wildlifeActive", False),
                        "naturePoints": data.get("naturePoints", 0)
                    })
            return {"success": True, "users": users}
        except Exception as e:
            print(f"Error listing users from Firestore: {e}. Using local fallback.")
            
    # Local fallback
    for target_uid, data in local_user_profiles.items():
        if target_uid != uid:
            users.append({
                "uid": data.get("uid"),
                "displayName": data.get("displayName", "Eco Builder"),
                "carbonScore": data.get("carbonScore", 150),
                "treesCount": data.get("treesCount", 0),
                "solarUnits": data.get("solarUnits", 0),
                "riverClean": data.get("riverClean", False),
                "wildlifeActive": data.get("wildlifeActive", False),
                "naturePoints": data.get("naturePoints", 0)
            })
    return {"success": True, "users": users}

@app.post("/api/multiplayer/tribe/create")
async def create_tribe(req: CreateTribeRequest, request: Request):
    uid, is_guest = await get_uid_from_request(request)
    if is_guest:
        return {"success": False, "error": "Guests cannot create tribes"}
        
    tribe_id = "tribe_" + str(int(time.time()))
    members = [uid] + req.invitedUids
    
    # Update local fallback
    local_tribes[tribe_id] = {
        "id": tribe_id,
        "name": req.name,
        "creatorUid": uid,
        "members": members,
        "weeklyGoal": 1000,
        "progress": 0
    }
    local_tribe_messages[tribe_id] = []
    
    if firebase_enabled and db_client:
        try:
            new_ref = db_client.collection("tribes").document()
            new_ref.set({
                "id": new_ref.id,
                "name": req.name,
                "creatorUid": uid,
                "members": members,
                "weeklyGoal": 1000,
                "progress": 0,
                "createdAt": firestore.SERVER_TIMESTAMP
            })
            return {"success": True, "tribeId": new_ref.id}
        except Exception as e:
            print(f"Error creating tribe in Firestore: {e}. Using local fallback.")
            return {"success": True, "tribeId": tribe_id, "note": "Created in local fallback"}
            
    return {"success": True, "tribeId": tribe_id}

@app.post("/api/multiplayer/tribe/join")
async def join_tribe(req: JoinTribeRequest, request: Request):
    uid, is_guest = await get_uid_from_request(request)
    if is_guest:
        return {"success": False, "error": "Guests cannot join tribes"}
        
    # Update local fallback
    if req.tribeId in local_tribes:
        if uid not in local_tribes[req.tribeId]["members"]:
            local_tribes[req.tribeId]["members"].append(uid)
            
    if firebase_enabled and db_client:
        try:
            tribe_ref = db_client.collection("tribes").document(req.tribeId)
            tribe_ref.update({
                "members": firestore.ArrayUnion([uid])
            })
            return {"success": True}
        except Exception as e:
            print(f"Error joining tribe in Firestore: {e}. Using local fallback.")
            return {"success": True, "note": "Joined local fallback tribe"}
            
    return {"success": True}

@app.post("/api/multiplayer/tribe/leave")
async def leave_tribe(request: Request):
    uid, is_guest = await get_uid_from_request(request)
    if is_guest:
        return {"success": False, "error": "Guests cannot leave tribes"}
        
    # Update local fallback
    for t_id, t_data in list(local_tribes.items()):
        if uid in t_data.get("members", []):
            t_data["members"].remove(uid)
            if len(t_data["members"]) == 0:
                del local_tribes[t_id]
                if t_id in local_tribe_messages:
                    del local_tribe_messages[t_id]
                    
    if firebase_enabled and db_client:
        try:
            tribes = db_client.collection("tribes").where("members", "array_contains", uid).limit(1).get()
            if tribes:
                tribe_id = tribes[0].id
                db_client.collection("tribes").document(tribe_id).update({
                    "members": firestore.ArrayRemove([uid])
                })
            return {"success": True}
        except Exception as e:
            print(f"Error leaving tribe in Firestore: {e}. Using local fallback.")
            return {"success": True, "note": "Left local fallback tribe"}
            
    return {"success": True}

@app.get("/api/multiplayer/tribe")
async def get_tribe_details(request: Request):
    uid, is_guest = await get_uid_from_request(request)
    if is_guest:
        return {"success": False, "error": "Guests cannot access tribes"}
        
    if firebase_enabled and db_client:
        try:
            tribes = db_client.collection("tribes").where("members", "array_contains", uid).limit(1).get()
            if tribes:
                tribe_data = tribes[0].to_dict()
                members_data = []
                for m_uid in tribe_data.get("members", []):
                    m_doc = db_client.collection("users").document(m_uid).get()
                    if m_doc.exists:
                        m_dict = m_doc.to_dict()
                        members_data.append({
                            "uid": m_dict.get("uid"),
                            "displayName": m_dict.get("displayName", "Eco Builder"),
                            "carbonScore": m_dict.get("carbonScore", 150),
                            "treesCount": m_dict.get("treesCount", 0),
                            "solarUnits": m_dict.get("solarUnits", 0),
                            "riverClean": m_dict.get("riverClean", False)
                        })
                    else:
                        members_data.append({
                            "uid": m_uid,
                            "displayName": "Eco Builder",
                            "carbonScore": 150,
                            "treesCount": 0,
                            "solarUnits": 0,
                            "riverClean": False
                        })
                return {
                    "success": True,
                    "hasTribe": True,
                    "tribe": {
                        "id": tribe_data.get("id"),
                        "name": tribe_data.get("name"),
                        "creatorUid": tribe_data.get("creatorUid"),
                        "members": tribe_data.get("members", []),
                        "weeklyGoal": tribe_data.get("weeklyGoal", 1000)
                    },
                    "members": members_data
                }
            else:
                public_tribes_ref = db_client.collection("tribes").limit(20).get()
                public_tribes = []
                for t in public_tribes_ref:
                    t_data = t.to_dict()
                    public_tribes.append({
                        "id": t_data.get("id"),
                        "name": t_data.get("name"),
                        "membersCount": len(t_data.get("members", [])),
                        "weeklyGoal": t_data.get("weeklyGoal", 1000)
                    })
                return {
                    "success": True,
                    "hasTribe": False,
                    "publicTribes": public_tribes
                }
        except Exception as e:
            print(f"Error fetching tribe from Firestore: {e}. Falling back to in-memory.")
            
    # Local fallback
    my_tribe = None
    for t_id, t_data in local_tribes.items():
        if uid in t_data.get("members", []):
            my_tribe = t_data
            break
            
    if my_tribe:
        members_data = []
        for m_uid in my_tribe.get("members", []):
            m_data = local_user_profiles.get(m_uid)
            if m_uid == uid:
                m_data = local_user_profiles.get(uid) or {
                    "uid": uid,
                    "displayName": "Eco Builder (You)",
                    "carbonScore": 150,
                    "treesCount": 0,
                    "solarUnits": 0,
                    "riverClean": False
                }
            if m_data:
                members_data.append({
                    "uid": m_data.get("uid"),
                    "displayName": m_data.get("displayName", "Eco Builder"),
                    "carbonScore": m_data.get("carbonScore", 150),
                    "treesCount": m_data.get("treesCount", 0),
                    "solarUnits": m_data.get("solarUnits", 0),
                    "riverClean": m_data.get("riverClean", False)
                })
            else:
                members_data.append({
                    "uid": m_uid,
                    "displayName": "Eco Builder",
                    "carbonScore": 150,
                    "treesCount": 0,
                    "solarUnits": 0,
                    "riverClean": False
                })
        return {
            "success": True,
            "hasTribe": True,
            "tribe": {
                "id": my_tribe.get("id"),
                "name": my_tribe.get("name"),
                "creatorUid": my_tribe.get("creatorUid"),
                "members": my_tribe.get("members", []),
                "weeklyGoal": my_tribe.get("weeklyGoal", 1000)
            },
            "members": members_data
        }
    else:
        public_tribes = []
        for t_id, t_data in local_tribes.items():
            public_tribes.append({
                "id": t_data.get("id"),
                "name": t_data.get("name"),
                "membersCount": len(t_data.get("members", [])),
                "weeklyGoal": t_data.get("weeklyGoal", 1000)
            })
        return {
            "success": True,
            "hasTribe": False,
            "publicTribes": public_tribes
        }

@app.post("/api/multiplayer/tribe/chat")
async def send_tribe_chat_message(req: ChatMessageRequest, request: Request):
    uid, is_guest = await get_uid_from_request(request)
    if is_guest:
        return {"success": False, "error": "Guests cannot send chat messages"}
        
    sender_name = "Eco Builder"
    my_profile = local_user_profiles.get(uid)
    if my_profile:
        sender_name = my_profile.get("displayName", "Eco Builder")
        
    # Find active local tribe for member
    my_tribe_id = None
    for t_id, t_data in local_tribes.items():
        if uid in t_data.get("members", []):
            my_tribe_id = t_id
            break
            
    if my_tribe_id:
        if my_tribe_id not in local_tribe_messages:
            local_tribe_messages[my_tribe_id] = []
        msg_id = "msg_" + str(int(time.time() * 1000))
        local_tribe_messages[my_tribe_id].append({
            "id": msg_id,
            "sender": sender_name,
            "senderUid": uid,
            "text": req.text,
            "timestamp": int(time.time() * 1000)
        })
        if len(local_tribe_messages[my_tribe_id]) > 50:
            local_tribe_messages[my_tribe_id].pop(0)
            
    if firebase_enabled and db_client:
        try:
            tribes = db_client.collection("tribes").where("members", "array_contains", uid).limit(1).get()
            if not tribes:
                return {"success": False, "error": "User is not in a tribe"}
            tribe_id = tribes[0].id
            sender_doc = db_client.collection("users").document(uid).get()
            sender_name_db = sender_doc.to_dict().get("displayName", "Eco Builder") if sender_doc.exists else "Eco Builder"
            msg_ref = db_client.collection("tribes").document(tribe_id).collection("messages").document()
            msg_ref.set({
                "id": msg_ref.id,
                "sender": sender_name_db,
                "senderUid": uid,
                "text": req.text,
                "timestamp": firestore.SERVER_TIMESTAMP
            })
            return {"success": True}
        except Exception as e:
            print(f"Error sending chat message in Firestore: {e}. Using local fallback.")
            return {"success": True, "note": "Sent to local fallback chat"}
            
    if my_tribe_id:
        return {"success": True}
    return {"success": False, "error": "User is not in a tribe"}

@app.get("/api/multiplayer/tribe/chat")
async def get_tribe_chat_messages(request: Request):
    uid, is_guest = await get_uid_from_request(request)
    if is_guest:
        return {"success": False, "error": "Guests cannot read chat messages"}
        
    if firebase_enabled and db_client:
        try:
            tribes = db_client.collection("tribes").where("members", "array_contains", uid).limit(1).get()
            if tribes:
                tribe_id = tribes[0].id
                messages_ref = db_client.collection("tribes").document(tribe_id).collection("messages")\
                    .order_by("timestamp", direction=firestore.Query.ASCENDING).limit(50).get()
                messages = []
                for m in messages_ref:
                    m_data = m.to_dict()
                    ts = m_data.get("timestamp")
                    timestamp_ms = int(ts.timestamp() * 1000) if ts else int(time.time() * 1000)
                    messages.append({
                        "sender": m_data.get("sender", "Eco Builder"),
                        "senderUid": m_data.get("senderUid"),
                        "text": m_data.get("text", ""),
                        "timestamp": timestamp_ms
                    })
                return {"success": True, "messages": messages}
            else:
                return {"success": True, "messages": []}
        except Exception as e:
            print(f"Error loading chat messages from Firestore: {e}. Using local fallback.")
            
    # Local fallback
    my_tribe_id = None
    for t_id, t_data in local_tribes.items():
        if uid in t_data.get("members", []):
            my_tribe_id = t_id
            break
            
    if my_tribe_id and my_tribe_id in local_tribe_messages:
        return {"success": True, "messages": local_tribe_messages[my_tribe_id]}
        
    return {"success": True, "messages": []}

@app.get("/api/multiplayer/global-stats")
async def get_global_stats(request: Request):
    if firebase_enabled and db_client:
        try:
            doc = db_client.collection("global_planet").document("stats").get()
            if doc.exists:
                data = doc.to_dict()
                return {
                    "success": True,
                    "totalTrees": data.get("totalTrees", 843219),
                    "totalCarbon": data.get("totalCarbon", 142500)
                }
        except Exception as e:
            print(f"Error fetching global stats from Firestore: {e}. Using local fallback.")
            
    return {
        "success": True,
        "totalTrees": local_global_stats["totalTrees"],
        "totalCarbon": local_global_stats["totalCarbon"]
    }

@app.post("/api/multiplayer/global-stats/contribute")
async def contribute_global_stats(req: ContributeRequest, request: Request):
    uid, is_guest = await get_uid_from_request(request)
    if is_guest:
        return {"success": False, "error": "Guests cannot contribute to global event"}
        
    if req.count < 1:
        return {"success": False, "error": "Contribution count must be at least 1"}
        
    # Increment local fallback stats
    local_global_stats["totalTrees"] += req.count
    local_global_stats["totalCarbon"] += req.count * 25
    
    if firebase_enabled and db_client:
        try:
            db_client.collection("global_planet").document("stats").set({
                "totalTrees": firestore.Increment(req.count),
                "totalCarbon": firestore.Increment(req.count * 25)
            }, merge=True)
            return {"success": True}
        except Exception as e:
            print(f"Error contributing to global stats in Firestore: {e}. Using local fallback.")
            return {"success": True, "note": "Contributed to local fallback stats"}
            
    return {"success": True, "note": "Contributed to local fallback stats"}

@app.get("/api/multiplayer/user-state/{target_uid}")
async def get_target_user_state(target_uid: str, request: Request):
    uid, is_guest = await get_uid_from_request(request)
    if is_guest:
        return {"success": False, "error": "Guests cannot visit other users"}
        
    if firebase_enabled and db_client:
        try:
            doc = db_client.collection("users").document(target_uid).collection("game_state").document("data").get()
            if doc.exists:
                return {"success": True, "state": doc.to_dict()}
        except Exception as e:
            print(f"Error loading user state from Firestore: {e}. Using local fallback.")
            
    # Local fallback
    if target_uid in local_user_states:
        return {"success": True, "state": local_user_states[target_uid]}
        
    return {
        "success": True,
        "state": {
            "carbonScore": 150,
            "greenEnergy": 0,
            "naturePoints": 0,
            "treesCount": 0,
            "solarUnits": 0,
            "riverClean": False,
            "wildlifeActive": False
        }
    }

# Serve static frontend files
# First, ensure static folder exists
os.makedirs("static", exist_ok=True)

# Mount the static directory
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
