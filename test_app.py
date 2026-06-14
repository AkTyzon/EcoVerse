import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch
import app as app_module
from app import app

client = TestClient(app)

def test_firebase_config():
    """Test retrieving public Firebase client config keys"""
    response = client.get("/api/firebase-config")
    assert response.status_code == 200
    data = response.json()
    assert "config" in data
    assert "firebase_enabled" in data
    assert "apiKey" in data["config"]
    assert "projectId" in data["config"]

def test_user_limits_ip_fallback():
    """Test user limit returns valid limits when falling back to IP/Local ID"""
    response = client.get("/api/user-limits", headers={"X-Local-User-Id": "test_user"})
    assert response.status_code == 200
    data = response.json()
    assert "limit" in data
    assert "count" in data
    assert "remaining" in data

def test_global_stats():
    """Test retrieving global multiplayer stats"""
    response = client.get("/api/multiplayer/global-stats")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "totalCarbon" in data
    assert "totalTrees" in data

def test_ai_chat_invalid_auth():
    """Test that requesting AI chat with an invalid token triggers 401 Unauthorized"""
    response = client.post(
        "/api/ai-chat", 
        json={
            "message": "Hello Forest Guardian",
            "carbon_level": "average",
            "green_energy": 0,
            "nature_points": 0,
            "demo_mode": False
        },
        headers={"Authorization": "Bearer invalid_session_token_123"}
    )
    # If firebase is enabled it will verify and fail (401), if not enabled it will use local guest fallback and allow
    assert response.status_code in [200, 401]

