import base64
import binascii
import asyncio
import secrets
import time
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from .game import TURN_SECONDS, VOICE_MAX_BYTES, Room, Player
from .accounts import router as accounts_router
from .auth import token_user_id
from .database import MatchParticipant, MatchResult, User, database_session, init_database

rooms = {}
connections = {}  # player id -> websocket
RECONNECT_SECONDS = 30
LOBBY_RECONNECT_SECONDS = 10 * 60
LOBBY_IDLE_SECONDS = 15 * 60
FINISHED_IDLE_SECONDS = 5 * 60
state_lock = asyncio.Lock()
computer_tasks = {}
COMPUTER_MOVE_DELAY_SECONDS = 1.35

def message_user_id(msg):
    token = msg.get("access_token")
    user_id = token_user_id(token)
    if token and user_id is None:
        raise ValueError("Invalid access token")
    return user_id

def new_room_code():
    """Return a short room code that is unique in this server process."""
    for _ in range(100):
        code = secrets.token_hex(3).upper()
        if code not in rooms:
            return code
    raise RuntimeError("Could not allocate a room code")

async def send(ws, data):
    await ws.send_json(data)

async def broadcast(room):
    for p in room.players:
        ws = connections.get(p.id)
        if ws:
            try:
                await send(ws, {"type": "state", "data": room.view(p.id)})
            except Exception:
                pass

async def run_computer_turns(room):
    """Play computer turns with a visible thinking pause before every move."""
    try:
        moves = 0
        while moves < 20:
            await asyncio.sleep(COMPUTER_MOVE_DELAY_SECONDS)
            async with state_lock:
                if (rooms.get(room.code) is not room or room.status != "playing"
                        or not room.current().is_bot):
                    return
                room.auto_move()
                record_match(room)
                moves += 1
                continues = room.status == "playing" and room.current().is_bot
            await broadcast(room)
            if not continues:
                return
    finally:
        computer_tasks.pop(room.code, None)

def queue_computer_turn(room):
    if (room.status == "playing" and room.current().is_bot
            and (room.code not in computer_tasks or computer_tasks[room.code].done())):
        computer_tasks[room.code] = asyncio.create_task(run_computer_turns(room))

def record_match(room):
    if room.status != "finished" or room.result_recorded:
        return
    with database_session() as db:
        winner = room.player(room.winner)
        for player in room.players:
            if player.user_id:
                user = db.get(User, player.user_id)
                if user:
                    user.matches_played += 1
                    if winner is player:
                        user.wins += 1
        match = MatchResult(room_code=room.code,
                            winner_user_id=winner.user_id if winner else None,
                            player_count=len(room.players))
        db.add(match)
        db.flush()
        for player in room.players:
            if player.user_id:
                db.add(MatchParticipant(match_result_id=match.id,
                                        user_id=player.user_id,
                                        did_win=player is winner))
    room.result_recorded = True

async def monitor():
    while True:
        await asyncio.sleep(1)
        now = time.time()
        changed = []
        async with state_lock:
            for code, room in list(rooms.items()):
                if room.status == "playing":
                    current = room.current()
                    if ((not current.connected and current.disconnected_at is not None
                         and now - current.disconnected_at >= RECONNECT_SECONDS)
                        or now - room.turn_started >= TURN_SECONDS):
                        room.timeout_turn()
                        record_match(room)
                        changed.append(room)
                if room.status == "lobby":
                    expired = [p for p in room.players if not p.connected and
                               p.disconnected_at is not None and
                               now - p.disconnected_at >= LOBBY_RECONNECT_SECONDS]
                    if expired:
                        room.players = [p for p in room.players if p not in expired]
                        if room.players and room.player(room.host) is None:
                            room.host = room.players[0].id
                        room.updated_at = now
                        changed.append(room)
                    if not room.players or now - room.updated_at >= LOBBY_IDLE_SECONDS:
                        rooms.pop(code, None)
                        continue
                if room.status == "finished" and (
                    not any(p.connected for p in room.players) or
                    now - room.updated_at >= FINISHED_IDLE_SECONDS
                ):
                    rooms.pop(code, None)
        for room in changed:
            if rooms.get(room.code) is room:
                await broadcast(room)
                queue_computer_turn(room)

@asynccontextmanager
async def lifespan(app):
    init_database()
    task = asyncio.create_task(monitor())
    try:
        yield
    finally:
        task.cancel()
        for computer_task in list(computer_tasks.values()):
            computer_task.cancel()

