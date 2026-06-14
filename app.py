"""
EcoVerse FastAPI Server
=======================
Climate-action sustainability simulation backend.

Exposes REST APIs for:
- AI chat companion (Gemini + rich local fallback)
- Utility-bill carbon analysis
- Firebase Auth / Firestore multiplayer (profile, tribes, chat, global stats)
- Graceful local-memory fallback when Firebase / Gemini are unavailable
"""

import asyncio
import logging
import os
import random
import time
import json
from datetime import date as datetime_date
from typing import Optional

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
import google.generativeai as genai
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, auth as firebase_auth, firestore

# ---------------------------------------------------------------------------
# Logging configuration
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s – %(message)s",
)
logger = logging.getLogger("ecoverse")

# Load environment variables
load_dotenv(override=True)

# ---------------------------------------------------------------------------
# Application constants
# ---------------------------------------------------------------------------
DAILY_AI_LIMIT: int = 5
MAX_TRIBE_MESSAGES: int = 50
DEFAULT_WEEKLY_GOAL: int = 1000
DEFAULT_DISPLAY_NAME: str = "Eco Builder"
DEFAULT_CARBON_SCORE: int = 150
CO2_PER_KWH: float = 0.85          # kg CO₂ per kWh (carbon-heavy grid)
CO2_PER_GAS_UNIT: float = 12.5     # kg CO₂ per gas unit
ELECTRICITY_AVG_KWH: float = 250.0  # Monthly regional average

# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------
app = FastAPI(
    title="EcoVerse API",
    description="Backend APIs for EcoVerse – a multiplayer climate-action simulation.",
    version="1.0.0",
)

# ---------------------------------------------------------------------------
# Gemini AI configuration
# ---------------------------------------------------------------------------
gemini_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
if gemini_key:
    genai.configure(api_key=gemini_key)
    logger.info("Gemini API successfully configured.")
else:
    logger.warning("No Gemini API key found. Using rich local simulator for AI Companion.")

# ---------------------------------------------------------------------------
# Firebase Admin SDK initialisation
# ---------------------------------------------------------------------------
firebase_enabled: bool = False
db_client = None

firebase_service_account = os.getenv("FIREBASE_SERVICE_ACCOUNT_KEY")
firebase_admin_sdk_json = os.getenv("FIREBASE_ADMIN_SDK_JSON")
firebase_project_id = os.getenv("FIREBASE_PROJECT_ID")


def _init_firebase_app(cred=None) -> None:
    """Initialise the Firebase Admin app, ignoring duplicate-initialisation errors."""
    try:
        if cred:
            firebase_admin.initialize_app(cred)
        else:
            firebase_admin.initialize_app()
    except ValueError:
        # App already initialised (e.g., during uvicorn hot-reload)
        pass


if firebase_admin_sdk_json:
    try:
        cred_info = json.loads(firebase_admin_sdk_json)
        cred = credentials.Certificate(cred_info)
        _init_firebase_app(cred)
        db_client = firestore.client()
        firebase_enabled = True
        logger.info("Firebase Admin initialised via FIREBASE_ADMIN_SDK_JSON env var.")
    except Exception as exc:
        logger.error("Failed to initialise Firebase Admin with FIREBASE_ADMIN_SDK_JSON: %s", exc)
elif firebase_service_account and os.path.exists(firebase_service_account):
    try:
        cred = credentials.Certificate(firebase_service_account)
        _init_firebase_app(cred)
        db_client = firestore.client()
        firebase_enabled = True
        logger.info("Firebase Admin initialised via service account file: %s", firebase_service_account)
    except Exception as exc:
        logger.error("Failed to initialise Firebase Admin with service account: %s", exc)
elif firebase_project_id:
    try:
        _init_firebase_app()
        db_client = firestore.client()
        firebase_enabled = True
        logger.info("Firebase Admin initialised via Application Default Credentials.")
    except Exception as exc:
        logger.error("Failed to initialise Firebase Admin via default credentials: %s", exc)
else:
    logger.warning(
        "No Firebase configuration found. Running in Local Mode (in-memory rate limiting)."
    )

# ---------------------------------------------------------------------------
# In-memory rate-limit registry
# Structure: { uid: { "count": int, "date": "YYYY-MM-DD" } }
# ---------------------------------------------------------------------------
local_query_registry: dict = {}


def check_and_increment_limit(uid: str, is_guest: bool) -> tuple[bool, int, str]:
    """
    Check whether the user is within their daily AI query limit and increment.

    Args:
        uid: Unique user identifier.
        is_guest: Whether the user is an anonymous/guest account.

    Returns:
        Tuple of (is_allowed, remaining_count, error_message).
    """
    if is_guest:
        return (
            False,
            0,
            "AI Mode is only available for registered builders. "
            "Please register or sign in to use the real AI Companion!",
        )

    today_str = datetime_date.today().isoformat()
    limit_msg = (
        f"You have reached your daily limit of {DAILY_AI_LIMIT} AI chats today. "
        "Please try again tomorrow, or switch back to Demo Mode to chat with the local simulation!"
    )

    if firebase_enabled and db_client:
        try:
            user_ref = (
                db_client.collection("users")
                .document(uid)
                .collection("stats")
                .document("ai_limits")
            )
            doc = user_ref.get()
            if doc.exists:
                data = doc.to_dict()
                last_reset = data.get("last_reset_date", "")
                count = data.get("ai_query_count", 0)
                if last_reset != today_str:
                    user_ref.set({"ai_query_count": 1, "last_reset_date": today_str}, merge=True)
                    return True, DAILY_AI_LIMIT - 1, ""
                if count >= DAILY_AI_LIMIT:
                    return False, 0, limit_msg
                user_ref.update({"ai_query_count": count + 1})
                return True, DAILY_AI_LIMIT - (count + 1), ""
            else:
                user_ref.set({"ai_query_count": 1, "last_reset_date": today_str})
                return True, DAILY_AI_LIMIT - 1, ""
        except Exception as exc:
            logger.warning("Firestore limit check error: %s. Falling back to in-memory.", exc)

    # In-memory fallback
    if uid not in local_query_registry:
        local_query_registry[uid] = {"count": 1, "date": today_str}
        return True, DAILY_AI_LIMIT - 1, ""

    user_data = local_query_registry[uid]
    if user_data["date"] != today_str:
        user_data["count"] = 1
        user_data["date"] = today_str
        return True, DAILY_AI_LIMIT - 1, ""

    if user_data["count"] >= DAILY_AI_LIMIT:
        return False, 0, limit_msg

    user_data["count"] += 1
    return True, DAILY_AI_LIMIT - user_data["count"], ""


