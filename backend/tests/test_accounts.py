from uuid import uuid4

from fastapi.testclient import TestClient

from app.game import Player, Room
from app.database import ArenaTreasury, SessionLocal, User
from app.main import (
    app, ensure_wager_available, lock_room_wager, record_match,
    validate_production_config,
)


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
        assert body["user"]["arena_coins"] == 10_000
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
        room.result_recorded = False
        record_match(room)
        profile = client.get("/api/profile", headers={
            "Authorization": "Bearer " + registered["access_token"],
        })
        assert profile.json()["matches_played"] == 1
        assert profile.json()["wins"] == 1
        assert len(client.get("/api/history", headers={
            "Authorization": "Bearer " + registered["access_token"],
        }).json()) == 1
        history = client.get("/api/history", headers={
            "Authorization": "Bearer " + registered["access_token"],
        })
        assert history.status_code == 200
        assert history.json()[0]["result"] == "win"
        assert history.json()[0]["room_code"] == "STATS1"
        opponent_history = client.get("/api/history", headers={
            "Authorization": "Bearer " + opponent["access_token"],
        })
        assert opponent_history.json()[0]["result"] == "loss"


def test_match_stake_is_atomic_and_locking_is_idempotent():
    first_payload = credentials()
    second_payload = credentials()
    with TestClient(app) as client:
        first = client.post("/api/auth/register", json=first_payload).json()["user"]
        second = client.post("/api/auth/register", json=second_payload).json()["user"]

        with SessionLocal.begin() as db:
            db.get(User, second["id"]).arena_coins = 50

        room = Room("STAKE1", "first", [
            Player("first", first_payload["username"], user_id=first["id"],
                   coin_balance=first["arena_coins"]),
            Player("second", second_payload["username"], user_id=second["id"],
                   coin_balance=50),
        ], wager=100)

        room.players[1].connected = False
        try:
            lock_room_wager(room)
            assert False, "Disconnected players must not be charged for a wager"
        except ValueError as error:
            assert "reconnect" in str(error)
        room.players[1].connected = True

        try:
            lock_room_wager(room)
            assert False, "Insufficient balance must reject the entire stake"
        except ValueError as error:
            assert "enough Virtual Naira" in str(error)

        with SessionLocal() as db:
            assert db.get(User, first["id"]).arena_coins == first["arena_coins"]
            assert db.get(User, second["id"]).arena_coins == 50

        with SessionLocal.begin() as db:
            db.get(User, second["id"]).arena_coins = 1_000
        lock_room_wager(room)
        locked_balances = [player.coin_balance for player in room.players]
        lock_room_wager(room)

        assert room.wager_locked is True
        assert [player.coin_balance for player in room.players] == locked_balances
        assert locked_balances == [first["arena_coins"] - 100, 900]


def test_duplicate_match_completion_cannot_duplicate_virtual_coin_payout():
    first_payload = credentials()
    second_payload = credentials()
    with TestClient(app) as client:
        first = client.post("/api/auth/register", json=first_payload).json()["user"]
        second = client.post("/api/auth/register", json=second_payload).json()["user"]
        room = Room("PAYOUT1", "winner", [
            Player("winner", first_payload["username"], user_id=first["id"]),
            Player("opponent", second_payload["username"], user_id=second["id"]),
        ], wager=100, wager_locked=True)
        room.status = "finished"
        room.match_winner = "winner"

        record_match(room)
        room.result_recorded = False
        record_match(room)

        with SessionLocal() as db:
            winner_balance = db.get(User, first["id"]).arena_coins
            treasury = db.get(ArenaTreasury, 1)

        assert winner_balance == first["arena_coins"] + 180
        assert treasury.virtual_naira_balance == 20
        assert room.wager_paid is True
        assert room.wager_locked is False


def test_match_history_requires_authentication():
    with TestClient(app) as client:
        assert client.get("/api/history").status_code == 401


def test_admin_access_requires_an_explicit_email_allowlist(monkeypatch):
    user = User(username="admin_candidate", email="admin@example.com",
                password_hash="unused")
    monkeypatch.delenv("ADMIN_EMAILS", raising=False)

    assert user.is_admin is False

    monkeypatch.setenv("ADMIN_EMAILS", "other@example.com, ADMIN@example.com ")
    assert user.is_admin is True


def test_cors_preflight_allows_account_mutation_methods():
    with TestClient(app) as client:
        for method, path in (
            ("PUT", "/api/profile/cosmetics"),
            ("DELETE", "/api/friends/player"),
        ):
            response = client.options(path, headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": method,
                "Access-Control-Request-Headers": "authorization,content-type",
            })

            assert response.status_code == 200
            assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
            assert method in response.headers["access-control-allow-methods"]


def test_health_endpoint_checks_database_and_exposes_liveness():
    with TestClient(app) as client:
        readiness = client.get("/health")
        liveness = client.get("/health/live")

    assert readiness.status_code == 200
    assert readiness.json()["database"] == "ok"
    assert liveness.status_code == 200


def test_production_configuration_requires_postgres_and_exact_https_origins():
    validate_production_config(
        "production",
        "https://arena.example.com,https://admin.example.com",
        "postgresql+psycopg://user:password@db.example.com/arena",
    )
    for origins, database_url in (
        ("https://arena.example.com", "sqlite:///local.db"),
        ("*", "postgresql+psycopg://user:password@db.example.com/arena"),
        ("http://arena.example.com", "postgresql+psycopg://user:password@db.example.com/arena"),
        (None, "postgresql+psycopg://user:password@db.example.com/arena"),
    ):
        try:
            validate_production_config("production", origins, database_url)
            assert False, "Unsafe production configuration must fail startup validation"
        except RuntimeError:
            pass


def test_virtual_wagers_fail_closed_in_production():
    ensure_wager_available("production", 0)
    ensure_wager_available("development", 100)

    try:
        ensure_wager_available("production", 100)
        assert False, "Production must not accept unrecoverable stake locks"
    except ValueError as error:
        assert "disabled" in str(error)
