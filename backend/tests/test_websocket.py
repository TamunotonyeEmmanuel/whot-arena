import os
import json
import socket
import subprocess
import time
import urllib.request
from pathlib import Path

import base64
import pytest
from uuid import uuid4
from starlette.websockets import WebSocketDisconnect
from websockets.sync.client import connect


@pytest.fixture(scope="module")
def server_url():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    process = subprocess.Popen(
        [".venv/bin/python", "-m", "uvicorn", "app.main:app",
         "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    health = f"http://127.0.0.1:{port}/health"
    for _ in range(50):
        try:
            with urllib.request.urlopen(health, timeout=0.2) as response:
                if response.status == 200:
                    break
        except Exception:
            time.sleep(0.1)
    else:
        process.terminate()
        output, _ = process.communicate(timeout=5)
        pytest.fail(f"Test server did not start: {output}")
    yield f"ws://127.0.0.1:{port}/ws"
    process.terminate()
    process.wait(timeout=5)


def send(socket, message):
    socket.send(json.dumps(message))


def receive_type(socket, expected, timeout=2):
    for _ in range(12):
        message = json.loads(socket.recv(timeout=timeout))
        if message["type"] == expected:
            return message
    raise AssertionError(f"Did not receive message type {expected}")


def account_token(server_url):
    endpoint = server_url.replace("ws://", "http://", 1).removesuffix("/ws")
    suffix = uuid4().hex
    payload = json.dumps({
        "username": f"player_{suffix[:12]}",
        "email": f"{suffix}@example.com",
        "password": "A-secure-password-123",
    }).encode()
    request = urllib.request.Request(
        f"{endpoint}/api/auth/register",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.loads(response.read())["access_token"]


def api_json(server_url, path, token, method="GET"):
    endpoint = server_url.replace("ws://", "http://", 1).removesuffix("/ws")
    request = urllib.request.Request(
        f"{endpoint}{path}",
        method=method,
        headers={"Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def notification_socket(server_url, token):
    endpoint = server_url.removesuffix("/ws") + "/ws/notifications"
    socket = connect(endpoint)
    send(socket, {"access_token": token})
    assert receive_type(socket, "ready")["type"] == "ready"
    return socket


def launch_restart_test_server(database_url):
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    environment = os.environ.copy()
    environment["DATABASE_URL"] = database_url
    process = subprocess.Popen(
        [".venv/bin/python", "-m", "uvicorn", "app.main:app",
         "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
        cwd=Path(__file__).resolve().parents[1],
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    health = f"http://127.0.0.1:{port}/health"
    for _ in range(50):
        if process.poll() is not None:
            output, _ = process.communicate(timeout=5)
            pytest.fail(f"Restart test server exited: {output}")
        try:
            with urllib.request.urlopen(health, timeout=0.2) as response:
                if response.status == 200:
                    return process, f"ws://127.0.0.1:{port}/ws"
        except OSError:
            time.sleep(0.1)
    process.terminate()
    output, _ = process.communicate(timeout=5)
    pytest.fail(f"Restart test server did not start: {output}")


def create(socket, server_url, name="Ada", team_mode=False, access_token=None):
    send(socket, {
        "action": "create",
        "name": name,
        "team_mode": team_mode,
        "access_token": access_token or account_token(server_url),
    })
    session = receive_type(socket, "session")
    state = receive_type(socket, "state")["data"]
    return session, state


def join(socket, server_url, code, name, access_token=None):
    send(socket, {
        "action": "join",
        "code": code,
        "name": name,
        "access_token": access_token or account_token(server_url),
    })
    session = receive_type(socket, "session")
    state = receive_type(socket, "state")["data"]
    return session, state


def test_match_authorization_privacy_and_reconnect(server_url):
    guest_token = account_token(server_url)
    with connect(server_url) as host:
        host_session, lobby = create(host, server_url)
        assert lobby["status"] == "lobby"
        assert host_session["reconnect_token"] not in repr(lobby)
        with connect(server_url) as guest:
            guest_session, _ = join(
                guest, server_url, host_session["code"], "Ben", guest_token,
            )
            receive_type(host, "state")
            send(guest, {"action": "start"})
            assert receive_type(guest, "error")["message"] == "Only the host can start a lobby"
            send(host, {"action": "start"})
            host_state = receive_type(host, "state")["data"]
            guest_state = receive_type(guest, "state")["data"]
            assert len(host_state["hand"]) == len(guest_state["hand"]) == 5
            assert host_state["hand"] != guest_state["hand"]
            assert all("hand" not in player for player in host_state["players"])
            send(host, {"action": "call_last", "target_id": "not-a-player"})
            assert "no opponent to call" in receive_type(host, "error")["message"]
        disconnected = receive_type(host, "state")["data"]
        assert next(p for p in disconnected["players"]
                    if p["id"] == guest_session["player_id"])["connected"] is False
        with connect(server_url) as rejected:
            send(rejected, {"action": "reconnect", "code": guest_session["code"],
                            "player_id": guest_session["player_id"],
                            "reconnect_token": "wrong"})
            assert receive_type(rejected, "error")["message"] == "Session not found"
        with connect(server_url) as restored:
            send(restored, {"action": "reconnect", "code": guest_session["code"],
                            "player_id": guest_session["player_id"],
                            "reconnect_token": guest_session["reconnect_token"],
                            "access_token": guest_token})
            assert receive_type(restored, "session")["player_id"] == guest_session["player_id"]
            assert len(receive_type(restored, "state")["data"]["hand"]) == 5

def test_team_room_requires_four_players_and_assigns_alternating_seats(server_url):
    with connect(server_url) as host:
        host_session, lobby = create(host, server_url, team_mode=True)
        assert lobby["team_mode"] is True
        send(host, {"action": "start"})
        assert "four human players" in receive_type(host, "error")["message"]

        sockets = []
        try:
            for name in ("Ben", "Cleo", "Deji"):
                guest = connect(server_url)
                sockets.append(guest)
                join(guest, server_url, host_session["code"], name)
                receive_type(host, "state")
            send(host, {"action": "start"})
            host_state = receive_type(host, "state")["data"]
            assert host_state["status"] == "playing"
            assert [player["team"] for player in host_state["players"]] == [
                1, 2, 1, 2,
            ]
            for guest in sockets:
                state = receive_type(guest, "state")["data"]
                assert state["team_mode"] is True
        finally:
            for guest in sockets:
                guest.close()


def test_refresh_reconnect_replaces_the_previous_socket(server_url):
    token = account_token(server_url)
    with connect(server_url) as original:
        session, _ = create(original, server_url, access_token=token)
        with connect(server_url) as refreshed:
            send(refreshed, {"action": "reconnect", "code": session["code"],
                             "player_id": session["player_id"],
                             "reconnect_token": session["reconnect_token"],
                             "access_token": token})
            resumed = receive_type(refreshed, "session")
            assert resumed["player_id"] == session["player_id"]
            state = receive_type(refreshed, "state")["data"]
            assert state["code"] == session["code"]
            assert state["players"][0]["connected"] is True


def test_account_can_join_multiple_tables_and_cannot_duplicate_room_membership(server_url):
    token = account_token(server_url)
    with connect(server_url) as first:
        send(first, {"action": "create", "name": "Ada", "access_token": token})
        first_session = receive_type(first, "session")
        receive_type(first, "state")
        with connect(server_url) as second:
            send(second, {"action": "create", "name": "Ada", "access_token": token})
            second_session = receive_type(second, "session")
            receive_type(second, "state")
            assert first_session["code"] != second_session["code"]

            with connect(server_url) as duplicate:
                send(duplicate, {
                    "action": "join",
                    "code": first_session["code"],
                    "name": "Ada again",
                    "access_token": token,
                })
                assert "already belong" in receive_type(duplicate, "error")["message"]

            status, response = api_json(server_url, "/api/tables", token)
            assert status == 200
            assert {table["code"] for table in response["tables"]} == {
                first_session["code"], second_session["code"],
            }
            assert all(table["player_count"] == 1 for table in response["tables"])
            status, resume = api_json(
                server_url, f"/api/tables/{first_session['code']}/resume", token,
                method="POST",
            )
            assert status == 200
            assert resume["player_id"] == first_session["player_id"]

            other_token = account_token(server_url)
            status, _ = api_json(
                server_url, f"/api/tables/{first_session['code']}/resume", other_token,
                method="POST",
            )
            assert status == 404
            status, _ = api_json(
                server_url, f"/api/tables/{first_session['code']}", token,
                method="DELETE",
            )
            assert status == 200
            status, response = api_json(server_url, "/api/tables", token)
            assert status == 200
            assert [table["code"] for table in response["tables"]] == [
                second_session["code"],
            ]


def test_switch_keeps_membership_and_does_not_pause_or_recharge_wager(server_url):
    host_token = account_token(server_url)
    guest_token = account_token(server_url)
    with connect(server_url) as host:
        send(host, {
            "action": "create", "name": "Host", "access_token": host_token, "wager": 10,
        })
        session = receive_type(host, "session")
        receive_type(host, "state")
        with connect(server_url) as guest:
            send(guest, {
                "action": "join", "code": session["code"], "name": "Guest",
                "access_token": guest_token,
            })
            receive_type(guest, "session")
            receive_type(host, "state")
            receive_type(guest, "state")
            send(host, {"action": "start"})
            host_state = receive_type(host, "state")["data"]
            receive_type(guest, "state")
            before = api_json(
                server_url, "/api/profile", host_token,
            )[1]["arena_coins"]
            assert before == 9_990

            send(host, {"action": "switch", "code": session["code"]})
            assert receive_type(host, "switched")["code"] == session["code"]
            guest_state = receive_type(guest, "state")["data"]
            assert guest_state["status"] == "playing"
            assert guest_state["is_paused"] is False

            status, resumed = api_json(
                server_url, f"/api/tables/{session['code']}/resume", host_token,
                method="POST",
            )
            assert status == 200
            with connect(server_url) as restored:
                send(restored, {
                    "action": "reconnect",
                    "code": resumed["code"],
                    "player_id": resumed["player_id"],
                    "reconnect_token": resumed["reconnect_token"],
                    "access_token": host_token,
                })
                receive_type(restored, "session")
                restored_state = receive_type(restored, "state")["data"]
                assert restored_state["hand"] == host_state["hand"]
                after = api_json(
                    server_url, "/api/profile", host_token,
                )[1]["arena_coins"]
                assert after == before


def test_notification_socket_authenticates_and_reports_turn_in_another_table(server_url):
    target_token = account_token(server_url)
    host_token = account_token(server_url)
    with notification_socket(server_url, target_token) as notifications:
        with connect(server_url) as first_table:
            send(first_table, {
                "action": "create", "name": "Target", "access_token": target_token,
            })
            first_session = receive_type(first_table, "session")
            receive_type(first_table, "state")
            send(first_table, {"action": "switch", "code": first_session["code"]})
            receive_type(first_table, "switched")

            with connect(server_url) as host:
                send(host, {"action": "create", "name": "Host", "access_token": host_token})
                host_session = receive_type(host, "session")
                receive_type(host, "state")
                with connect(server_url) as target:
                    send(target, {
                        "action": "join", "code": host_session["code"],
                        "name": "Target", "access_token": target_token,
                    })
                    receive_type(target, "session")
                    receive_type(host, "state")
                    receive_type(target, "state")
                    send(host, {"action": "start"})
                    receive_type(host, "state")
                    receive_type(target, "state")
                    send(target, {"action": "switch", "code": host_session["code"]})
                    receive_type(target, "switched")
                    receive_type(host, "state")

                    send(host, {"action": "draw"})
                    receive_type(host, "state")
                    alert = receive_type(notifications, "turn_notification")
                    assert alert["room_code"] == host_session["code"]
                    assert alert["status"] == "playing"
                    assert "hand" not in alert
                    send(host, {"action": "chat", "text": "Still waiting"})
                    receive_type(host, "state")
                    with pytest.raises(TimeoutError):
                        notifications.recv(timeout=0.2)


def test_notification_socket_rejects_missing_authentication():
    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app) as client:
        with client.websocket_connect("/ws/notifications") as socket:
            socket.send_json({})
            assert socket.receive_json()["type"] == "error"
            with pytest.raises(WebSocketDisconnect) as closed:
                socket.receive_json()
            assert closed.value.code == 1008


def test_live_voice_signaling_is_relayed_only_to_target_player(server_url):
    with connect(server_url) as host:
        host_session, _ = create(host, server_url)
        with connect(server_url) as guest:
            guest_session, _ = join(guest, server_url, host_session["code"], "Ben")
            receive_type(host, "state")
            offer = {"type": "offer", "sdp": {"type": "offer", "sdp": "test-sdp"}}
            send(host, {"action": "rtc_signal", "target": guest_session["player_id"],
                        "signal": offer})
            relayed = receive_type(guest, "rtc_relay")
            assert relayed["from"] == host_session["player_id"]
            assert relayed["signal"] == offer


def test_live_audio_fallback_is_sent_only_to_requested_ready_player(server_url):
    with connect(server_url) as host:
        host_session, _ = create(host, server_url)
        with connect(server_url) as guest, connect(server_url) as bystander:
            guest_session, _ = join(guest, server_url, host_session["code"], "Ben")
            receive_type(host, "state")
            bystander_session, _ = join(
                bystander, server_url, host_session["code"], "Cleo"
            )
            receive_type(host, "state")
            receive_type(guest, "state")

            send(guest, {"action": "rtc_ready"})
            send(bystander, {"action": "rtc_ready"})
            for socket in (host, guest, bystander):
                receive_type(socket, "state")
                receive_type(socket, "state")

            send(host, {
                "action": "rtc_audio",
                "audio": "AQI=",
                "target_ids": [guest_session["player_id"]],
            })
            relayed = receive_type(guest, "rtc_audio")
            assert relayed["from"] == host_session["player_id"]
            assert relayed["audio"] == "AQI="
            with pytest.raises(TimeoutError):
                bystander.recv(timeout=0.2)

            send(host, {
                "action": "rtc_audio",
                "audio": "AQI=",
                "target_ids": [bystander_session["player_id"], "not-a-player"],
            })
            assert receive_type(host, "error")["message"] == "Live voice recipient is unavailable"


def test_room_rejects_fifth_player_and_duplicate_session(server_url):
    sockets = []
    try:
        host = connect(server_url, legacy=True)
        sockets.append(host)
        session, _ = create(host, server_url)
        for name in ("B", "C", "D"):
            guest = connect(server_url, legacy=True)
            sockets.append(guest)
            join(guest, server_url, session["code"], name)
            receive_type(host, "state")
        with connect(server_url) as fifth:
            send(fifth, {
                "action": "join",
                "code": session["code"],
                "name": "E",
                "access_token": account_token(server_url),
            })
            assert receive_type(fifth, "error")["message"] == "Room is full"
        send(host, {"action": "create", "name": "Again"})
        assert receive_type(host, "error")["message"] == "This connection already has a session"
    finally:
        for active in reversed(sockets):
            active.close()


def test_quick_match_pairs_and_starts_two_players(server_url):
    with connect(server_url) as first:
        send(first, {
            "action": "quick_match",
            "name": "Quick A",
            "access_token": account_token(server_url),
        })
        first_session = receive_type(first, "session")
        waiting = receive_type(first, "state")["data"]
        assert waiting["status"] == "lobby"
        assert waiting["is_public"] is True
        with connect(server_url) as second:
            send(second, {
                "action": "quick_match",
                "name": "Quick B",
                "access_token": account_token(server_url),
            })
            second_session = receive_type(second, "session")
            second_state = receive_type(second, "state")["data"]
            first_state = receive_type(first, "state")["data"]
            assert first_session["code"] == second_session["code"]
            assert first_state["status"] == second_state["status"] == "playing"
            assert len(first_state["players"]) == 2


def test_computer_match_starts_immediately_and_bot_replies(server_url):
    with connect(server_url) as player:
        send(player, {
            "action": "computer",
            "name": "Solo",
            "access_token": account_token(server_url),
        })
        session = receive_type(player, "session")
        state = receive_type(player, "state")["data"]
        assert state["status"] == "playing"
        assert len(state["players"]) == 2
        assert next(p for p in state["players"] if p["id"] != session["player_id"])["is_bot"]
        send(player, {"action": "draw"})
        replied = receive_type(player, "state")["data"]
        assert replied["turn"] != session["player_id"]
        bot_replied = receive_type(player, "state", timeout=6)["data"]
        assert bot_replied["state_version"] > replied["state_version"]
        replied = bot_replied
        assert replied["status"] in {"playing", "finished"}


def test_untrusted_websocket_origin_is_rejected():
    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect) as closed:
            with client.websocket_connect(
                "/ws", headers={"origin": "https://untrusted.example"}
            ):
                pass
        assert closed.value.code == 1008

def test_flutter_web_development_origin_remains_allowed():
    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app) as client:
        suffix = uuid4().hex
        registered = client.post("/api/auth/register", json={
            "username": f"flutter_{suffix[:12]}",
            "email": f"{suffix}@example.com",
            "password": "A-secure-password-123",
        })
        assert registered.status_code == 201
        with client.websocket_connect(
            "/ws", headers={"origin": "http://localhost:5000"}
        ) as socket:
            socket.send_json({
                "action": "create",
                "name": "Flutter Web",
                "access_token": registered.json()["access_token"],
            })
            assert socket.receive_json()["type"] == "session"


def test_room_creation_requires_authenticated_account(server_url):
    with connect(server_url) as unauthenticated:
        send(unauthenticated, {"action": "create", "name": "Guest"})
        response = receive_type(unauthenticated, "error")

    assert response["message"] == "Log in before playing a game"


def test_active_room_survives_backend_process_restart(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'restart.db'}"
    process, server_url = launch_restart_test_server(database_url)
    try:
        host_token = account_token(server_url)
        guest_token = account_token(server_url)
        with connect(server_url) as host:
            host_session, _ = create(host, server_url, access_token=host_token)
            with connect(server_url) as guest:
                guest_session, _ = join(
                    guest, server_url, host_session["code"], "Ben", guest_token,
                )
                receive_type(host, "state")
                send(host, {"action": "start"})
                host_state = receive_type(host, "state")["data"]
                receive_type(guest, "state")
                host_hand = host_state["hand"]
                assert host_hand

                process.terminate()
                process.wait(timeout=5)
                process, server_url = launch_restart_test_server(database_url)

                with connect(server_url) as restored_host:
                    send(restored_host, {
                        "action": "reconnect",
                        "code": host_session["code"],
                        "player_id": host_session["player_id"],
                        "reconnect_token": host_session["reconnect_token"],
                        "access_token": host_token,
                    })
                    restored_session = receive_type(restored_host, "session")
                    restored_state = receive_type(restored_host, "state")["data"]
                    assert restored_session["player_id"] == host_session["player_id"]
                    assert restored_state["hand"] == host_hand
                    assert restored_state["is_paused"] is True

                    with connect(server_url) as restored_guest:
                        send(restored_guest, {
                            "action": "reconnect",
                            "code": guest_session["code"],
                            "player_id": guest_session["player_id"],
                            "reconnect_token": guest_session["reconnect_token"],
                            "access_token": guest_token,
                        })
                        receive_type(restored_guest, "session")
                        guest_state = receive_type(restored_guest, "state")["data"]
                        assert len(guest_state["hand"]) == 5
                        assert guest_state["hand"] != restored_state["hand"]
                        assert guest_state["is_paused"] is False
    finally:
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=5)


def test_room_voice_message_broadcasts_metadata_and_serves_audio_to_members(server_url):
    audio = b"sample webm voice bytes"
    with connect(server_url) as host:
        host_session, _ = create(host, server_url)
        with connect(server_url) as guest:
            join(guest, server_url, host_session["code"], "Ben")
            receive_type(host, "state")
            send(host, {"action": "start"})
            receive_type(host, "state")
            receive_type(guest, "state")

            send(host, {
                "action": "voice",
                "content_type": "audio/webm",
                "audio": base64.b64encode(audio).decode("ascii"),
            })
            host_state = receive_type(host, "state")["data"]
            guest_state = receive_type(guest, "state")["data"]
            message = guest_state["voice_messages"][0]
            assert host_state["voice_messages"] == guest_state["voice_messages"]
            assert message["name"] == "Ada"
            assert message["size"] == len(audio)
            assert "audio" not in message

            send(guest, {"action": "voice_get", "message_id": message["id"]})
            response = receive_type(guest, "voice_audio")
            assert response["id"] == message["id"]
            assert base64.b64decode(response["audio"]) == audio

            send(host, {"action": "voice", "content_type": "audio/webm", "audio": "!bad!"})
            assert "base64" in receive_type(host, "error")["message"]