def get_user_limits(uid: str, is_guest: bool) -> tuple[int, int]:
    """
    Retrieve the current query count and daily limit for a user.

    Args:
        uid: Unique user identifier.
        is_guest: Whether the user is an anonymous/guest account.

    Returns:
        Tuple of (current_count, daily_limit).
    """
    if is_guest:
        return 0, 0

    today_str = datetime_date.today().isoformat()

    if firebase_enabled and db_client:
        try:
            user_ref = (
                db_client.collection("users")
                .document(uid)
                .collection("stats")
                .document("ai_limits")
            )
            doc = user_ref.get()
            if doc.exists:
                data = doc.to_dict()
                if data.get("last_reset_date", "") != today_str:
                    return 0, DAILY_AI_LIMIT
                return data.get("ai_query_count", 0), DAILY_AI_LIMIT
            return 0, DAILY_AI_LIMIT
        except Exception as exc:
            logger.warning("Firestore get-limits error: %s", exc)

    if uid not in local_query_registry:
        return 0, DAILY_AI_LIMIT

    user_data = local_query_registry[uid]
    if user_data["date"] != today_str:
        return 0, DAILY_AI_LIMIT
    return user_data["count"], DAILY_AI_LIMIT


async def get_uid_from_request(request: Request) -> tuple[str, bool]:
    """
    Extract and verify the user identity from the incoming HTTP request.

    Checks (in order):
    1. ``Authorization: Bearer <id_token>`` header – verifies via Firebase Auth
       when Firebase is enabled; treats mock_ tokens as guests.
    2. ``X-Local-User-Id`` header – returns a prefixed local guest UID.
    3. Client IP address – last-resort anonymous fallback.

    Args:
        request: The incoming FastAPI request.

    Returns:
        Tuple of (uid, is_guest).

    Raises:
        HTTPException 401: If Firebase is enabled but token verification fails.
    """
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        id_token = auth_header[7:]
        if id_token.startswith("mock_"):
            return id_token, True
        if firebase_enabled:
            try:
                decoded_token = firebase_auth.verify_id_token(id_token)
                provider = decoded_token.get("firebase", {}).get("sign_in_provider", "")
                is_guest = provider == "anonymous"
                return decoded_token["uid"], is_guest
            except Exception as exc:
                logger.warning("Token verification failed: %s", exc)
                raise HTTPException(
                    status_code=401,
                    detail="Invalid Firebase session token. Please sign in again.",
                )
        else:
            return f"local_{id_token[:20]}", True

    local_uid = request.headers.get("X-Local-User-Id")
    if local_uid:
        return f"local_{local_uid}", True

    client_host = request.client.host if request.client else "unknown_ip"
    return f"ip_{client_host}", True


# ---------------------------------------------------------------------------
# Pydantic request/response models
# ---------------------------------------------------------------------------

class ChatRequest(BaseModel):
    """Payload for the AI chat companion endpoint."""

    message: str = Field(..., min_length=1, max_length=2000, description="User message text.")
    carbon_level: str = Field(
        ...,
        description="Current carbon level: very_low | low | average | high | very_high",
    )
    green_energy: int = Field(default=0, ge=0, description="User's accumulated Green Energy.")
    nature_points: int = Field(default=0, ge=0, description="User's accumulated Nature Points.")
    demo_mode: bool = Field(default=True, description="Use local simulator instead of Gemini.")


class ProfileRequest(BaseModel):
    """Payload for updating a user's multiplayer profile."""

    displayName: str = Field(..., min_length=1, max_length=80)
    email: str
    carbonScore: int = Field(default=0, ge=0)
    greenEnergy: int = Field(default=0, ge=0)
    naturePoints: int = Field(default=0, ge=0)
    treesCount: int = Field(default=0, ge=0)
    solarUnits: int = Field(default=0, ge=0)
    riverClean: bool = False
    wildlifeActive: bool = False


class CreateTribeRequest(BaseModel):
    """Payload for creating a new tribe."""

    name: str = Field(..., min_length=1, max_length=60)
    invitedUids: list[str] = Field(default_factory=list)


class JoinTribeRequest(BaseModel):
    """Payload for joining an existing tribe."""

    tribeId: str = Field(..., min_length=1)


class ChatMessageRequest(BaseModel):
    """Payload for sending a tribe chat message."""

    text: str = Field(..., min_length=1, max_length=500)


class ContributeRequest(BaseModel):
    """Payload for contributing to the global sustainability counter."""

    count: int = Field(default=1, ge=1)


# ---------------------------------------------------------------------------
# In-memory fallback registries (seed data for demo / offline mode)
# ---------------------------------------------------------------------------

local_user_profiles: dict = {
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
        "wildlifeActive": False,
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
        "wildlifeActive": False,
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
        "wildlifeActive": False,
    },
}

local_user_states: dict = {
    uid: {
        k: v
        for k, v in profile.items()
        if k not in ("uid", "email", "displayName")
    }
    for uid, profile in local_user_profiles.items()
}

local_tribes: dict = {
    "solar_squad_id": {
        "id": "solar_squad_id",
        "name": "Solar Squad",
        "creatorUid": "sarah_uid",
        "members": ["sarah_uid", "david_uid"],
        "weeklyGoal": DEFAULT_WEEKLY_GOAL,
        "progress": 250,
    }
}

