import json
import socket
import subprocess
import time
import urllib.request

import base64
import pytest
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


def receive_type(socket, expected):
    for _ in range(12):
        message = json.loads(socket.recv(timeout=2))
        if message["type"] == expected:
            return message
    raise AssertionError(f"Did not receive message type {expected}")


def create(socket, name="Ada"):
    send(socket, {"action": "create", "name": name})
    session = receive_type(socket, "session")
    state = receive_type(socket, "state")["data"]
    return session, state


def join(socket, code, name):
    send(socket, {"action": "join", "code": code, "name": name})
    session = receive_type(socket, "session")
    state = receive_type(socket, "state")["data"]
    return session, state


def test_match_authorization_privacy_and_reconnect(server_url):
    with connect(server_url) as host:
        host_session, lobby = create(host)
        assert lobby["status"] == "lobby"
        assert host_session["reconnect_token"] not in repr(lobby)
        with connect(server_url) as guest:
            guest_session, _ = join(guest, host_session["code"], "Ben")
            receive_type(host, "state")
            send(guest, {"action": "start"})
            assert receive_type(guest, "error")["message"] == "Only the host can start a lobby"
            send(host, {"action": "start"})
            host_state = receive_type(host, "state")["data"]
            guest_state = receive_type(guest, "state")["data"]
            assert len(host_state["hand"]) == len(guest_state["hand"]) == 5
            assert host_state["hand"] != guest_state["hand"]
            assert all("hand" not in player for player in host_state["players"])
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
                            "reconnect_token": guest_session["reconnect_token"]})
            assert receive_type(restored, "session")["player_id"] == guest_session["player_id"]
            assert len(receive_type(restored, "state")["data"]["hand"]) == 5


def test_refresh_reconnect_replaces_the_previous_socket(server_url):
    with connect(server_url) as original:
        session, _ = create(original)
        with connect(server_url) as refreshed:
            send(refreshed, {"action": "reconnect", "code": session["code"],
                             "player_id": session["player_id"],
                             "reconnect_token": session["reconnect_token"]})
            resumed = receive_type(refreshed, "session")
            assert resumed["player_id"] == session["player_id"]
            state = receive_type(refreshed, "state")["data"]
            assert state["code"] == session["code"]
            assert state["players"][0]["connected"] is True


def test_live_voice_signaling_is_relayed_only_to_target_player(server_url):
    with connect(server_url) as host:
        host_session, _ = create(host)
        with connect(server_url) as guest:
            guest_session, _ = join(guest, host_session["code"], "Ben")
            receive_type(host, "state")
            offer = {"type": "offer", "sdp": {"type": "offer", "sdp": "test-sdp"}}
            send(host, {"action": "rtc_signal", "target": guest_session["player_id"],
                        "signal": offer})
            relayed = receive_type(guest, "rtc_relay")
            assert relayed["from"] == host_session["player_id"]
            assert relayed["signal"] == offer


def test_room_rejects_fifth_player_and_duplicate_session(server_url):
    sockets = []
    try:
        host = connect(server_url, legacy=True)
        sockets.append(host)
        session, _ = create(host)
        for name in ("B", "C", "D"):
            guest = connect(server_url, legacy=True)
            sockets.append(guest)
            join(guest, session["code"], name)
            receive_type(host, "state")
        with connect(server_url) as fifth:
            send(fifth, {"action": "join", "code": session["code"], "name": "E"})
            assert receive_type(fifth, "error")["message"] == "Room is full"
        send(host, {"action": "create", "name": "Again"})
        assert receive_type(host, "error")["message"] == "This connection already has a session"
    finally:
        for active in reversed(sockets):
            active.close()


def test_quick_match_pairs_and_starts_two_players(server_url):
    with connect(server_url) as first:
        send(first, {"action": "quick_match", "name": "Quick A"})
        first_session = receive_type(first, "session")
        waiting = receive_type(first, "state")["data"]
        assert waiting["status"] == "lobby"
        assert waiting["is_public"] is True
        with connect(server_url) as second:
            send(second, {"action": "quick_match", "name": "Quick B"})
            second_session = receive_type(second, "session")
            second_state = receive_type(second, "state")["data"]
            first_state = receive_type(first, "state")["data"]
            assert first_session["code"] == second_session["code"]
            assert first_state["status"] == second_state["status"] == "playing"
            assert len(first_state["players"]) == 2


def test_computer_match_starts_immediately_and_bot_replies(server_url):
    with connect(server_url) as player:
        send(player, {"action": "computer", "name": "Solo"})
        session = receive_type(player, "session")
        state = receive_type(player, "state")["data"]
        assert state["status"] == "playing"
        assert len(state["players"]) == 2
        assert next(p for p in state["players"] if p["id"] != session["player_id"])["is_bot"]
        send(player, {"action": "draw"})
        replied = receive_type(player, "state")["data"]
        assert replied["status"] in {"playing", "finished"}
        if replied["status"] == "playing":
            assert replied["turn"] == session["player_id"]


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
        with client.websocket_connect(
            "/ws", headers={"origin": "http://localhost:5000"}
        ) as socket:
            socket.send_json({"action": "create", "name": "Flutter Web"})
            assert socket.receive_json()["type"] == "session"


def test_room_voice_message_broadcasts_metadata_and_serves_audio_to_members(server_url):
    audio = b"sample webm voice bytes"
    with connect(server_url) as host:
        host_session, _ = create(host)
        with connect(server_url) as guest:
            join(guest, host_session["code"], "Ben")
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
