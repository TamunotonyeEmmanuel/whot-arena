import random
import secrets
import time
from dataclasses import dataclass, field
from typing import Optional

SHAPES = {"circle": [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14],
          "triangle": [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14],
          "cross": [1, 2, 3, 5, 7, 10, 11, 13, 14],
          "square": [1, 2, 3, 5, 7, 10, 11, 13, 14],
          "star": [1, 2, 3, 4, 5, 7, 8]}
VOICE_CONTENT_TYPES = {"audio/webm", "audio/ogg", "audio/mp4", "audio/wav"}
VOICE_MAX_BYTES = 512_000
VOICE_ROOM_MAX_BYTES = 4_000_000
VOICE_HISTORY_LIMIT = 20
VOICE_COOLDOWN_SECONDS = 1.0
LAST_CARD_REQUIRES_REPLACEMENT = {1, 2, 5, 8, 14, 20}
# Explicit house rules: 1 extra turn, 2 +2, 5 +3, 8 skip, 14 market (+1 each opponent),
# 20 wild request shape. Special actions do not stack. Penalty draws end the target turn.
@dataclass(frozen=True)
class HouseRules:
    cards_per_player: int = 5
    pick_two: int = 2
    pick_three: int = 3
    general_market: int = 1
    penalty_stacking: bool = False

@dataclass
class Player:
    id: str
    name: str
    hand: list = field(default_factory=list)
    connected: bool = True
    voice_ready: bool = False
    disconnected_at: Optional[float] = None
    reconnect_token: str = field(default_factory=lambda: secrets.token_urlsafe(32), repr=False)
    user_id: Optional[int] = None