local_tribe_messages: dict = {
    "solar_squad_id": [
        {
            "id": "msg1",
            "sender": "Sarah",
            "senderUid": "sarah_uid",
            "text": "Hey Solar Squad! Let's get our carbon score down this week! ☀️",
            "timestamp": int((time.time() - 3600) * 1000),
        },
        {
            "id": "msg2",
            "sender": "David",
            "senderUid": "david_uid",
            "text": "Count me in! I am planning to add solar panels today.",
            "timestamp": int((time.time() - 1800) * 1000),
        },
    ]
}

local_global_stats: dict = {
    "totalTrees": 843_219,
    "totalCarbon": 142_500,
}

# ---------------------------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------------------------

def _build_member_dict(uid: str, data: Optional[dict]) -> dict:
    """
    Build a serialisable member summary dict from a raw profile dict.

    Args:
        uid: The member's UID (used as fallback when data is None).
        data: Raw profile dict, or None if the profile does not exist.

    Returns:
        A dict with standardised member fields.
    """
    if data:
        return {
            "uid": data.get("uid", uid),
            "displayName": data.get("displayName", DEFAULT_DISPLAY_NAME),
            "carbonScore": data.get("carbonScore", DEFAULT_CARBON_SCORE),
            "treesCount": data.get("treesCount", 0),
            "solarUnits": data.get("solarUnits", 0),
            "riverClean": data.get("riverClean", False),
        }
    return {
        "uid": uid,
        "displayName": DEFAULT_DISPLAY_NAME,
        "carbonScore": DEFAULT_CARBON_SCORE,
        "treesCount": 0,
        "solarUnits": 0,
        "riverClean": False,
    }


def _find_local_tribe_for_user(uid: str) -> Optional[str]:
    """
    Search the local tribe registry and return the tribe ID the user belongs to.

    Args:
        uid: Unique user identifier.

    Returns:
        The tribe ID string, or None if the user is not in any local tribe.
    """
    for t_id, t_data in local_tribes.items():
        if uid in t_data.get("members", []):
            return t_id
    return None


# ---------------------------------------------------------------------------
# Local AI fallback response generator
# ---------------------------------------------------------------------------

#: Keywords that indicate a message is sustainability-related.
_SUSTAINABILITY_KEYWORDS: tuple[str, ...] = (
    "carbon", "footprint", "emission", "eco", "green", "energy", "nature", "tree",
    "plant", "solar", "wind", "recycle", "compost", "water", "gas", "bill",
    "electricity", "flight", "travel", "commute", "bike", "cycle", "walk", "food",
    "vegetarian", "vegan", "meat", "recipe", "challenge", "city", "island", "smog",
    "pollute", "forest", "guardian",
)

_DAILY_CHALLENGES: tuple[tuple[str, str], ...] = (
    (
        "🚴 **Bike Commute Challenge:** Avoid using a car or ride-share today. "
        "Commute by cycle, walk, or take the metro. (Reward: +50 Green Energy)",
        "transport",
    ),
    (
        "🥗 **Green Plate Challenge:** Eat entirely plant-based meals today "
        "(no meat or dairy). (Reward: +40 Green Energy)",
        "food",
    ),
    (
        "🔌 **Vampire Power Challenge:** Unplug all electronics and chargers that "
        "are not actively in use. (Reward: +30 Green Energy)",
        "energy",
    ),
    (
        "♻️ **Zero-Waste Hero:** Avoid using any single-use plastics today and "
        "log your recycling. (Reward: +35 Green Energy)",
        "waste",
    ),
)


