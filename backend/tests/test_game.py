from app.game import SHAPES, HouseRules, Room, Player

def test_standard_nigerian_whot_deck_distribution():
    assert SHAPES == {
        "circle": [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14],
        "triangle": [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14],
        "cross": [1, 2, 3, 5, 7, 10, 11, 13, 14],
        "square": [1, 2, 3, 5, 7, 10, 11, 13, 14],
        "star": [1, 2, 3, 4, 5, 7, 8],
    }
    assert sum(map(len, SHAPES.values())) == 49
    assert all(6 not in numbers and 9 not in numbers for numbers in SHAPES.values())
def setup():
    r = Room("TEST", "a", [Player("a", "Ada"), Player("b", "Ben")])
    r.start("a")
    return r
def test_deal():
    r = setup()
    assert all(len(p.hand) == 5 for p in r.players)
    assert r.status == "playing"
    assert r.view("a")["market_count"] == 43
def test_turn_restriction():
    r = setup()
    try:
        r.draw("b")
        assert False
    except ValueError:
        pass
def test_draw_advances():
    r = setup()
    r.draw("a")
    assert r.current().id == "b"

def test_turn_timeout_draws_one_card_and_passes_even_with_a_playable_card():
    r = setup()
    current = r.current()
    current.hand = [{"shape": r.discard[-1]["shape"], "number": 3, "id": "playable"}]
    before = len(current.hand)

    r.timeout_turn()

    assert len(current.hand) == before + 1
    assert r.current().id == "b"
    assert "ran out of time" in r.last_action
    assert 29 <= r.view("a")["turn_seconds_remaining"] <= 30
    assert r.view("a")["turn_started_at"] == r.turn_started
    assert r.view("a")["state_version"] == r.updated_at

def test_exhausted_market_ends_round_and_scores_every_hand():
    r = setup()
    r.deck = []
    r.discard = [{"shape": "circle", "number": 7, "id": "top"}]
    r.players[0].hand = [{"shape": "circle", "number": 10, "id": "a1"},
                         {"shape": "star", "number": 5, "id": "a2"}]
    r.players[1].hand = [{"shape": "circle", "number": 14, "id": "b1"}]
    r.draw("a")
    assert r.status == "finished"
    assert r.final_scores == {"a": 20, "b": 14}
    assert r.winner == "b"
    assert "Market exhausted" in r.last_action

def test_taking_last_market_card_immediately_scores_and_declares_winner():
    r = setup()
    r.deck = [{"shape": "circle", "number": 3, "id": "last-market-card"}]
    r.discard = [{"shape": "circle", "number": 7, "id": "top"}]
    r.players[0].hand = [{"shape": "circle", "number": 10, "id": "a1"}]
    r.players[1].hand = [{"shape": "circle", "number": 14, "id": "b1"}]

    r.draw("a")

    assert r.status == "finished"
    assert r.deck == []
    assert r.final_scores == {"a": 13, "b": 14}
    assert r.winner == "a"
    assert "Market exhausted" in r.last_action

def test_discard_pile_is_not_recycled_when_market_finishes():
    r = setup()
    r.deck = []
    r.discard = [
        {"shape": "circle", "number": 5, "id": "old"},
        {"shape": "circle", "number": 7, "id": "top"},
    ]

    r.draw("a")

    assert r.status == "finished"
    assert [card["id"] for card in r.discard] == ["old", "top"]

def test_general_market_player_continues_without_drawing_when_cards_remain():
    r = setup()
    r.discard = [{"shape": "circle", "number": 7, "id": "top"}]
    r.players[0].hand = [{"shape": "circle", "number": 14, "id": "market"},
                         {"shape": "star", "number": 3, "id": "keep"}]
    r.play("a", "market")
    assert len(r.players[0].hand) == 1
    assert r.current().id == "a"
def test_privacy():
    r = setup()
    assert len(r.view("a")["hand"]) == 5
    assert "hand" not in r.view("a")["players"][1]