@dataclass
class Room:
    code: str
    host: str
    players: list = field(default_factory=list)
    status: str = "lobby"
    deck: list = field(default_factory=list)
    discard: list = field(default_factory=list)
    turn: int = 0
    requested_shape: Optional[str] = None
    winner: Optional[str] = None
    last_action: str = "Waiting for players"
    turn_started: float = field(default_factory=time.time)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    result_recorded: bool = False
    is_public: bool = False
    rules: HouseRules = field(default_factory=HouseRules)
    voice_messages: list = field(default_factory=list)
    voice_sent_at: dict = field(default_factory=dict)

    def player(self, pid):
        return next((p for p in self.players if p.id == pid), None)

    def current(self):
        if not self.players:
            raise ValueError("Room has no players")
        return self.players[self.turn]

    def add_player(self, player):
        if self.status != "lobby":
            raise ValueError("Match already started")
        if len(self.players) >= 4:
            raise ValueError("Room is full")
        if self.player(player.id):
            raise ValueError("Player is already in this room")
        if player.user_id and any(existing.user_id == player.user_id for existing in self.players):
            raise ValueError("Account is already in this room")
        self.players.append(player)
        self.updated_at = time.time()

    def _draw(self, p, count=1):
        for _ in range(count):
            if not self.deck:
                if len(self.discard) <= 1:
                    break
                top = self.discard.pop()
                self.deck = self.discard[:]
                random.shuffle(self.deck)
                self.discard = [top]
            p.hand.append(self.deck.pop())

    def start(self, pid):
        if pid != self.host or self.status != "lobby":
            raise ValueError("Only the host can start a lobby")
        if not 2 <= len(self.players) <= 4:
            raise ValueError("A match needs 2 to 4 players")
        if any(not player.connected for player in self.players):
            raise ValueError("All players must be connected before starting")
        self.deck = [{"shape": shape, "number": n, "id": secrets.token_hex(5)}
                     for shape, numbers in SHAPES.items() for n in numbers]
        self.deck += [{"shape": "whot", "number": 20, "id": secrets.token_hex(5)}
                      for _ in range(5)]
        random.shuffle(self.deck)
        for p in self.players:
            p.hand = []
            self._draw(p, self.rules.cards_per_player)
        # Begin with a non-action card to avoid ambiguity on opening.
        idx = next(i for i, c in enumerate(self.deck)
                   if c["number"] not in (1, 2, 5, 8, 14, 20))
        self.discard = [self.deck.pop(idx)]
        self.status = "playing"
        self.turn = 0
        self.requested_shape = None
        self.winner = None
        self.result_recorded = False
        self.turn_started = time.time()
        self.last_action = "Game started"
        self.updated_at = self.turn_started

    def rematch(self, pid):
        if self.status != "finished":
            raise ValueError("Match is not finished")
        if pid != self.host:
            raise ValueError("Only the host can start a rematch")
        if any(not player.connected for player in self.players):
            raise ValueError("All players must reconnect before a rematch")
        self.voice_messages.clear()
        self.voice_sent_at.clear()
        self.status = "lobby"
        self.start(pid)
        self.last_action = "Rematch started"

    def add_voice_message(self, pid, content_type, audio):
        player = self.player(pid)
        if not player or not player.connected:
            raise ValueError("Join this room before sending a voice message")
        if self.status != "playing":
            raise ValueError("Voice messages are only available during a game")
        if not isinstance(content_type, str) or content_type not in VOICE_CONTENT_TYPES:
            raise ValueError("Unsupported voice message format")
        if not audio:
            raise ValueError("Voice message cannot be empty")
        if len(audio) > VOICE_MAX_BYTES:
            raise ValueError("Voice message exceeds the 512 KB limit")
        now = time.monotonic()
        if now - self.voice_sent_at.get(pid, 0) < VOICE_COOLDOWN_SECONDS:
            raise ValueError("Please wait before sending another message")
        self.voice_sent_at[pid] = now
        message = {
            "id": secrets.token_hex(6),
            "player_id": pid,
            "name": player.name,
            "content_type": content_type,
            "size": len(audio),
            "sent_at": time.time(),
            "audio": audio,
        }
        self.voice_messages.append(message)
        while (len(self.voice_messages) > VOICE_HISTORY_LIMIT or
               sum(item["size"] for item in self.voice_messages) > VOICE_ROOM_MAX_BYTES):
            self.voice_messages.pop(0)
        self.updated_at = time.time()
        return {key: value for key, value in message.items() if key != "audio"}

    def voice_message(self, pid, message_id):
        if not self.player(pid):
            raise ValueError("Join this room to listen to its voice messages")
        return next((message for message in self.voice_messages
                     if message["id"] == message_id), None)

    def legal(self, card):
        top = self.discard[-1]
        return (card["number"] == 20 or
                card["number"] == top["number"] or
                card["shape"] == (self.requested_shape or top["shape"]))

    def _advance(self, steps=1):
        self.turn = (self.turn + steps) % len(self.players)
        self.turn_started = time.time()
        self.updated_at = self.turn_started

    def play(self, pid, card_id, shape=None):
        if self.status != "playing" or self.current().id != pid:
            raise ValueError("Not your turn")
        p = self.current()
        card = next((c for c in p.hand if c["id"] == card_id), None)
        if card is None or not self.legal(card):
            raise ValueError("Invalid card")
        if card["number"] == 20 and shape not in SHAPES:
            raise ValueError("Choose a valid shape for WHOT")
        p.hand.remove(card)
        self.discard.append(card)
        self.requested_shape = shape if card["number"] == 20 else None
        self.last_action = f"{p.name} played {card['number']}"
        if not p.hand and card["number"] in LAST_CARD_REQUIRES_REPLACEMENT:
            self._draw(p)
            self.last_action += " and drew a replacement card"
        elif not p.hand:
            self.winner = pid
            self.status = "finished"
            self.updated_at = time.time()
            return
        n = card["number"]
        if n == 1:
            self.turn_started = time.time()
            self.updated_at = self.turn_started
        elif n in (2, 5):
            self._draw(self.players[(self.turn + 1) % len(self.players)],
                       self.rules.pick_two if n == 2 else self.rules.pick_three)
            self._advance(2)
        elif n == 8:
            self._advance(2)
        elif n == 14:
            for other in self.players:
                if other.id != pid:
                    self._draw(other, self.rules.general_market)
            self.turn_started = time.time()
            self.updated_at = self.turn_started
        else:
            self._advance()

    def draw(self, pid):
        if self.status != "playing" or self.current().id != pid:
            raise ValueError("Not your turn")
        self._draw(self.current())
        self.last_action = f"{self.current().name} drew a card"
        self._advance()

    def auto_move(self):
        if self.status != "playing":
            return
        p = self.current()
        card = next((c for c in p.hand if self.legal(c)), None)
        if card:
            shape = None
            if card["number"] == 20:
                counts = {candidate: 0 for candidate in SHAPES}
                for held in p.hand:
                    if held["shape"] in counts:
                        counts[held["shape"]] += 1
                shape = max(counts, key=counts.get)
            self.play(p.id, card["id"], shape)
        else:
            self.draw(p.id)

    def view(self, pid):
        return {
            "code": self.code, "status": self.status, "host": self.host,
            "you": pid, "turn": self.current().id if self.status == "playing" else None,
            "players": [{"id": p.id, "name": p.name, "count": len(p.hand),
                         "connected": p.connected, "voice_ready": p.voice_ready}
                        for p in self.players],
            "hand": self.player(pid).hand if self.player(pid) else [],
            "top": self.discard[-1] if self.discard else None,
            "requested_shape": self.requested_shape,
            "winner": self.winner, "last_action": self.last_action,
            "is_public": self.is_public,
            "voice_messages": [{key: value for key, value in message.items()
                                if key != "audio"} for message in self.voice_messages],
            "rules": {"cards_per_player": self.rules.cards_per_player,
                      "pick_two": self.rules.pick_two,
                      "pick_three": self.rules.pick_three,
                      "general_market": self.rules.general_market,
                      "penalty_stacking": self.rules.penalty_stacking},
        }
