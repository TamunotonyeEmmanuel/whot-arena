from uuid import uuid4

from fastapi.testclient import TestClient

from app import accounts
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
        updated_profile = client.put(
            "/api/profile",
            headers={"Authorization": f"Bearer {token}"},
            json={"username": "renamed_player"},
        )
        assert updated_profile.status_code == 200, updated_profile.text
        assert updated_profile.json()["username"] == "renamed_player"
        assert client.get(
            "/api/profile",
            headers={"Authorization": f"Bearer {token}"},
        ).json()["username"] == "renamed_player"
        assert client.put("/api/profile", json={"username": "another_name"}).status_code == 401
        assert client.put(
            "/api/profile",
            headers={"Authorization": f"Bearer {token}"},
            json={"username": "x"},
        ).status_code == 422
        history = client.get("/api/history", headers={"Authorization": f"Bearer {token}"})
        assert history.status_code == 200
        assert history.json() == []

        leaderboard = client.get("/api/leaderboard")
        assert leaderboard.status_code == 200
        assert any(player["username"] == "renamed_player" for player in leaderboard.json())


def test_profile_username_update_rejects_duplicate_name():
    first = credentials()
    second = credentials()
    with TestClient(app) as client:
        client.post("/api/auth/register", json=first)
        second_user = client.post("/api/auth/register", json=second).json()
        response = client.put(
            "/api/profile",
            headers={"Authorization": f"Bearer {second_user['access_token']}"},
            json={"username": first["username"].upper()},
        )
        assert response.status_code == 409


def test_admin_can_change_default_rules_and_player_can_override_for_private_game(monkeypatch):
    admin_payload = credentials()
    player_payload = credentials()
    monkeypatch.setenv("ADMIN_EMAILS", admin_payload["email"])
    custom_rules = {
        "cards_per_player": 7,
        "pick_two": 4,
        "pick_three": 5,
        "pick_three_enabled": False,
        "general_market": 2,
        "penalty_stacking": False,
    }

    with TestClient(app) as client:
        admin = client.post("/api/auth/register", json=admin_payload).json()
        player = client.post("/api/auth/register", json=player_payload).json()
        admin_headers = {"Authorization": f"Bearer {admin['access_token']}"}
        player_headers = {"Authorization": f"Bearer {player['access_token']}"}

        assert client.get("/api/admin/rules", headers=player_headers).status_code == 403
        defaults = client.get("/api/game-rules")
        assert defaults.status_code == 200
        assert defaults.json() == {
            "cards_per_player": 5,
            "pick_two": 2,
            "pick_three": 3,
            "pick_three_enabled": True,
            "general_market": 1,
            "penalty_stacking": True,
        }

        changed = client.put(
            "/api/admin/rules",
            headers=admin_headers,
            json=custom_rules,
        )
        assert changed.status_code == 200, changed.text
        assert changed.json() == custom_rules
        assert client.get("/api/game-rules").json() == custom_rules
        assert client.put(
            "/api/admin/rules",
            headers=admin_headers,
            json={**custom_rules, "cards_per_player": 20},
        ).status_code == 422

        with client.websocket_connect("/ws") as websocket:
            websocket.send_json({
                "action": "create",
                "name": player_payload["username"],
                "access_token": player["access_token"],
                "rules": {
                    **custom_rules,
                    "cards_per_player": 8,
                    "penalty_stacking": True,
                },
            })
            assert websocket.receive_json()["type"] == "session"
            room_state = websocket.receive_json()
            assert room_state["type"] == "state"
            assert room_state["data"]["rules"] == {
                **custom_rules,
                "cards_per_player": 8,
                "penalty_stacking": True,
            }
        restored = client.put(
            "/api/admin/rules",
            headers=admin_headers,
            json={
                "cards_per_player": 5,
                "pick_two": 2,
                "pick_three": 3,
                "pick_three_enabled": True,
                "general_market": 1,
                "penalty_stacking": True,
            },
        )
        assert restored.status_code == 200


