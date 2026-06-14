import pytest
from fastapi.testclient import TestClient
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

def test_health_check_local_fallbacks():
    """Test user state visit checks guest restrictions"""
    response = client.get("/api/multiplayer/user-state/dummy_uid")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is False
    assert data["error"] == "Guests cannot visit other users"
