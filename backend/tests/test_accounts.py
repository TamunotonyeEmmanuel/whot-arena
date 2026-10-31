from uuid import uuid4

from fastapi.testclient import TestClient

from app.game import Player, Room
from app.main import app, record_match


def credentials():
    suffix = uuid4().hex[:10]
    return {"username": f"player_{suffix}", "email": f"{suffix}@example.com",
            "password": "A-secure-password-123"}


def test_register_login_profile_and_leaderboard():
    payload = credentials()
    with TestClient(app) as client:
        registered = client.post("/api/auth/register", json=payload)
        assert registered.status_code == 201, registered.text
        body = registered.json()
        assert body["user"]["username"] == payload["username"]
        assert body["access_token"]

        duplicate = client.post("/api/auth/register", json=payload)
        assert duplicate.status_code == 409

        login = client.post("/api/auth/login", json={
            "email": payload["email"], "password": payload["password"],
        })
        assert login.status_code == 200
        token = login.json()["access_token"]

        unauthorized = client.get("/api/profile")
        assert unauthorized.status_code == 401
        profile = client.get("/api/profile", headers={"Authorization": f"Bearer {token}"})
        assert profile.status_code == 200
        assert profile.json()["email"] == payload["email"]
        history = client.get("/api/history", headers={"Authorization": f"Bearer {token}"})
        assert history.status_code == 200
        assert history.json() == []

        leaderboard = client.get("/api/leaderboard")
        assert leaderboard.status_code == 200
        assert any(player["username"] == payload["username"] for player in leaderboard.json())


def test_registration_validates_input_and_login_rejects_bad_password():
    payload = credentials()
    with TestClient(app) as client:
        invalid = client.post("/api/auth/register", json={
            "username": "x", "email": "not-an-email", "password": "short",
        })
        assert invalid.status_code == 422
        assert client.post("/api/auth/register", json=payload).status_code == 201
        rejected = client.post("/api/auth/login", json={
            "email": payload["email"], "password": "wrong-password",
        })
        assert rejected.status_code == 401


def test_completed_match_updates_registered_player_statistics():
    payload = credentials()
    opponent_payload = credentials()
    with TestClient(app) as client:
        registered = client.post("/api/auth/register", json=payload).json()
        opponent = client.post("/api/auth/register", json=opponent_payload).json()
        user_id = registered["user"]["id"]
        room = Room("STATS1", "winner", [
            Player("winner", payload["username"], user_id=user_id),
            Player("opponent", opponent_payload["username"], user_id=opponent["user"]["id"]),
        ])
        room.status = "finished"
        room.winner = "winner"
        room.match_winner = "winner"
        record_match(room)
        record_match(room)
        profile = client.get("/api/profile", headers={
            "Authorization": f"Bearer {registered['access_token']}"
        })
        assert profile.json()["matches_played"] == 1
        assert profile.json()["wins"] == 1
        history = client.get("/api/history", headers={
            "Authorization": f"Bearer {registered['access_token']}"
        })
        assert history.status_code == 200
        assert history.json()[0]["result"] == "win"
        assert history.json()[0]["room_code"] == "STATS1"
        opponent_history = client.get("/api/history", headers={
            "Authorization": f"Bearer {opponent['access_token']}"
        })
        assert opponent_history.json()[0]["result"] == "loss"

def test_match_history_requires_authentication():
    with TestClient(app) as client:
        assert client.get("/api/history").status_code == 401