def generate_local_fallback(message: str, carbon_level: str) -> str:
    """
    Generate a rich, context-aware AI companion response without calling Gemini.

    Refuses off-topic questions and provides domain-specific advice based on
    detected keywords (travel, challenges, energy, food) or carbon level.

    Args:
        message: The raw user message.
        carbon_level: One of very_low | low | average | high | very_high.

    Returns:
        A Markdown-formatted response string.
    """
    msg = message.lower()

    is_related = any(kw in msg for kw in _SUSTAINABILITY_KEYWORDS)
    if not is_related:
        return (
            "🦉 *The Forest Guardian looks at you gently...* \n\n"
            "\"I am here to guide you on protecting our virtual island and lowering your carbon footprint! "
            "Let's focus on green actions. Ask me about travel footprints, daily challenges, "
            "electricity tips, or recipes!\""
        )

    # Travel advice
    if any(kw in msg for kw in ("fly", "flight", "travel", "mumbai", "delhi")):
        co2_flight = random.randint(140, 180)
        co2_train = random.randint(15, 25)
        reduction = round(((co2_flight - co2_train) / co2_flight) * 100)
        return (
            f"✈️ **Travel Carbon analysis:** Flying from Delhi to Mumbai generates approximately "
            f"**{co2_flight} kg CO₂** per passenger. \n\n"
            f"🚂 **Green Alternative:** Taking the train instead would emit only **{co2_train} kg CO₂**, "
            f"a massive **{reduction}% reduction**!\n\n"
            f"💡 **Forest Guardian Tip:** If you must fly, you can offset this trip by planting 8 virtual "
            f"trees in your EcoCity (requiring 400 Green Energy) or logging 5 days of bicycle commuting. "
            f"What do you think?"
        )

    # Daily challenge suggestion
    if any(kw in msg for kw in ("challenge", "daily", "today", "do next")):
        chosen, _ = random.choice(_DAILY_CHALLENGES)
        return (
            f"🌿 **Here is your daily Climate Challenge!**\n\n{chosen}\n\n"
            "Let me know when you complete it! Completing this will instantly lower your carbon score "
            "and help clean up the rivers in your EcoVerse island."
        )

    # Energy / bill advice
    if any(kw in msg for kw in ("energy", "bill", "electricity", "power")):
        return (
            "🔌 **Eco-Home Energy Advice:**\n\n"
            "1. **Switch to LED bulbs**: They consume 75% less energy and last 25× longer than incandescent lighting.\n"
            "2. **Thermostat settings**: Lowering your thermostat by just 1°C in winter can reduce your heating bill by up to 10%.\n"
            "3. **Unplug Standby Devices**: Standby power (vampire load) accounts for 5–10% of household electricity use.\n\n"
            "🔋 *Tip:* Log your electricity savings in the logging panel to earn Green Energy to install "
            "Solar Panels on your island!"
        )

    # Food / diet advice
    if any(kw in msg for kw in ("food", "vegetarian", "vegan", "meat", "recipe")):
        return (
            "🥗 **Sustainable Diet Advisor:**\n\n"
            "A plant-based meal has a carbon footprint that is up to **70% smaller** than a meat-heavy meal. "
            "Beef alone generates 60 kg of greenhouse gases per kg of meat, compared to just 0.9 kg for peas.\n\n"
            "🌱 **Quick Recipe Idea (Eco-Bowl):** Quinoa base, roasted chickpeas, steamed broccoli, "
            "avocado, tahini-lemon dressing. Healthy for you, healthy for the planet!"
        )

    # Default response based on carbon level
    if carbon_level in ("high", "very_high"):
        return (
            "🦉 *The Forest Guardian looks concerned...* \n\n"
            "Your island is currently shrouded in smog and the rivers look polluted. Don't worry, we can fix this! "
            "I suggest we start with simple actions: **log a vegetarian meal** or **unplug idle appliances** today. "
            "Every action will clean up the smog and make the sky blue again. "
            "What green action would you like to log first?"
        )
    return (
        "🌳 *The Forest Guardian smiles warmly!* \n\n"
        "Your island is looking beautiful, with emerald skies and active wildlife. "
        "To maintain this level, you can keep logging daily green streaks. "
        "Would you like to try a **Climate Challenge** today to unlock rare landmarks or boost your tribe's progress?"
    )


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@app.post("/api/ai-chat", summary="AI Companion Chat", tags=["AI"])
async def ai_chat(req: ChatRequest, request: Request) -> dict:
    """
    Send a message to the Forest Guardian AI companion.

    In *demo mode* the response is generated locally (no API key required).
    In *real mode* the message is forwarded to the Gemini Flash model with a
    strict sustainability system prompt and per-user daily rate limiting.
    """
    # Reload env in case the key was updated at runtime
    load_dotenv(override=True)
    custom_key = request.headers.get("X-Gemini-API-Key")
    active_key = custom_key or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")

    if not req.demo_mode and active_key:
        if not custom_key:
            uid, is_guest = await get_uid_from_request(request)
            allowed, _remaining, err_msg = check_and_increment_limit(uid, is_guest)
            if not allowed:
                return {"reply": f"🦉 *The Forest Guardian holds up a wing...* \n\n\"{err_msg}\""}

        try:
            system_prompt = (
                f"You are the 'Forest Guardian' (or 'Eco Owl'), a friendly and wise animated companion "
                f"living in the user's multiplayer sustainability world called 'EcoVerse'.\n"
                f"The user's current carbon/environmental level is: '{req.carbon_level.replace('_', ' ')}'.\n"
                f"Their stats: Green Energy = {req.green_energy}, Nature Points = {req.nature_points}.\n"
                f"Your role is to give helpful, positive, and gamified advice.\n"
                f"If they ask about travel, calculate approximate emissions (e.g. flights generate ~150–200 kg CO₂, "
                f"trains generate ~80–90% less) and relate it to how it affects their virtual island "
                f"(e.g. high carbon causes smog and dry trees, green actions grow forests).\n"
                f"Be conversational, concise, and encourage friendly tribe competition. Use bullet points and emojis.\n"
                f"CRITICAL DOMAIN SAFETY RULE: Only answer questions related to ecology, sustainability, "
                f"climate change, carbon footprints, green energy, environmental conservation, "
                f"recycling/composting, eco-friendly lifestyle choices, and the EcoVerse game itself. "
                f"If the user asks about unrelated topics, politely refuse and suggest a green task instead. "
                f"Maintain your character as the Forest Guardian at all times."
            )
            genai.configure(api_key=active_key)
            model = genai.GenerativeModel("gemini-flash-latest", system_instruction=system_prompt)
            response = model.generate_content(req.message)
            return {"reply": response.text}
        except Exception as exc:
            logger.warning("Gemini API error: %s. Falling back to local responder.", exc)
            return {"reply": generate_local_fallback(req.message, req.carbon_level)}

    # Simulate small processing delay for authenticity (non-blocking)
    await asyncio.sleep(0.8)

    if not req.demo_mode and not active_key:
        return {
            "reply": (
                "🦉 *The Forest Guardian looks at you...* \n\n"
                "\"I tried to connect to the real Gemini AI network, but your API Key is missing! "
                "Please configure `GEMINI_API_KEY` in the server `.env` file, set your custom key in "
                "**Settings**, or toggle back to **Demo Mode** to chat with my simulated self.\""
            )
        }
    return {"reply": generate_local_fallback(req.message, req.carbon_level)}