def test_quick_match_uses_selected_rules_and_only_matches_the_same_setup():
    players = [credentials() for _ in range(3)]
    with TestClient(app) as client:
        tokens = [
            client.post("/api/auth/register", json=player).json()["access_token"]
            for player in players
        ]
        selected_rules = {
            "cards_per_player": 7,
            "pick_two": 4,
            "pick_three": 5,
            "pick_three_enabled": False,
            "general_market": 2,
            "penalty_stacking": False,
        }
        different_rules = {**selected_rules, "cards_per_player": 6}
        with client.websocket_connect("/ws") as first:
            first.send_json({
                "action": "quick_match",
                "name": players[0]["username"],
                "access_token": tokens[0],
                "rules": selected_rules,
            })
            first_session = first.receive_json()
            first_state = first.receive_json()["data"]
            assert first_state["rules"] == selected_rules

            with client.websocket_connect("/ws") as second:
                second.send_json({
                    "action": "quick_match",
                    "name": players[1]["username"],
                    "access_token": tokens[1],
                    "rules": different_rules,
                })
                second_session = second.receive_json()
                second_state = second.receive_json()["data"]
                assert second_session["code"] != first_session["code"]
                assert second_state["rules"] == different_rules

                with client.websocket_connect("/ws") as third:
                    third.send_json({
                        "action": "quick_match",
                        "name": players[2]["username"],
                        "access_token": tokens[2],
                        "rules": selected_rules,
                    })
                    third_session = third.receive_json()
                    third_state = third.receive_json()["data"]
                    assert third_session["code"] == first_session["code"]
                    assert third_state["status"] == "playing"
                    assert third_state["rules"] == selected_rules
                    assert len(third_state["hand"]) == selected_rules["cards_per_player"]


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


def test_google_sign_in_creates_and_reuses_account(monkeypatch):
    claims = {
        "sub": "google-sub-123",
        "email": "google.player@gmail.com",
        "email_verified": True,
        "iss": "https://accounts.google.com",
    }
    monkeypatch.setattr(accounts, "verify_google_credential", lambda credential: claims)

    with TestClient(app) as client:
        username_prompt = client.post("/api/auth/google", json={"credential": "google-token"})
        assert username_prompt.status_code == 202
        assert username_prompt.json() == {"requires_username": True}
        with SessionLocal() as db:
            assert db.query(User).filter_by(google_sub="google-sub-123").count() == 0
        first = client.post("/api/auth/google", json={
            "credential": "google-token",
            "username": "GooglePlayer",
        })
        second = client.post("/api/auth/google", json={"credential": "google-token"})

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    first_user = first.json()["user"]
    second_user = second.json()["user"]
    assert first_user["id"] == second_user["id"]
    assert first_user["username"] == "GooglePlayer"
    assert first_user["email"] == "google.player@gmail.com"
    assert first_user["arena_coins"] == 10_000
    assert first.json()["access_token"]
    with SessionLocal() as db:
        assert db.query(User).filter_by(google_sub="google-sub-123").count() == 1


def test_google_sign_in_links_verified_email_to_existing_account(monkeypatch):
    payload = credentials()
    claims = {
        "sub": "google-sub-link",
        "email": payload["email"].upper(),
        "email_verified": True,
        "iss": "accounts.google.com",
    }
    monkeypatch.setattr(accounts, "verify_google_credential", lambda credential: claims)

    with TestClient(app) as client:
        registered = client.post("/api/auth/register", json=payload).json()
        signed_in = client.post("/api/auth/google", json={"credential": "google-token"})
        password_login = client.post("/api/auth/login", json={
            "email": payload["email"],
            "password": payload["password"],
        })

    assert signed_in.status_code == 200, signed_in.text
    assert signed_in.json()["user"]["id"] == registered["user"]["id"]
    assert password_login.status_code == 200
    with SessionLocal() as db:
        user = db.get(User, registered["user"]["id"])
        assert user.google_sub == "google-sub-link"
        assert user.arena_coins == 10_000


