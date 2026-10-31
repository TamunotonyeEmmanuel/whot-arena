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
CHAT_HISTORY_LIMIT = 100
CHAT_MAX_CHARS = 500
TURN_SECONDS = 30
RECONNECT_PAUSE_SECONDS = 30
LAST_CARD_REQUIRES_REPLACEMENT = {1, 2, 5, 8, 14, 20}
# Explicit house rules: 1 extra turn, 2 +2, 5 +3, 8 skip, 14 market (+1 each opponent),
# 20 wild request shape. Special actions do not stack. Penalty draws end the target turn.
@dataclass(frozen=True)
class HouseRules:
    cards_per_player: int = 5
    pick_two: int = 2
    pick_three: int = 3
    general_market: int = 1
    penalty_stacking: bool = True

@dataclass
class Player:
    id: str
    name: str
    hand: list = field(default_factory=list)
    connected: bool = True
    voice_ready: bool = False
    voice_speaking: bool = False
    reaction: Optional[str] = None
    reaction_at: Optional[float] = None
    disconnected_at: Optional[float] = None
    reconnect_token: str = field(default_factory=lambda: secrets.token_urlsafe(32), repr=False)
    user_id: Optional[int] = None
    coin_balance: int = 0
    is_bot: bool = False
    last_card_required: bool = False
    table_theme: str = "classic"
    card_back: str = "classic"
    avatar: str = "initial"

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
    pending_draw: int = 0
    pending_penalty: Optional[int] = None
    winner: Optional[str] = None
    match_winner: Optional[str] = None
    round_number: int = 1
    round_wins: dict = field(default_factory=dict)
    match_points: dict = field(default_factory=dict)
    last_action: str = "Waiting for players"
    turn_started: float = field(default_factory=time.time)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    pause_started: Optional[float] = None
    paused_turn_seconds: int = TURN_SECONDS
    pause_reason: Optional[str] = None
    paused_by: Optional[str] = None
    result_recorded: bool = False
    final_scores: dict = field(default_factory=dict)
    is_public: bool = False
    rules: HouseRules = field(default_factory=HouseRules)
    voice_messages: list = field(default_factory=list)
    voice_sent_at: dict = field(default_factory=dict)
    chat_messages: list = field(default_factory=list)
    wager: int = 0
    wager_locked: bool = False
    wager_paid: bool = False

    def player(self, pid):
        return next((p for p in self.players if p.id == pid), None)

    def current(self):
        if not self.players:
            raise ValueError("Room has no players")
        return self.players[self.turn]

    @property
    def is_paused(self):
        return self.pause_started is not None

    def pause_for_disconnect(self, player):
        if (self.is_public or self.status != "playing" or player.is_bot
                or self.pause_started is not None):
            return
        now = time.time()
        self.paused_turn_seconds = max(0, min(TURN_SECONDS, int(
            TURN_SECONDS - (now - self.turn_started) + 0.999)))
        self.pause_started = now
        self.pause_reason = "disconnect"
        self.paused_by = player.name
        self.updated_at = now
        self.last_action = f"Game paused while {player.name} reconnects"

    def resume_after_disconnect(self, force=False):
        if not self.is_paused or self.pause_reason != "disconnect":
            return False
        humans_connected = all(player.connected for player in self.players if not player.is_bot)
        if not force and not humans_connected:
            return False
        now = time.time()
        self.turn_started = now - (TURN_SECONDS - self.paused_turn_seconds)
        self.pause_started = None
        self.pause_reason = None
        self.paused_by = None
        self.updated_at = now
        self.last_action = "Game resumed"
        return True

    def toggle_manual_pause(self, pid):
        if self.is_public:
            raise ValueError("Public quick matches cannot be paused manually")
        if self.status != "playing" or pid != self.host:
            raise ValueError("Only the host can pause this match")
        if self.is_paused:
            if self.pause_reason != "manual":
                raise ValueError("Wait for the disconnected player to reconnect")
            now = time.time()
            self.turn_started = now - (TURN_SECONDS - self.paused_turn_seconds)
            self.pause_started = None
            self.pause_reason = None
            self.paused_by = None
            self.updated_at = now
            self.last_action = "Game resumed by the host"
            return
        now = time.time()
        self.paused_turn_seconds = max(0, min(TURN_SECONDS, int(
            TURN_SECONDS - (now - self.turn_started) + 0.999)))
        self.pause_started = now
        self.pause_reason = "manual"
        self.paused_by = self.player(pid).name
        self.updated_at = now
        self.last_action = f"{self.paused_by} paused the game"

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
        drawn = 0
        for _ in range(count):
            if not self.deck:
                break
            p.hand.append(self.deck.pop())
            drawn += 1
        if len(p.hand) != 1:
            p.last_card_required = False
        return drawn

    @staticmethod
    def hand_score(player):
        return sum(card["number"] * (2 if card["shape"] == "star" else 1)
                   for card in player.hand)

    def finish_exhausted_market(self):
        scores = {player.id: self.hand_score(player) for player in self.players}
        winner = min(self.players,
                     key=lambda player: (scores[player.id], len(player.hand),
                                         self.players.index(player)))
        self.finish_round(winner.id, scores)
        totals = ", ".join(f"{player.name}: {scores[player.id]}"
                           for player in self.players)
        self.last_action = f"Market exhausted — {winner.name} wins on points. {totals}"

    def finish_round(self, winner_id, scores=None):
        self.final_scores = scores or {player.id: self.hand_score(player)
                                       for player in self.players}
        self.winner = winner_id
        self.round_wins.setdefault(winner_id, 0)
        self.round_wins[winner_id] += 1
        awarded = sum(score for player_id, score in self.final_scores.items()
                      if player_id != winner_id)
        self.match_points.setdefault(winner_id, 0)
        self.match_points[winner_id] += awarded
        if self.round_wins[winner_id] >= 2:
            self.match_winner = winner_id
        self.status = "finished"
        self.updated_at = time.time()

    def start(self, pid, continue_match=False):
        if pid != self.host or self.status != "lobby":
            raise ValueError("Only the host can start a lobby")
        if not 2 <= len(self.players) <= 4:
            raise ValueError("A match needs 2 to 4 players")
        if any(not player.connected for player in self.players):
            raise ValueError("All players must be connected before starting")
        if not continue_match:
            self.round_number = 1
            self.round_wins = {player.id: 0 for player in self.players}
            self.match_points = {player.id: 0 for player in self.players}
            self.match_winner = None
        self.deck = [{"shape": shape, "number": n, "id": secrets.token_hex(5)}
                     for shape, numbers in SHAPES.items() for n in numbers]
        self.deck += [{"shape": "whot", "number": 20, "id": secrets.token_hex(5)}
                      for _ in range(5)]
        random.shuffle(self.deck)
        for p in self.players:
            p.hand = []
            p.last_card_required = False
            self._draw(p, self.rules.cards_per_player)
        # Begin with a non-action card to avoid ambiguity on opening.
        idx = next(i for i, c in enumerate(self.deck)
                   if c["number"] not in (1, 2, 5, 8, 14, 20))
        self.discard = [self.deck.pop(idx)]
        self.status = "playing"
        self.turn = 0
        self.requested_shape = None
        self.pending_draw = 0
        self.pending_penalty = None
        self.winner = None
        self.result_recorded = False
        self.final_scores = {}
        self.turn_started = time.time()
        self.pause_started = None
        self.pause_reason = None
        self.paused_by = None
        self.paused_turn_seconds = TURN_SECONDS
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
        self.chat_messages.clear()
        if self.match_winner:
            self.round_number = 1
            self.round_wins = {player.id: 0 for player in self.players}
            self.match_points = {player.id: 0 for player in self.players}
            self.match_winner = None
        else:
            self.round_number += 1
        self.status = "lobby"
        self.start(pid, continue_match=True)
        self.last_action = "New match started" if self.round_number == 1 else f"Round {self.round_number} started"

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

    def add_chat_message(self, pid, text):
        player = self.player(pid)
        if not player or not player.connected:
            raise ValueError("Join this room before sending a message")
        if self.status != "playing":
            raise ValueError("Table chat is only available during a game")
        if not isinstance(text, str):
            raise ValueError("Message text is required")
        text = text.strip()
        if not text:
            raise ValueError("Message cannot be empty")
        if len(text) > CHAT_MAX_CHARS:
            raise ValueError("Message is over 500 characters")
        message = {"id": secrets.token_hex(6), "player_id": pid, "name": player.name,
                   "text": text, "sent_at": time.time()}
        self.chat_messages.append(message)
        self.chat_messages = self.chat_messages[-CHAT_HISTORY_LIMIT:]
        self.updated_at = time.time()
        return message

    def legal(self, card):
        if self.pending_draw:
            return card["number"] == self.pending_penalty
        top = self.discard[-1]
        return (card["number"] == 20 or
                card["number"] == top["number"] or
                card["shape"] == (self.requested_shape or top["shape"]))

    def _advance(self, steps=1):
        self.turn = (self.turn + steps) % len(self.players)
        self.turn_started = time.time()
        self.updated_at = self.turn_started

    def _take_pending_penalty(self, player, reason="could not block", preserve_action=False):
        required = self.pending_draw
        self.pending_draw = 0
        self.pending_penalty = None
        drawn = self._draw(player, required)
        penalty_action = f"{player.name} {reason} and picked {required} cards"
        self.last_action = f"{self.last_action}; {penalty_action}" if preserve_action else penalty_action
        if drawn < required or not self.deck:
            self.finish_exhausted_market()
            return
        self._advance()

    def _penalize_missed_last_card(self):
        missed = [player for player in self.players if player.last_card_required]
        for player in missed:
            player.last_card_required = False
            drawn = self._draw(player, 2)
            self.last_action = f"{player.name} forgot LAST CARD and picked 2 cards"
            if drawn < 2 or not self.deck:
                self.finish_exhausted_market()
                return False
        return True

    def declare_last_card(self, pid):
        if self.is_paused:
            raise ValueError("Game is paused while a player reconnects")
        player = self.player(pid)
        if self.status != "playing" or not player or not player.last_card_required or len(player.hand) != 1:
            raise ValueError("You can only declare when you reach one card")
        player.last_card_required = False
        self.last_action = f"{player.name} declared LAST CARD!"
        self.updated_at = time.time()

    def play(self, pid, card_id, shape=None):
        if self.is_paused:
            raise ValueError("Game is paused while a player reconnects")
        if self.status != "playing" or self.current().id != pid:
            raise ValueError("Not your turn")
        if not self._penalize_missed_last_card():
            return
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
        replacement_drawn = False
        if not p.hand and card["number"] in LAST_CARD_REQUIRES_REPLACEMENT:
            if self._draw(p) == 0:
                self.finish_exhausted_market()
                return
            replacement_drawn = True
            self.last_action += " and drew a replacement card"
            if not self.deck:
                self.finish_exhausted_market()
                return
        elif not p.hand:
            self.finish_round(pid)
            return
        n = card["number"]
        if n == 1:
            self.turn_started = time.time()
            self.updated_at = self.turn_started
        elif n in (2, 5):
            required = self.rules.pick_two if n == 2 else self.rules.pick_three
            self.pending_penalty = n
            self.pending_draw += required
            self.last_action += f" — pick total is now {self.pending_draw}"
            self._advance()
        elif n == 8:
            self._advance(2)
        elif n == 14:
            for other in self.players:
                if other.id != pid:
                    if self._draw(other, self.rules.general_market) < self.rules.general_market or not self.deck:
                        self.finish_exhausted_market()
                        return
            self.turn_started = time.time()
            self.updated_at = self.turn_started
        else:
            self._advance()
        if len(p.hand) == 1:
            if replacement_drawn:
                p.last_card_required = False
                self.last_action += " — replacement is the declared LAST CARD"
            else:
                p.last_card_required = not p.is_bot
                self.last_action += (f" — {p.name} declared LAST CARD!" if p.is_bot
                                     else f" — {p.name} must declare LAST CARD!")

    def draw(self, pid):
        if self.is_paused:
            raise ValueError("Game is paused while a player reconnects")
        if self.status != "playing" or self.current().id != pid:
            raise ValueError("Not your turn")
        if not self._penalize_missed_last_card():
            return
        if self.pending_draw:
            self._take_pending_penalty(self.current(), "accepted the penalty")
            return
        if self._draw(self.current()) == 0 or not self.deck:
            self.finish_exhausted_market()
            return
        self.last_action = f"{self.current().name} drew a card"
        self._advance()

    def timeout_turn(self):
        if self.status != "playing":
            return
        if not self._penalize_missed_last_card():
            return
        player = self.current()
        if self.pending_draw:
            self._take_pending_penalty(player, "ran out of time")
            return
        if self._draw(player) == 0 or not self.deck:
            self.finish_exhausted_market()
            return
        self.last_action = f"{player.name} ran out of time and drew a card"
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
                         "connected": p.connected, "voice_ready": p.voice_ready,
                         "voice_speaking": p.voice_speaking,
                         "reaction": p.reaction, "reaction_at": p.reaction_at,
                         "is_bot": p.is_bot, "last_card_required": p.last_card_required,
                         "coin_balance": p.coin_balance,
                         "table_theme": p.table_theme, "card_back": p.card_back,
                         "avatar": p.avatar}
                        for p in self.players],
            "hand": self.player(pid).hand if self.player(pid) else [],
            "top": self.discard[-1] if self.discard else None,
            "market_count": len(self.deck),
            "state_version": self.updated_at,
            "turn_started_at": self.turn_started,
            "turn_seconds_remaining": (max(0, min(TURN_SECONDS, int(
                TURN_SECONDS - (time.time() - self.turn_started) + 0.999)))
                if self.status == "playing" and not self.is_paused
                else self.paused_turn_seconds if self.status == "playing" else 0),
            "is_paused": self.is_paused,
            "pause_reason": self.pause_reason,
            "paused_by": self.paused_by,
            "pause_seconds_remaining": (max(0, RECONNECT_PAUSE_SECONDS - int(
                time.time() - self.pause_started))
                if self.pause_started and self.pause_reason == "disconnect" else 0),
            "requested_shape": self.requested_shape,
            "pending_draw": self.pending_draw,
            "pending_penalty": self.pending_penalty,
            "winner": self.winner, "match_winner": self.match_winner,
            "round_number": self.round_number, "round_wins": self.round_wins,
            "match_points": self.match_points, "last_action": self.last_action,
            "final_scores": self.final_scores,
            "is_public": self.is_public,
            "wager": self.wager,
            "wager_locked": self.wager_locked,
            "wager_pot": self.wager * len([p for p in self.players if not p.is_bot]),
            "voice_messages": [{key: value for key, value in message.items()
                                if key != "audio"} for message in self.voice_messages],
            "chat_messages": self.chat_messages,
            "rules": {"cards_per_player": self.rules.cards_per_player,
                      "pick_two": self.rules.pick_two,
                      "pick_three": self.rules.pick_three,
                      "general_market": self.rules.general_market,
                      "penalty_stacking": self.rules.penalty_stacking},
        }
