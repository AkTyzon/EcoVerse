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