def test_google_sign_in_rejects_another_identity_for_linked_email(monkeypatch):
    claims = {
        "sub": "google-sub-original",
        "email": "linked.player@gmail.com",
        "email_verified": True,
        "iss": "https://accounts.google.com",
    }
    monkeypatch.setattr(accounts, "verify_google_credential", lambda credential: claims)

    with TestClient(app) as client:
        first = client.post("/api/auth/google", json={
            "credential": "first-token",
            "username": "LinkedPlayer",
        })
        claims["sub"] = "google-sub-other"
        second = client.post("/api/auth/google", json={"credential": "second-token"})

    assert first.status_code == 200
    assert second.status_code == 409


def test_google_sign_up_requires_unique_valid_username(monkeypatch):
    claims = {
        "sub": "google-sub-username",
        "email": "google.username@gmail.com",
        "email_verified": True,
        "iss": "https://accounts.google.com",
    }
    monkeypatch.setattr(accounts, "verify_google_credential", lambda credential: claims)

    with TestClient(app) as client:
        existing = client.post("/api/auth/register", json=credentials())
        duplicate = client.post("/api/auth/google", json={
            "credential": "google-token",
            "username": existing.json()["user"]["username"].upper(),
        })
        invalid = client.post("/api/auth/google", json={
            "credential": "google-token",
            "username": "not a username",
        })

    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "Username already exists"
    assert invalid.status_code == 422


def test_google_credential_requires_server_configuration_and_verified_email(monkeypatch):
    monkeypatch.delenv("GOOGLE_CLIENT_ID", raising=False)
    with TestClient(app) as client:
        unavailable = client.post("/api/auth/google", json={"credential": "google-token"})
    assert unavailable.status_code == 503

    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-id.apps.googleusercontent.com")
    monkeypatch.setattr(accounts.id_token, "verify_oauth2_token", lambda *args, **kwargs: {
        "sub": "google-sub-unverified",
        "email": "unverified@gmail.com",
        "email_verified": False,
        "iss": "https://accounts.google.com",
    })
    with TestClient(app) as client:
        rejected = client.post("/api/auth/google", json={"credential": "google-token"})
    assert rejected.status_code == 401


def test_google_credential_verification_uses_configured_client_id(monkeypatch):
    client_id = "arena-client.apps.googleusercontent.com"
    claims = {
        "sub": "verified-google-sub",
        "email": "verified@gmail.com",
        "email_verified": True,
        "iss": "https://accounts.google.com",
    }
    monkeypatch.setenv("GOOGLE_CLIENT_ID", client_id)
    verifier_arguments = {}

    def verify_token(token, request, audience):
        verifier_arguments.update(token=token, audience=audience)
        return claims

    monkeypatch.setattr(accounts.id_token, "verify_oauth2_token", verify_token)

    assert accounts.verify_google_credential("signed-google-token") == claims
    assert verifier_arguments == {
        "token": "signed-google-token",
        "audience": client_id,
    }