def test_computer_player_is_identified_without_exposing_its_hand():
    r = Room("SOLO", "human", [Player("human", "Ada"),
                                Player("bot", "Arena Bot", is_bot=True)])
    r.start("human")
    bot = next(player for player in r.view("human")["players"] if player["id"] == "bot")
    assert bot["is_bot"] is True
    assert "hand" not in bot
def test_max_players_is_enforced_by_server():
    r = Room("TEST", "a", [Player("a", "Ada")])
    for pid in ("b", "c", "d"):
        r.add_player(Player(pid, pid.upper()))
    try:
        r.add_player(Player("e", "E"))
        assert False
    except ValueError as error:
        assert str(error) == "Room is full"

def test_whot_requires_valid_requested_shape():
    r = setup()
    whot = {"shape": "whot", "number": 20, "id": "wild"}
    r.players[0].hand = [whot, {"shape": "star", "number": 3, "id": "star"}]
    try:
        r.play("a", "wild", "hexagon")
        assert False
    except ValueError as error:
        assert "valid shape" in str(error)

def test_special_two_gives_target_a_turn_before_penalty_is_taken():
    r = setup()
    r.discard = [{"shape": "circle", "number": 7, "id": "top"}]
    card = {"shape": "circle", "number": 2, "id": "two"}
    r.players[0].hand = [card, {"shape": "star", "number": 3, "id": "keep"}]
    r.players[1].hand = [{"shape": "square", "number": 7, "id": "safe"}]
    before = len(r.players[1].hand)
    r.play("a", "two")
    assert len(r.players[1].hand) == before
    assert r.current().id == "b"
    assert r.pending_draw == 2
    r.draw("b")
    assert len(r.players[1].hand) == before + 2
    assert r.current().id == "a"

def test_pick_three_gives_target_a_turn_before_penalty_is_taken():
    r = setup()
    r.discard = [{"shape": "circle", "number": 7, "id": "top"}]
    r.players[0].hand = [{"shape": "circle", "number": 5, "id": "three"},
                         {"shape": "star", "number": 3, "id": "keep"}]
    r.players[1].hand = [{"shape": "square", "number": 7, "id": "safe"}]
    before = len(r.players[1].hand)
    r.play("a", "three")
    assert len(r.players[1].hand) == before
    assert r.current().id == "b"
    assert r.pending_draw == 3
    r.draw("b")
    assert len(r.players[1].hand) == before + 3
    assert r.current().id == "a"

def test_penalty_can_only_stack_with_the_same_card_then_draw_total_and_skip():
    r = Room("TEST", "a", [Player("a", "Ada"), Player("b", "Ben"),
                             Player("c", "Cleo")])
    r.start("a")
    r.discard = [{"shape": "circle", "number": 7, "id": "top"}]
    r.players[0].hand = [{"shape": "circle", "number": 2, "id": "two"},
                         {"shape": "star", "number": 3, "id": "a-keep"}]
    r.players[1].hand = [{"shape": "square", "number": 5, "id": "three"},
                         {"shape": "triangle", "number": 2, "id": "second-two"},
                         {"shape": "star", "number": 4, "id": "b-keep"}]
    r.players[2].hand = [{"shape": "triangle", "number": 7, "id": "no-block"}]
    before = len(r.players[2].hand)

    r.play("a", "two")
    assert r.pending_draw == 2
    assert r.pending_penalty == 2
    assert r.current().id == "b"
    assert not r.legal(r.players[1].hand[0])
    assert r.legal(r.players[1].hand[1])
    try:
        r.play("b", "three")
        assert False
    except ValueError as error:
        assert str(error) == "Invalid card"

    r.play("b", "second-two")
    assert r.pending_draw == 4
    assert r.pending_penalty == 2
    assert len(r.players[2].hand) == before
    assert r.current().id == "c"
    r.draw("c")
    assert r.pending_draw == 0
    assert r.pending_penalty is None
    assert len(r.players[2].hand) == before + 4
    assert r.current().id == "a"
    assert "picked 4 cards" in r.last_action

