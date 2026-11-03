import json

from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable

from app import database
from app.game import Room, Player
from app.main import restore_rooms, rooms


def test_database_migrations_preserve_existing_account_data(tmp_path, monkeypatch):
    legacy_engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with legacy_engine.begin() as connection:
        connection.execute(text("""
            CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                username VARCHAR(24) NOT NULL,
                email VARCHAR(320) NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                matches_played INTEGER NOT NULL DEFAULT 0,
                wins INTEGER NOT NULL DEFAULT 0,
                arena_coins INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME NOT NULL
            )
        """))
        connection.execute(text("""
            INSERT INTO users
                (id, username, email, password_hash, matches_played, wins, arena_coins, created_at)
            VALUES
                (1, 'legacy_player', 'legacy@example.com', 'hash', 12, 4, 237, CURRENT_TIMESTAMP)
        """))
        connection.execute(text("""
            CREATE TABLE direct_messages (
                id INTEGER PRIMARY KEY,
                sender_id INTEGER NOT NULL,
                recipient_id INTEGER NOT NULL,
                text VARCHAR(500) NOT NULL,
                sent_at DATETIME NOT NULL
            )
        """))
        connection.execute(text("""
            INSERT INTO direct_messages (id, sender_id, recipient_id, text, sent_at)
            VALUES (1, 1, 1, 'existing message', CURRENT_TIMESTAMP)
        """))

    monkeypatch.setattr(database, "engine", legacy_engine)
    database.init_database()
    database.init_database()

    with legacy_engine.connect() as connection:
        user = connection.execute(text("""
            SELECT matches_played, wins, arena_coins, google_sub, deleted_at
            FROM users WHERE id = 1
        """)).one()
        message = connection.execute(text("""
            SELECT text FROM direct_messages WHERE id = 1
        """)).scalar_one()
        migrations = set(connection.execute(text(
            "SELECT name FROM data_migrations"
        )).scalars())

    assert tuple(user[:3]) == (12, 4, 237)
    assert user.google_sub is None
    assert user.deleted_at is None
    assert message == "existing message"
    assert migrations == {
        "001_add_user_account_fields",
        "002_add_message_delivery_fields",
        "003_add_match_idempotency_key",
        "004_ensure_arena_treasury",
        "005_add_room_memberships",
        "006_add_google_account_id",
        "007_add_user_deletion_timestamp",
        "008_ensure_game_rule_settings",
    }


def test_postgresql_datetime_migration_uses_postgresql_type():
    sql_type = database.DateTime(timezone=True).compile(
        dialect=postgresql.dialect()
    )

    assert str(sql_type) == "TIMESTAMP WITH TIME ZONE"


def test_room_membership_table_uses_postgresql_compatible_ddl():
    sql = str(CreateTable(database.RoomMembership.__table__).compile(
        dialect=postgresql.dialect()
    ))

    assert "SERIAL" in sql
    assert "TIMESTAMP WITH TIME ZONE" in sql
    assert "DEFAULT 'active'" in sql
    assert sql.count("DEFAULT CURRENT_TIMESTAMP") == 2
    assert "AUTOINCREMENT" not in sql


def test_match_key_migration_adds_unique_index_without_removing_history(tmp_path, monkeypatch):
    legacy_engine = create_engine(f"sqlite:///{tmp_path / 'matches.db'}")
    with legacy_engine.begin() as connection:
        connection.execute(text("""
            CREATE TABLE match_results (
                id INTEGER PRIMARY KEY,
                room_code VARCHAR(12) NOT NULL,
                winner_user_id INTEGER,
                player_count INTEGER NOT NULL,
                completed_at DATETIME NOT NULL
            )
        """))
        connection.execute(text("""
            INSERT INTO match_results (id, room_code, player_count, completed_at)
            VALUES (1, 'OLD001', 2, CURRENT_TIMESTAMP)
        """))

    monkeypatch.setattr(database, "engine", legacy_engine)
    database.init_database()

    with legacy_engine.connect() as connection:
        existing = connection.execute(text(
            "SELECT room_code FROM match_results WHERE id = 1"
        )).scalar_one()

    with legacy_engine.begin() as connection:
        connection.execute(text("""
            INSERT INTO match_results
                (room_code, match_key, player_count, completed_at)
            VALUES ('NEW001', 'stable-match-key', 2, CURRENT_TIMESTAMP)
        """))
    assert existing == "OLD001"

    with legacy_engine.begin() as connection:
        try:
            connection.execute(text("""
                INSERT INTO match_results
                    (room_code, match_key, player_count, completed_at)
                VALUES ('NEW002', 'stable-match-key', 2, CURRENT_TIMESTAMP)
            """))
            assert False, "Duplicate match keys must be rejected"
        except IntegrityError:
            pass


def test_database_room_snapshot_restores_paused_game_and_reconnect_session():
    room = Room("REST01", "player-a", [
        Player("player-a", "Ada"),
        Player("player-b", "Ben"),
    ])
    room.start("player-a")
    reconnect_token = room.players[0].reconnect_token
    voice = room.add_voice_message("player-a", "audio/webm", b"sample audio")
    database.save_active_room_snapshot(
        room.code,
        json.dumps(room.snapshot()),
    )
    rooms.clear()

    restore_rooms()

    restored = rooms["REST01"]
    assert restored.status == "playing"
    assert restored.is_paused is True
    assert all(not player.connected for player in restored.players)
    assert Room.reconnect_token_matches(restored.players[0], reconnect_token)
    assert restored.view("player-a")["hand"] == room.view("player-a")["hand"]
    assert restored.voice_message("player-b", voice["id"])["audio"] == b"sample audio"