app = FastAPI(title="WHOT Arena API", lifespan=lifespan)
allowed_origins = [origin.strip() for origin in os.getenv(
       "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5000,http://127.0.0.1:5000"
).split(",") if origin.strip()]
if os.getenv("ENVIRONMENT", "development").lower() == "production" and "*" in allowed_origins:
    raise RuntimeError("Production CORS_ORIGINS must not contain '*'")
app.add_middleware(CORSMiddleware, allow_origins=allowed_origins,
                   allow_methods=["GET", "POST"],
                   allow_headers=["Authorization", "Content-Type"])
app.include_router(accounts_router)

@app.get("/health")
def health():
    return {"ok": True, "rooms": len(rooms)}

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    origin = ws.headers.get("origin")
    if origin and "*" not in allowed_origins and origin not in allowed_origins:
        await ws.close(code=1008)
        return
    await ws.accept()
    pid = None
    code = None
    try:
        while True:
            msg = await ws.receive_json()
            action = msg.get("action")
            try:
                if action in {"create", "computer"}:
                    if pid is not None:
                        raise ValueError("This connection already has a session")
                    name = str(msg.get("name", "Guest")).strip()[:20] or "Guest"
                    user_id = message_user_id(msg)
                    pid = secrets.token_urlsafe(18)
                    async with state_lock:
                        code = new_room_code()
                        player = Player(pid, name, user_id=user_id)
                        room = Room(code=code, host=pid, players=[player])
                        if action == "computer":
                            room.add_player(Player("bot-" + secrets.token_urlsafe(8),
                                                   "Arena Bot", is_bot=True))
                            room.start(pid)
                        rooms[code] = room
                        connections[pid] = ws
                    await send(ws, {"type": "session", "player_id": pid, "code": code,
                                    "reconnect_token": player.reconnect_token})
                    await broadcast(room)
                elif action == "quick_match":
                    if pid is not None:
                        raise ValueError("This connection already has a session")
                    name = str(msg.get("name", "Guest")).strip()[:20] or "Guest"
                    user_id = message_user_id(msg)
                    async with state_lock:
                        room = next((candidate for candidate in rooms.values()
                                     if candidate.is_public and candidate.status == "lobby"
                                     and len(candidate.players) == 1
                                     and candidate.players[0].connected), None)
                        pid = secrets.token_urlsafe(18)
                        player = Player(pid, name, user_id=user_id)
                        if room:
                            code = room.code
                            room.add_player(player)
                            room.start(room.host)
                        else:
                            code = new_room_code()
                            room = Room(code=code, host=pid, players=[player], is_public=True)
                            rooms[code] = room
                        connections[pid] = ws
                    await send(ws, {"type": "session", "player_id": pid, "code": code,
                                    "reconnect_token": player.reconnect_token})
                    await broadcast(room)
                elif action == "join":
                    if pid is not None:
                        raise ValueError("This connection already has a session")
                    requested = str(msg.get("code", "")).strip().upper()
                    async with state_lock:
                        room = rooms.get(requested)
                        if not room:
                            raise ValueError("Room not found")
                        pid = secrets.token_urlsafe(18)
                        code = requested
                        player = Player(pid, str(msg.get("name", "Guest")).strip()[:20] or "Guest")
                        player.user_id = message_user_id(msg)
                        room.add_player(player)
                        connections[pid] = ws
                    await send(ws, {"type": "session", "player_id": pid, "code": code,
                                    "reconnect_token": player.reconnect_token})
                    await broadcast(room)
                elif action == "reconnect":
                    if pid is not None:
                        raise ValueError("This connection already has a session")
                    requested = str(msg.get("code", "")).upper()
                    candidate = str(msg.get("player_id", ""))
                    token = str(msg.get("reconnect_token", ""))
                    previous_ws = None
                    async with state_lock:
                        room = rooms.get(requested)
                        p = room.player(candidate) if room else None
                        if not p or not token or not secrets.compare_digest(p.reconnect_token, token):
                            raise ValueError("Session not found")
                        previous_ws = connections.get(candidate)
                        pid, code = candidate, requested
                        p.connected, p.disconnected_at = True, None
                        room.updated_at = time.time()
                        connections[pid] = ws
                    if previous_ws and previous_ws is not ws:
                        try:
                            await previous_ws.close(code=4000, reason="Session resumed after refresh")
                        except Exception:
                            pass
                    await send(ws, {"type": "session", "player_id": pid, "code": code,
                                    "reconnect_token": p.reconnect_token})
                    await broadcast(room)
                elif action == "leave":
                    async with state_lock:
                        room = rooms.get(code or "")
                        player = room.player(pid) if room and pid else None
                        if not room or not player or connections.get(pid) is not ws:
                            raise ValueError("No active room to leave")
                        connections.pop(pid, None)
                        if room.status == "lobby":
                            room.players.remove(player)
                            if not room.players:
                                rooms.pop(room.code, None)
                            else:
                                if room.host == pid:
                                    room.host = room.players[0].id
                                room.updated_at = time.time()
                        else:
                            player.connected = False
                            player.disconnected_at = time.time()
                            room.updated_at = time.time()
                    await send(ws, {"type": "left"})
                    if rooms.get(room.code) is room:
                        await broadcast(room)
                    pid, code = None, None
                    await ws.close()
                    return
                else:
                    voice_response = None
                    async with state_lock:
                        room = rooms.get(code or "")
                        if not room or not pid or not room.player(pid):
                            raise ValueError("Join a room first")
                        if connections.get(pid) is not ws:
                            raise ValueError("Session is active on another connection")
                        if action == "start":
                            room.start(pid)
                        elif action == "play":
                            room.play(pid, msg.get("card_id"), msg.get("shape"))
                            record_match(room)
                        elif action == "draw":
                            room.draw(pid)
                            record_match(room)
                        elif action == "rematch":
                            room.rematch(pid)
                        elif action == "rtc_ready":
                            room.player(pid).voice_ready = True
                            room.updated_at = time.time()
                        elif action == "rtc_signal":
                            target = str(msg.get("target", ""))
                            signal = msg.get("signal")
                            target_player = room.player(target)
                            target_ws = connections.get(target)
                            if not target_player or not target_ws or not target_player.connected:
                                raise ValueError("Voice participant is unavailable")
                            if not isinstance(signal, dict) or signal.get("type") not in {
                                "offer", "answer", "ice"
                            }:
                                raise ValueError("Invalid voice signal")
                            voice_response = {
                                "type": "rtc_relay",
                                "id": secrets.token_hex(8),
                                "from": pid,
                                "signal": signal,
                                "target_ws": target_ws,
                            }
                        elif action == "voice":
                            encoded_audio = msg.get("audio")
                            if not isinstance(encoded_audio, str):
                                raise ValueError("Voice message must contain base64 audio")
                            if not encoded_audio.isascii():
                                raise ValueError("Voice message audio is not valid base64")
                            max_encoded_size = ((VOICE_MAX_BYTES + 2) // 3) * 4
                            if len(encoded_audio) > max_encoded_size:
                                raise ValueError("Voice message exceeds the 512 KB limit")
                            try:
                                audio = base64.b64decode(encoded_audio, validate=True)
                            except (binascii.Error, ValueError):
                                raise ValueError("Voice message audio is not valid base64")
                            room.add_voice_message(pid, msg.get("content_type"), audio)
                        elif action == "voice_get":
                            voice = room.voice_message(pid, str(msg.get("message_id", "")))
                            if voice is None:
                                raise ValueError("Voice message not found")
                            voice_response = {
                                "type": "voice_audio",
                                "id": voice["id"],
                                "content_type": voice["content_type"],
                                "audio": base64.b64encode(voice["audio"]).decode("ascii"),
                            }
                        elif action == "chat":
                            room.add_chat_message(pid, msg.get("text"))
                        else:
                            raise ValueError("Unknown action")
                    if voice_response:
                        target_ws = voice_response.pop("target_ws", None)
                        await send(target_ws or ws, voice_response)
                    else:
                        await broadcast(room)
                        queue_computer_turn(room)
            except ValueError as e:
                await send(ws, {"type": "error", "message": str(e)})
    except WebSocketDisconnect:
        pass
    finally:
        if pid and connections.get(pid) is ws:
            async with state_lock:
                connections.pop(pid, None)
                room = rooms.get(code or "")
                if room and room.player(pid):
                    p = room.player(pid)
                    p.connected = False
                    p.voice_ready = False
                    p.disconnected_at = time.time()
                    room.updated_at = time.time()
            if room and room.player(pid):
                await broadcast(room)