def test_invalid_card_is_not_removed_from_hand():
    r = setup()
    invalid = {"shape": "square", "number": 4, "id": "invalid"}
    r.discard = [{"shape": "circle", "number": 7, "id": "top"}]
    r.players[0].hand = [invalid]
    try:
        r.play("a", "invalid")
        assert False
    except ValueError as error:
        assert str(error) == "Invalid card"
    assert r.players[0].hand == [invalid]

def test_whot_sets_shape_for_the_next_player():
    r = setup()
    r.discard = [{"shape": "circle", "number": 7, "id": "top"}]
    r.players[0].hand = [{"shape": "whot", "number": 20, "id": "wild"},
                         {"shape": "star", "number": 3, "id": "keep"}]
    r.play("a", "wild", "star")
    assert r.requested_shape == "star"
    assert r.current().id == "b"
    assert r.legal({"shape": "star", "number": 7, "id": "matching"})

def test_view_does_not_expose_reconnect_token():
    r = setup()
    rendered = repr(r.view("a"))
    assert r.players[0].reconnect_token not in rendered
    assert r.players[1].reconnect_token not in rendered

def test_table_chat_is_room_scoped_and_limited():
    r = setup()
    message = r.add_chat_message("a", "  Good game!  ")
    assert message["text"] == "Good game!"
    assert r.view("b")["chat_messages"][0]["name"] == "Ada"
    try:
        r.add_chat_message("a", "x" * 501)
        assert False
    except ValueError as error:
        assert "500 characters" in str(error)

def test_same_registered_account_cannot_join_room_twice():
    r = Room("TEST", "a", [Player("a", "Ada", user_id=42)])
    try:
        r.add_player(Player("b", "Ada Again", user_id=42))
        assert False
    except ValueError as error:
        assert "already in this room" in str(error)

def test_house_rules_can_configure_deal_and_penalties():
    rules = HouseRules(cards_per_player=7, pick_two=4)
    r = Room("TEST", "a", [Player("a", "Ada"), Player("b", "Ben")], rules=rules)
    r.start("a")
    assert all(len(player.hand) == 7 for player in r.players)
    r.discard = [{"shape": "circle", "number": 7, "id": "top"}]
    r.players[0].hand = [{"shape": "circle", "number": 2, "id": "two"},
                         {"shape": "star", "number": 3, "id": "keep"}]
    r.players[1].hand = [{"shape": "square", "number": 7, "id": "safe"}]
    before = len(r.players[1].hand)
    r.play("a", "two")
    assert r.pending_draw == 4
    r.draw("b")
    assert len(r.players[1].hand) == before + 4

def test_hold_on_keeps_the_current_turn():
    r = setup()
    r.discard = [{"shape": "circle", "number": 7, "id": "top"}]
    r.players[0].hand = [{"shape": "circle", "number": 1, "id": "hold"},
                         {"shape": "star", "number": 3, "id": "keep"}]
    r.play("a", "hold")
    assert r.current().id == "a"

def test_general_market_draws_for_every_opponent():
    r = Room("TEST", "a", [Player("a", "Ada"), Player("b", "Ben"),
                             Player("c", "Cleo")])
    r.start("a")
    r.discard = [{"shape": "circle", "number": 7, "id": "top"}]
    r.players[0].hand = [{"shape": "circle", "number": 14, "id": "market"},
                         {"shape": "star", "number": 3, "id": "keep"}]
    before = [len(player.hand) for player in r.players]
    r.play("a", "market")
    assert [len(player.hand) for player in r.players] == [1, before[1] + 1, before[2] + 1]
    assert r.current().id == "a"