@app.post("/api/utility-bill", summary="Analyse Utility Bill", tags=["AI"])
async def upload_utility_bill(
    request: Request,
    file: UploadFile = File(...),
    bill_type: str = Form("electricity"),  # electricity | water | gas
    demo_mode: bool = Form(True),
) -> dict:
    """
    Upload and analyse a utility bill (electricity, water, or gas).

    In demo mode a deterministic simulated result is returned immediately.
    In real mode the file bytes are sent to Gemini for multimodal extraction.
    """
    if demo_mode:
        await asyncio.sleep(2.0)  # Simulate AI processing time (non-blocking)

        if bill_type == "electricity":
            units = random.randint(180, 320)
            co2_emitted = round(units * CO2_PER_KWH, 1)
            diff = round(((co2_emitted - ELECTRICITY_AVG_KWH) / ELECTRICITY_AVG_KWH) * 100, 1)
            is_efficient = diff < 0
            status = "efficient" if is_efficient else "high"
            energy_reward = 200 if is_efficient else 120
            points_reward = 80 if is_efficient else 30
            comparison_word = "lower" if is_efficient else "higher"
            msg = (
                f"🎉 Excellent! Your bill shows {units} kWh used, which is {abs(diff)}% below the "
                f"neighbourhood average. Your sky aura gets a green boost!"
                if is_efficient
                else f"🔌 Your bill shows {units} kWh used, which is {diff}% above the neighbourhood "
                f"average. Consider setting a daily 'Vampire Power' challenge to optimise this next month."
            )
            return {
                "success": True,
                "filename": file.filename,
                "bill_type": bill_type,
                "metrics": {
                    "units": f"{units} kWh",
                    "carbon_footprint": f"{co2_emitted} kg CO₂",
                    "status": status,
                    "comparison": f"{abs(diff)}% {comparison_word} than regional average",
                },
                "rewards": {"green_energy": energy_reward, "nature_points": points_reward},
                "message": msg,
            }
        else:
            units = random.randint(10, 30)
            co2_emitted = round(units * CO2_PER_GAS_UNIT, 1)
            unit_label = "m³" if bill_type == "gas" else "Units"
            return {
                "success": True,
                "filename": file.filename,
                "bill_type": bill_type,
                "metrics": {
                    "units": f"{units} {unit_label}",
                    "carbon_footprint": f"{co2_emitted} kg CO₂",
                    "status": "efficient",
                    "comparison": "12% lower than regional average",
                },
                "rewards": {"green_energy": 150, "nature_points": 50},
                "message": "🌍 Thanks for logging! Your utility consumption details have been verified, adding resources to your eco arsenal.",
            }

    # Real-mode: Gemini multimodal bill analysis
    load_dotenv(override=True)
    custom_key = request.headers.get("X-Gemini-API-Key")
    active_key = custom_key or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")

    if not active_key:
        return {
            "success": False,
            "error": (
                "Gemini API key is not configured. Please add GEMINI_API_KEY to your .env file, "
                "configure your custom key in Settings, or enable Demo Mode."
            ),
        }

    if not custom_key:
        uid, is_guest = await get_uid_from_request(request)
        allowed, _remaining, err_msg = check_and_increment_limit(uid, is_guest)
        if not allowed:
            return {"success": False, "error": err_msg}

    try:
        file_bytes = await file.read()
        mime_type = file.content_type or "application/octet-stream"

        genai.configure(api_key=active_key)
        model = genai.GenerativeModel("gemini-flash-latest")

        prompt = (
            f"You are the Forest Guardian analysing a utility bill upload of type '{bill_type}'.\n"
            f"First, inspect the document carefully. If the document is NOT a utility bill at all "
            f"(e.g., it is a photo of a pet, a random book page, or completely unrelated to a utility bill) "
            f"or does not contain utility consumption information corresponding to '{bill_type}', "
            f"you MUST return a JSON object with a single key 'error' containing a detailed explanation.\n"
            f"Otherwise, if it is a valid bill, extract consumption details and return a JSON object with:\n"
            f"- 'units': numeric consumption value\n"
            f"- 'units_label': unit string (e.g. 'kWh', 'liters', 'm³')\n"
            f"- 'carbon_footprint': estimated kg CO₂ (electricity: {CO2_PER_KWH} kg/kWh; "
            f"water: 0.0003 kg/litre; gas: 2.0 kg/m³)\n"
            f"- 'status': 'efficient' or 'high' (electricity avg 250 kWh, water avg 15 000 litres, gas avg 40 m³)\n"
            f"- 'comparison': e.g. '14.2% lower than average'\n"
            f"- 'message': brief, friendly Forest Guardian tip\n"
            f"Return only the JSON object."
        )

        response = model.generate_content(
            [{"mime_type": mime_type, "data": file_bytes}, prompt],
            generation_config={"response_mime_type": "application/json"},
        )

        response_text = response.text.strip().removeprefix("```json").removesuffix("```").strip()
        parsed_data = json.loads(response_text)

        if "error" in parsed_data:
            return {"success": False, "error": parsed_data["error"]}

        status = parsed_data.get("status", "efficient").lower()
        energy_reward = 200 if status == "efficient" else 120
        points_reward = 80 if status == "efficient" else 30

        return {
            "success": True,
            "filename": file.filename,
            "bill_type": bill_type,
            "metrics": {
                "units": f"{parsed_data.get('units', 0)} {parsed_data.get('units_label', 'Units')}",
                "carbon_footprint": f"{parsed_data.get('carbon_footprint', 0)} kg CO₂",
                "status": status,
                "comparison": parsed_data.get("comparison", "Calculated by AI"),
            },
            "rewards": {"green_energy": energy_reward, "nature_points": points_reward},
            "message": parsed_data.get("message", "AI extraction complete!"),
        }

    except Exception as exc:
        err_str = str(exc)
        logger.error("Gemini bill analyser error: %s", err_str)
        if "429" in err_str or "quota" in err_str.lower() or "exhausted" in err_str.lower():
            friendly_err = (
                "⚠️ Gemini API Quota Exceeded: You have exceeded the free-tier daily rate limit. "
                "Please toggle back to **Demo Mode** to continue testing, or try again later."
            )
        else:
            friendly_err = f"AI extraction failed: {err_str}. Please check your bill format/connection."
        return {"success": False, "error": friendly_err}


@app.get("/api/firebase-config", summary="Firebase Client Config", tags=["Config"])
async def get_firebase_config() -> dict:
    """Return safe, public-facing Firebase client configuration keys."""
    return {
        "firebase_enabled": firebase_enabled,
        "config": {
            "apiKey": os.getenv("FIREBASE_API_KEY", ""),
            "authDomain": os.getenv("FIREBASE_AUTH_DOMAIN", ""),
            "projectId": os.getenv("FIREBASE_PROJECT_ID", ""),
            "storageBucket": os.getenv("FIREBASE_STORAGE_BUCKET", ""),
            "messagingSenderId": os.getenv("FIREBASE_MESSAGING_SENDER_ID", ""),
            "appId": os.getenv("FIREBASE_APP_ID", ""),
        },
    }