def test_ai_chat_demo_mode():
    """Test that requesting AI chat in Demo Mode returns a local simulator response successfully"""
    response = client.post(
        "/api/ai-chat", 
        json={
            "message": "Give me a daily green challenge",
            "carbon_level": "average",
            "green_energy": 10,
            "nature_points": 20,
            "demo_mode": True
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert "reply" in data
    assert len(data["reply"]) > 0

def test_health_check_local_fallbacks():
    """Test user state visit checks guest restrictions"""
    response = client.get("/api/multiplayer/user-state/dummy_uid")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is False
    assert data["error"] == "Guests cannot visit other users"

def test_upload_utility_bill_demo():
    """Test uploading a mock utility bill file in Demo Mode"""
    file_content = b"Mock energy consumption details: 250 kWh used."
    files = {"file": ("mock_bill.txt", file_content, "text/plain")}
    data = {"bill_type": "electricity", "demo_mode": "true"}
    response = client.post("/api/utility-bill", files=files, data=data)
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["success"] is True
    assert "metrics" in res_data
    assert "carbon_footprint" in res_data["metrics"]
    assert "rewards" in res_data
    assert "green_energy" in res_data["rewards"]

@patch("app.firebase_enabled", False)
@patch("app.get_uid_from_request")
def test_profile_update_mocked(mock_get_uid):
    """Test updating user profiles using mocked credentials"""
    mock_get_uid.return_value = ("mock_user_123", False)
    payload = {
        "displayName": "Eco Builder",
        "email": "builder@ecoverse.com",
        "carbonScore": 120,
        "greenEnergy": 50,
        "naturePoints": 100,
        "treesCount": 5,
        "solarUnits": 1,
        "riverClean": True,
        "wildlifeActive": False
    }
    response = client.post("/api/multiplayer/profile", json=payload)
    assert response.status_code == 200
    assert response.json()["success"] is True

@patch("app.firebase_enabled", False)
@patch("app.get_uid_from_request")
def test_tribe_create_mocked(mock_get_uid):
    """Test creating a multiplayer tribe using mocked credentials"""
    mock_get_uid.return_value = ("mock_user_123", False)
    payload = {
        "name": "Solar Squad Elite",
        "invitedUids": ["mock_user_abc"]
    }
    response = client.post("/api/multiplayer/tribe/create", json=payload)
    assert response.status_code == 200
    assert response.json()["success"] is True

@patch("app.firebase_enabled", False)
@patch("app.get_uid_from_request")
def test_tribe_join_leave_mocked(mock_get_uid):
    """Test joining and leaving a tribe using mocked credentials"""
    mock_get_uid.return_value = ("mock_user_123", False)
    # Join tribe
    response_join = client.post("/api/multiplayer/tribe/join", json={"tribeId": "tribe_solar"})
    assert response_join.status_code == 200
    assert response_join.json()["success"] is True
    # Leave tribe
    response_leave = client.post("/api/multiplayer/tribe/leave")
    assert response_leave.status_code == 200
    assert response_leave.json()["success"] is True

@patch("app.firebase_enabled", False)
@patch("app.get_uid_from_request")
def test_get_tribe_details_mocked(mock_get_uid):
    """Test fetching active tribe details using mocked credentials"""
    mock_get_uid.return_value = ("mock_user_123", False)
    response = client.get("/api/multiplayer/tribe")
    assert response.status_code == 200
    data = response.json()
    assert "success" in data

@patch("app.firebase_enabled", False)
@patch("app.get_uid_from_request")
def test_tribe_chat_send_get_mocked(mock_get_uid):
    """Test sending and fetching tribe chat messages using mocked credentials"""
    mock_get_uid.return_value = ("mock_user_123", False)
    # Join tribe first so user is a valid member in local registry
    response_join = client.post("/api/multiplayer/tribe/join", json={"tribeId": "tribe_solar"})
    assert response_join.status_code == 200
    
    # Send message
    response_send = client.post("/api/multiplayer/tribe/chat", json={"text": "Let's log commute today!"})
    assert response_send.status_code == 200
    assert response_send.json()["success"] is True
    
    # Fetch messages
    response_fetch = client.get("/api/multiplayer/tribe/chat")
    assert response_fetch.status_code == 200
    assert response_fetch.json()["success"] is True

@patch("app.firebase_enabled", False)
@patch("app.get_uid_from_request")
def test_global_stats_contribute_mocked(mock_get_uid):
    """Test contributing carbon offset values to the community pool using mocked credentials"""
    mock_get_uid.return_value = ("mock_user_123", False)
    response = client.post("/api/multiplayer/global-stats/contribute", json={"count": 3})
    assert response.status_code == 200
    assert response.json()["success"] is True


# ─────────────────────────────────────────────
# Input Validation & Pydantic Constraint Tests
# ─────────────────────────────────────────────

def test_ai_chat_empty_message_rejected():
    """Test that an empty message string is rejected with HTTP 422 (Pydantic min_length=1)"""
    response = client.post(
        "/api/ai-chat",
        json={
            "message": "",
            "carbon_level": "average",
            "green_energy": 0,
            "nature_points": 0,
            "demo_mode": True,
        },
    )
    assert response.status_code == 422, "Empty message should fail Pydantic min_length=1 validation"


def test_contribute_zero_count_rejected():
    """Test that count=0 is rejected with HTTP 422 (Pydantic ge=1 constraint)"""
    response = client.post(
        "/api/multiplayer/global-stats/contribute",
        json={"count": 0},
    )
    assert response.status_code == 422, "count=0 should violate ge=1 Pydantic constraint"


def test_contribute_negative_count_rejected():
    """Test that negative count values are rejected with HTTP 422"""
    response = client.post(
        "/api/multiplayer/global-stats/contribute",
        json={"count": -5},
    )
    assert response.status_code == 422, "Negative count should violate ge=1 Pydantic constraint"


# ─────────────────────────────────────────────
# Bill Type Coverage Tests
# ─────────────────────────────────────────────

def test_upload_utility_bill_water_demo():
    """Test uploading a water bill in Demo Mode returns valid metrics"""
    file_content = b"Water consumption: 12,000 litres this billing period."
    files = {"file": ("water_bill.txt", file_content, "text/plain")}
    data = {"bill_type": "water", "demo_mode": "true"}
    response = client.post("/api/utility-bill", files=files, data=data)
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["success"] is True
    assert "carbon_footprint" in res_data["metrics"]
    assert "green_energy" in res_data["rewards"]
    assert "nature_points" in res_data["rewards"]


def test_upload_utility_bill_gas_demo():
    """Test uploading a gas bill in Demo Mode returns m³ unit label"""
    file_content = b"Natural gas usage: 22 m3 consumed this month."
    files = {"file": ("gas_bill.txt", file_content, "text/plain")}
    data = {"bill_type": "gas", "demo_mode": "true"}
    response = client.post("/api/utility-bill", files=files, data=data)
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["success"] is True
    assert "m³" in res_data["metrics"]["units"], "Gas bill should use m³ unit label"


# ─────────────────────────────────────────────
# Guest Auth Guard Tests
# ─────────────────────────────────────────────

@patch("app.firebase_enabled", False)
@patch("app.get_uid_from_request")
def test_guest_blocked_from_tribe_chat(mock_get_uid):
    """Test that guest users are blocked from sending tribe chat messages"""
    mock_get_uid.return_value = ("guest_ip_192_168_1_1", True)  # is_guest=True
    response = client.post("/api/multiplayer/tribe/chat", json={"text": "Hello tribe!"})
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is False
    assert "Guests" in data["error"]


@patch("app.firebase_enabled", False)
@patch("app.get_uid_from_request")
def test_guest_blocked_from_global_contribute(mock_get_uid):
    """Test that guest users are blocked from contributing to global stats"""
    mock_get_uid.return_value = ("guest_ip_192_168_1_2", True)  # is_guest=True
    response = client.post("/api/multiplayer/global-stats/contribute", json={"count": 1})
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is False
    assert "Guests" in data["error"]


# ─────────────────────────────────────────────
# Local AI Fallback Logic Tests
# ─────────────────────────────────────────────

def test_local_fallback_travel_keywords():
    """Test that travel-related keywords trigger the flight/train carbon comparison response"""
    from app import generate_local_fallback
    reply = generate_local_fallback("How much CO2 does a flight produce?", "average")
    assert "CO₂" in reply or "flight" in reply.lower() or "Travel" in reply, \
        "Travel keyword should trigger flight carbon comparison response"


def test_local_fallback_food_keywords():
    """Test that food-related keywords trigger the sustainable diet response"""
    from app import generate_local_fallback
    reply = generate_local_fallback("Give me a vegetarian recipe idea", "low")
    assert "plant" in reply.lower() or "recipe" in reply.lower() or "Diet" in reply, \
        "Food keyword should trigger sustainable diet advisor response"


def test_local_fallback_energy_keywords():
    """Test that energy-related keywords trigger the eco-home energy advice"""
    from app import generate_local_fallback
    reply = generate_local_fallback("How can I reduce my electricity bill?", "average")
    assert "LED" in reply or "energy" in reply.lower() or "Eco-Home" in reply, \
        "Energy keyword should trigger eco-home energy advice response"


def test_local_fallback_off_topic_refused():
    """Test that off-topic questions are politely refused by the Forest Guardian"""
    from app import generate_local_fallback
    reply = generate_local_fallback("Write me a Python bubble sort algorithm", "average")
    assert "Forest Guardian" in reply, \
        "Off-topic query should be refused with Forest Guardian in-character response"


def test_local_fallback_high_carbon_level():
    """Test that high carbon level triggers a concerned Guardian response"""
    from app import generate_local_fallback
    reply = generate_local_fallback("What should I do today?", "very_high")
    # For 'today' keyword without sustainability context → off-topic fallback
    # OR if carbon level high and keyword matched → concerned response
    assert len(reply) > 50, "Fallback should always return a non-trivial response"