def test_eight_skips_the_next_player():
    r = Room("TEST", "a", [Player("a", "Ada"), Player("b", "Ben"),
                             Player("c", "Cleo")])
    r.start("a")
    r.discard = [{"shape": "circle", "number": 7, "id": "top"}]
    r.players[0].hand = [{"shape": "circle", "number": 8, "id": "skip"},
                         {"shape": "star", "number": 3, "id": "keep"}]
    r.play("a", "skip")
    assert r.current().id == "c"

def test_last_card_wins_immediately():
    r = setup()
    r.discard = [{"shape": "circle", "number": 7, "id": "top"}]
    r.players[0].hand = [{"shape": "circle", "number": 3, "id": "finish"}]
    r.play("a", "finish")
    assert r.status == "finished"
    assert r.winner == "a"

def test_reaching_one_card_announces_last_card():
    r = setup()
    r.discard = [{"shape": "circle", "number": 7, "id": "top"}]
    r.players[0].hand = [{"shape": "circle", "number": 3, "id": "play"},
                         {"shape": "star", "number": 3, "id": "last"}]
    r.play("a", "play")
    assert len(r.players[0].hand) == 1
    assert "Ada has LAST CARD!" in r.last_action

def test_special_cards_cannot_be_played_as_the_winning_card():
    for number in (1, 2, 5, 8, 14, 20):
        r = setup()
        r.discard = [{"shape": "circle", "number": 7, "id": "top"}]
        shape = "whot" if number == 20 else "circle"
        r.players[0].hand = [{"shape": shape, "number": number, "id": "special"}]
        r.play("a", "special", "star" if number == 20 else None)
        assert r.status == "playing", f"{number} incorrectly ended the round"
        assert r.winner is None
        assert len(r.players[0].hand) == 1
        assert "replacement card" in r.last_action

def test_rematch_is_host_only_and_resets_the_match():
    r = setup()
    r.status = "finished"
    r.winner = "b"
    r.result_recorded = True
    r.voice_messages = [{"id": "previous-round"}]
    try:
        r.rematch("b")
        assert False
    except ValueError as error:
        assert "Only the host" in str(error)
    r.rematch("a")
    assert r.status == "playing"
    assert r.winner is None
    assert r.result_recorded is False
    assert r.voice_messages == []
    assert all(len(player.hand) == 5 for player in r.players)

    def test_voice_message_is_room_scoped_and_state_contains_metadata_only():
        r = Room("VOICE1", "a", [Player("a", "Ada"), Player("b", "Ben")],
                 status="playing")
        metadata = r.add_voice_message("a", "audio/webm", b"recorded audio")
        assert metadata["name"] == "Ada"
        assert "audio" not in metadata
        assert "audio" not in r.view("b")["voice_messages"][0]
        assert r.voice_message("b", metadata["id"])["audio"] == b"recorded audio"
        try:
            r.voice_message("not-a-player", metadata["id"])
            assert False
        except ValueError as error:
            assert "Join this room" in str(error)

    def test_voice_message_rejects_bad_media_empty_and_oversized_clips():
        r = Room("VOICE1", "a", [Player("a", "Ada"), Player("b", "Ben")],
                 status="playing")
        for content_type, audio in (("text/plain", b"audio"), ([], b"audio"), ("audio/webm", b""),
                                    ("audio/webm", b"x" * 512_001)):
            try:
                r.add_voice_message("a", content_type, audio)
                assert False
            except ValueError:
                pass

    def test_voice_messages_are_unavailable_in_lobby_and_rate_limited():
        r = Room("VOICE1", "a", [Player("a", "Ada"), Player("b", "Ben")])
        try:
            r.add_voice_message("a", "audio/webm", b"hello")
            assert False
        except ValueError as error:
            assert "only available during a game" in str(error)
        r.status = "playing"
        r.add_voice_message("a", "audio/webm", b"hello")
        try:
            r.add_voice_message("a", "audio/webm", b"again")
            assert False
        except ValueError as error:
            assert "wait" in str(error)