@app.get("/api/user-limits", summary="Daily AI Query Limits", tags=["Config"])
async def user_limits(request: Request) -> dict:
    """Return the current user's AI query count and remaining daily limit."""
    uid, is_guest = await get_uid_from_request(request)
    count, limit = get_user_limits(uid, is_guest)
    return {"count": count, "limit": limit, "remaining": max(0, limit - count)}


# ==========================================
# MULTIPLAYER API (FIRESTORE + LOCAL FALLBACK)
# ==========================================

@app.post("/api/multiplayer/profile", summary="Sync User Profile", tags=["Multiplayer"])
async def sync_profile(req: ProfileRequest, request: Request) -> dict:
    """
    Persist the authenticated user's game profile to Firestore (and local cache).
    Guests are rejected — only registered builders may sync.
    """
    uid, is_guest = await get_uid_from_request(request)
    if is_guest:
        return {"success": False, "error": "Guests cannot sync profile"}

    profile_data = {
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
    }
    # Always keep local cache in sync
    local_user_profiles[uid] = profile_data
    local_user_states[uid] = {k: v for k, v in profile_data.items() if k not in ("uid", "email", "displayName")}

    if firebase_enabled and db_client:
        try:
            db_client.collection("users").document(uid).set(
                {**profile_data, "isAnonymous": False, "updatedAt": firestore.SERVER_TIMESTAMP},
                merge=True,
            )
            return {"success": True}
        except Exception as exc:
            logger.warning("Firestore profile sync error: %s. Using local fallback.", exc)
            return {"success": True, "note": "Synced to local session fallback"}

    return {"success": True, "note": "Synced to local session"}


@app.get("/api/multiplayer/users", summary="List Multiplayer Users", tags=["Multiplayer"])
async def get_multiplayer_users(request: Request) -> dict:
    """Return a list of registered (non-anonymous) players for the leaderboard/visit panel."""
    uid, is_guest = await get_uid_from_request(request)
    if is_guest:
        return {"success": False, "error": "Guests cannot list users"}

    users: list[dict] = []

    if firebase_enabled and db_client:
        try:
            users_ref = (
                db_client.collection("users").where("isAnonymous", "==", False).limit(100).get()
            )
            for u in users_ref:
                data = u.to_dict()
                if data.get("uid") != uid:
                    users.append({
                        "uid": data.get("uid"),
                        "displayName": data.get("displayName", DEFAULT_DISPLAY_NAME),
                        "carbonScore": data.get("carbonScore", DEFAULT_CARBON_SCORE),
                        "treesCount": data.get("treesCount", 0),
                        "solarUnits": data.get("solarUnits", 0),
                        "riverClean": data.get("riverClean", False),
                        "wildlifeActive": data.get("wildlifeActive", False),
                        "naturePoints": data.get("naturePoints", 0),
                    })
            return {"success": True, "users": users}
        except Exception as exc:
            logger.warning("Firestore list-users error: %s. Using local fallback.", exc)

    for target_uid, data in local_user_profiles.items():
        if target_uid != uid:
            users.append({
                "uid": data.get("uid"),
                "displayName": data.get("displayName", DEFAULT_DISPLAY_NAME),
                "carbonScore": data.get("carbonScore", DEFAULT_CARBON_SCORE),
                "treesCount": data.get("treesCount", 0),
                "solarUnits": data.get("solarUnits", 0),
                "riverClean": data.get("riverClean", False),
                "wildlifeActive": data.get("wildlifeActive", False),
                "naturePoints": data.get("naturePoints", 0),
            })
    return {"success": True, "users": users}


@app.post("/api/multiplayer/tribe/create", summary="Create Tribe", tags=["Tribes"])
async def create_tribe(req: CreateTribeRequest, request: Request) -> dict:
    """Create a new eco-tribe with the caller as the founding member."""
    uid, is_guest = await get_uid_from_request(request)
    if is_guest:
        return {"success": False, "error": "Guests cannot create tribes"}

    tribe_id = f"tribe_{int(time.time())}"
    members = [uid] + req.invitedUids

    local_tribes[tribe_id] = {
        "id": tribe_id,
        "name": req.name,
        "creatorUid": uid,
        "members": members,
        "weeklyGoal": DEFAULT_WEEKLY_GOAL,
        "progress": 0,
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
                "weeklyGoal": DEFAULT_WEEKLY_GOAL,
                "progress": 0,
                "createdAt": firestore.SERVER_TIMESTAMP,
            })
            return {"success": True, "tribeId": new_ref.id}
        except Exception as exc:
            logger.warning("Firestore create-tribe error: %s. Using local fallback.", exc)
            return {"success": True, "tribeId": tribe_id, "note": "Created in local fallback"}

    return {"success": True, "tribeId": tribe_id}


@app.post("/api/multiplayer/tribe/join", summary="Join Tribe", tags=["Tribes"])
async def join_tribe(req: JoinTribeRequest, request: Request) -> dict:
    """Add the authenticated user to an existing tribe by ID."""
    uid, is_guest = await get_uid_from_request(request)
    if is_guest:
        return {"success": False, "error": "Guests cannot join tribes"}

    # Bootstrap tribe in local registry if it doesn't exist yet
    if req.tribeId not in local_tribes:
        local_tribes[req.tribeId] = {
            "id": req.tribeId,
            "name": req.tribeId,
            "creatorUid": uid,
            "members": [],
            "weeklyGoal": DEFAULT_WEEKLY_GOAL,
            "progress": 0,
        }
    if uid not in local_tribes[req.tribeId]["members"]:
        local_tribes[req.tribeId]["members"].append(uid)

    if firebase_enabled and db_client:
        try:
            db_client.collection("tribes").document(req.tribeId).update(
                {"members": firestore.ArrayUnion([uid])}
            )
            return {"success": True}
        except Exception as exc:
            logger.warning("Firestore join-tribe error: %s. Using local fallback.", exc)
            return {"success": True, "note": "Joined local fallback tribe"}

    return {"success": True}