def test_admin_can_manage_accounts_and_audit_wallet_adjustments(monkeypatch):
    admin_payload = credentials()
    target_payload = credentials()
    monkeypatch.setenv(
        "ADMIN_EMAILS",
        f"{admin_payload['email']},future-admin@example.com",
    )

    with TestClient(app) as client:
        admin = client.post("/api/auth/register", json=admin_payload).json()
        target = client.post("/api/auth/register", json=target_payload).json()
        admin_headers = {"Authorization": f"Bearer {admin['access_token']}"}
        target_headers = {"Authorization": f"Bearer {target['access_token']}"}
        target_id = target["user"]["id"]

        assert client.get("/api/admin/users", headers=target_headers).status_code == 403
        assert client.get("/api/admin/users").status_code == 401

        listing = client.get("/api/admin/users?q=" + target_payload["username"], headers=admin_headers)
        assert listing.status_code == 200
        assert listing.json()["total"] == 1
        assert listing.json()["items"][0]["id"] == target_id

        reserved_email = client.put(
            f"/api/admin/users/{target_id}",
            headers=admin_headers,
            json={"username": target_payload["username"], "email": "future-admin@example.com"},
        )
        assert reserved_email.status_code == 409

        edited = client.put(
            f"/api/admin/users/{target_id}",
            headers=admin_headers,
            json={"username": "managed_player", "email": "managed@example.com"},
        )
        assert edited.status_code == 200, edited.text
        assert edited.json()["username"] == "managed_player"
        assert edited.json()["email"] == "managed@example.com"

        funded = client.post(
            f"/api/admin/users/{target_id}/fund",
            headers=admin_headers,
            json={"amount": 500, "reason": "Welcome grant"},
        )
        assert funded.status_code == 200, funded.text
        assert funded.json()["balance"] == 10_500

        debited = client.post(
            f"/api/admin/users/{target_id}/debit",
            headers=admin_headers,
            json={"amount": 200, "reason": "Balance correction"},
        )
        assert debited.status_code == 200, debited.text
        assert debited.json()["balance"] == 10_300
        insufficient = client.post(
            f"/api/admin/users/{target_id}/debit",
            headers=admin_headers,
            json={"amount": 20_000, "reason": "Invalid debit"},
        )
        assert insufficient.status_code == 400

        history = client.get(
            f"/api/admin/users/{target_id}/wallet-history",
            headers=admin_headers,
        )
        assert history.status_code == 200
        assert [entry["action"] for entry in history.json()] == ["debit", "fund"]
        assert history.json()[0]["reason"] == "Balance correction"

        protected = client.delete(
            f"/api/admin/users/{admin['user']['id']}",
            headers=admin_headers,
        )
        assert protected.status_code == 403


def test_admin_delete_anonymizes_account_and_revokes_access(monkeypatch):
    admin_payload = credentials()
    target_payload = credentials()
    monkeypatch.setenv("ADMIN_EMAILS", admin_payload["email"])

    with TestClient(app) as client:
        admin = client.post("/api/auth/register", json=admin_payload).json()
        target = client.post("/api/auth/register", json=target_payload).json()
        admin_headers = {"Authorization": f"Bearer {admin['access_token']}"}
        target_headers = {"Authorization": f"Bearer {target['access_token']}"}
        target_id = target["user"]["id"]

        deleted = client.delete(f"/api/admin/users/{target_id}", headers=admin_headers)
        assert deleted.status_code == 200, deleted.text
        assert client.get("/api/profile", headers=target_headers).status_code == 401
        assert client.post("/api/auth/login", json={
            "email": target_payload["email"],
            "password": target_payload["password"],
        }).status_code == 401

        with SessionLocal() as db:
            deleted_user = db.get(User, target_id)
            assert deleted_user.deleted_at is not None
            assert deleted_user.email.startswith(f"deleted-{target_id}-")
            assert deleted_user.username.startswith(f"deleted_{target_id}_")

        active_users = client.get("/api/admin/users", headers=admin_headers)
        assert active_users.status_code == 200
        assert target_id not in {user["id"] for user in active_users.json()["items"]}


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

def test_team_match_records_both_teammates_as_winners():
    players = [credentials() for _ in range(4)]
    with TestClient(app) as client:
        registrations = [
            client.post("/api/auth/register", json=payload).json()
            for payload in players
        ]
        accounts = [registration["user"] for registration in registrations]
        room = Room("TEAMSTATS", "p1", [
            Player(f"p{index + 1}", payload["username"],
                   user_id=account["id"], team=index % 2 + 1)
            for index, (payload, account) in enumerate(zip(players, accounts))
        ], team_mode=True, status="finished", match_winner="p3")

        record_match(room)

        for index in range(len(accounts)):
            profile = client.get("/api/profile", headers={
                "Authorization": "Bearer " + registrations[index]["access_token"],
            }).json()
            assert profile["wins"] == (1 if index in (0, 2) else 0)
            history = client.get("/api/history", headers={
                "Authorization": "Bearer " + registrations[index]["access_token"],
            }).json()
            assert history[0]["result"] == (
                "win" if index in (0, 2) else "loss"
            )


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