@app.post("/api/multiplayer/tribe/leave", summary="Leave Tribe", tags=["Tribes"])
async def leave_tribe(request: Request) -> dict:
    """Remove the authenticated user from their current tribe."""
    uid, is_guest = await get_uid_from_request(request)
    if is_guest:
        return {"success": False, "error": "Guests cannot leave tribes"}

    for t_id, t_data in list(local_tribes.items()):
        if uid in t_data.get("members", []):
            t_data["members"].remove(uid)
            if not t_data["members"]:
                del local_tribes[t_id]
                local_tribe_messages.pop(t_id, None)

    if firebase_enabled and db_client:
        try:
            tribes = (
                db_client.collection("tribes")
                .where("members", "array_contains", uid)
                .limit(1)
                .get()
            )
            if tribes:
                db_client.collection("tribes").document(tribes[0].id).update(
                    {"members": firestore.ArrayRemove([uid])}
                )
            return {"success": True}
        except Exception as exc:
            logger.warning("Firestore leave-tribe error: %s. Using local fallback.", exc)
            return {"success": True, "note": "Left local fallback tribe"}

    return {"success": True}


@app.get("/api/multiplayer/tribe", summary="Get Tribe Details", tags=["Tribes"])
async def get_tribe_details(request: Request) -> dict:
    """
    Return the user's current tribe details (members, progress, weekly goal).
    If the user has no tribe, return the list of public tribes to join.
    """
    uid, is_guest = await get_uid_from_request(request)
    if is_guest:
        return {"success": False, "error": "Guests cannot access tribes"}

    if firebase_enabled and db_client:
        try:
            tribes = (
                db_client.collection("tribes")
                .where("members", "array_contains", uid)
                .limit(1)
                .get()
            )
            if tribes:
                tribe_data = tribes[0].to_dict()
                members_data = []
                for m_uid in tribe_data.get("members", []):
                    m_doc = db_client.collection("users").document(m_uid).get()
                    members_data.append(
                        _build_member_dict(m_uid, m_doc.to_dict() if m_doc.exists else None)
                    )
                return {
                    "success": True,
                    "hasTribe": True,
                    "tribe": {
                        "id": tribe_data.get("id"),
                        "name": tribe_data.get("name"),
                        "creatorUid": tribe_data.get("creatorUid"),
                        "members": tribe_data.get("members", []),
                        "weeklyGoal": tribe_data.get("weeklyGoal", DEFAULT_WEEKLY_GOAL),
                    },
                    "members": members_data,
                }
            else:
                public_tribes_ref = db_client.collection("tribes").limit(20).get()
                public_tribes = [
                    {
                        "id": t.to_dict().get("id"),
                        "name": t.to_dict().get("name"),
                        "membersCount": len(t.to_dict().get("members", [])),
                        "weeklyGoal": t.to_dict().get("weeklyGoal", DEFAULT_WEEKLY_GOAL),
                    }
                    for t in public_tribes_ref
                ]
                return {"success": True, "hasTribe": False, "publicTribes": public_tribes}
        except Exception as exc:
            logger.warning("Firestore get-tribe error: %s. Falling back to in-memory.", exc)

    # Local fallback
    my_tribe_id = _find_local_tribe_for_user(uid)
    if my_tribe_id:
        my_tribe = local_tribes[my_tribe_id]
        members_data = []
        for m_uid in my_tribe.get("members", []):
            raw = local_user_profiles.get(m_uid)
            if m_uid == uid and not raw:
                raw = {"uid": uid, "displayName": f"{DEFAULT_DISPLAY_NAME} (You)", "carbonScore": DEFAULT_CARBON_SCORE}
            members_data.append(_build_member_dict(m_uid, raw))
        return {
            "success": True,
            "hasTribe": True,
            "tribe": {
                "id": my_tribe.get("id"),
                "name": my_tribe.get("name"),
                "creatorUid": my_tribe.get("creatorUid"),
                "members": my_tribe.get("members", []),
                "weeklyGoal": my_tribe.get("weeklyGoal", DEFAULT_WEEKLY_GOAL),
            },
            "members": members_data,
        }

    public_tribes = [
        {
            "id": t_data.get("id"),
            "name": t_data.get("name"),
            "membersCount": len(t_data.get("members", [])),
            "weeklyGoal": t_data.get("weeklyGoal", DEFAULT_WEEKLY_GOAL),
        }
        for t_data in local_tribes.values()
    ]
    return {"success": True, "hasTribe": False, "publicTribes": public_tribes}


@app.post("/api/multiplayer/tribe/chat", summary="Send Tribe Chat Message", tags=["Tribes"])
async def send_tribe_chat_message(req: ChatMessageRequest, request: Request) -> dict:
    """Post a chat message to the user's current tribe chat room."""
    uid, is_guest = await get_uid_from_request(request)
    if is_guest:
        return {"success": False, "error": "Guests cannot send chat messages"}

    profile = local_user_profiles.get(uid)
    sender_name = profile.get("displayName", DEFAULT_DISPLAY_NAME) if profile else DEFAULT_DISPLAY_NAME
    my_tribe_id = _find_local_tribe_for_user(uid)

    # Persist to local store first (used as fallback even when Firebase is enabled)
    if my_tribe_id:
        local_tribe_messages.setdefault(my_tribe_id, [])
        local_tribe_messages[my_tribe_id].append({
            "id": f"msg_{int(time.time() * 1000)}",
            "sender": sender_name,
            "senderUid": uid,
            "text": req.text,
            "timestamp": int(time.time() * 1000),
        })
        # Keep message history bounded
        if len(local_tribe_messages[my_tribe_id]) > MAX_TRIBE_MESSAGES:
            local_tribe_messages[my_tribe_id].pop(0)

    if firebase_enabled and db_client:
        try:
            tribes = (
                db_client.collection("tribes")
                .where("members", "array_contains", uid)
                .limit(1)
                .get()
            )
            if not tribes:
                return {"success": False, "error": "User is not in a tribe"}
            tribe_id = tribes[0].id
            sender_doc = db_client.collection("users").document(uid).get()
            sender_name_db = (
                sender_doc.to_dict().get("displayName", DEFAULT_DISPLAY_NAME)
                if sender_doc.exists
                else DEFAULT_DISPLAY_NAME
            )
            msg_ref = (
                db_client.collection("tribes")
                .document(tribe_id)
                .collection("messages")
                .document()
            )
            msg_ref.set({
                "id": msg_ref.id,
                "sender": sender_name_db,
                "senderUid": uid,
                "text": req.text,
                "timestamp": firestore.SERVER_TIMESTAMP,
            })
            return {"success": True}
        except Exception as exc:
            logger.warning("Firestore send-chat error: %s. Using local fallback.", exc)
            return {"success": True, "note": "Sent to local fallback chat"}

    if my_tribe_id:
        return {"success": True}
    return {"success": False, "error": "User is not in a tribe"}


@app.get("/api/multiplayer/tribe/chat", summary="Get Tribe Chat Messages", tags=["Tribes"])
async def get_tribe_chat_messages(request: Request) -> dict:
    """Retrieve the last 50 chat messages for the user's current tribe."""
    uid, is_guest = await get_uid_from_request(request)
    if is_guest:
        return {"success": False, "error": "Guests cannot read chat messages"}

    if firebase_enabled and db_client:
        try:
            tribes = (
                db_client.collection("tribes")
                .where("members", "array_contains", uid)
                .limit(1)
                .get()
            )
            if tribes:
                tribe_id = tribes[0].id
                messages_ref = (
                    db_client.collection("tribes")
                    .document(tribe_id)
                    .collection("messages")
                    .order_by("timestamp", direction=firestore.Query.ASCENDING)
                    .limit(MAX_TRIBE_MESSAGES)
                    .get()
                )
                messages = []
                for m in messages_ref:
                    m_data = m.to_dict()
                    ts = m_data.get("timestamp")
                    timestamp_ms = int(ts.timestamp() * 1000) if ts else int(time.time() * 1000)
                    messages.append({
                        "sender": m_data.get("sender", DEFAULT_DISPLAY_NAME),
                        "senderUid": m_data.get("senderUid"),
                        "text": m_data.get("text", ""),
                        "timestamp": timestamp_ms,
                    })
                return {"success": True, "messages": messages}
            return {"success": True, "messages": []}
        except Exception as exc:
            logger.warning("Firestore get-chat error: %s. Using local fallback.", exc)

    # Local fallback
    my_tribe_id = _find_local_tribe_for_user(uid)
    if my_tribe_id and my_tribe_id in local_tribe_messages:
        return {"success": True, "messages": local_tribe_messages[my_tribe_id]}
    return {"success": True, "messages": []}


@app.get("/api/multiplayer/global-stats", summary="Global Planet Stats", tags=["Multiplayer"])
async def get_global_stats() -> dict:
    """Return the community-wide tree planting and carbon offset totals."""
    if firebase_enabled and db_client:
        try:
            doc = db_client.collection("global_planet").document("stats").get()
            if doc.exists:
                data = doc.to_dict()
                return {
                    "success": True,
                    "totalTrees": data.get("totalTrees", local_global_stats["totalTrees"]),
                    "totalCarbon": data.get("totalCarbon", local_global_stats["totalCarbon"]),
                }
        except Exception as exc:
            logger.warning("Firestore global-stats error: %s. Using local fallback.", exc)

    return {
        "success": True,
        "totalTrees": local_global_stats["totalTrees"],
        "totalCarbon": local_global_stats["totalCarbon"],
    }


@app.post(
    "/api/multiplayer/global-stats/contribute",
    summary="Contribute to Global Stats",
    tags=["Multiplayer"],
)
async def contribute_global_stats(req: ContributeRequest, request: Request) -> dict:
    """
    Increment the community tree counter and carbon-offset total.
    Each unit contributes 1 tree and 25 kg of offset to the planet dashboard.
    """
    uid, is_guest = await get_uid_from_request(request)
    if is_guest:
        return {"success": False, "error": "Guests cannot contribute to global event"}

    # Increment local cache unconditionally
    local_global_stats["totalTrees"] += req.count
    local_global_stats["totalCarbon"] += req.count * 25

    if firebase_enabled and db_client:
        try:
            db_client.collection("global_planet").document("stats").set(
                {
                    "totalTrees": firestore.Increment(req.count),
                    "totalCarbon": firestore.Increment(req.count * 25),
                },
                merge=True,
            )
            return {"success": True}
        except Exception as exc:
            logger.warning("Firestore contribute-stats error: %s. Using local fallback.", exc)
            return {"success": True, "note": "Contributed to local fallback stats"}

    return {"success": True, "note": "Contributed to local fallback stats"}


@app.get(
    "/api/multiplayer/user-state/{target_uid}",
    summary="Get Target User State",
    tags=["Multiplayer"],
)
async def get_target_user_state(target_uid: str, request: Request) -> dict:
    """
    Retrieve the game state of another registered player (e.g., for island visits).
    Guests are not permitted to visit other users.
    """
    uid, is_guest = await get_uid_from_request(request)
    if is_guest:
        return {"success": False, "error": "Guests cannot visit other users"}

    if firebase_enabled and db_client:
        try:
            doc = (
                db_client.collection("users")
                .document(target_uid)
                .collection("game_state")
                .document("data")
                .get()
            )
            if doc.exists:
                return {"success": True, "state": doc.to_dict()}
        except Exception as exc:
            logger.warning("Firestore get-user-state error: %s. Using local fallback.", exc)

    if target_uid in local_user_states:
        return {"success": True, "state": local_user_states[target_uid]}

    # Default state for unknown users
    return {
        "success": True,
        "state": {
            "carbonScore": DEFAULT_CARBON_SCORE,
            "greenEnergy": 0,
            "naturePoints": 0,
            "treesCount": 0,
            "solarUnits": 0,
            "riverClean": False,
            "wildlifeActive": False,
        },
    }


# ---------------------------------------------------------------------------
# Static frontend
# ---------------------------------------------------------------------------
os.makedirs("static", exist_ok=True)
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
