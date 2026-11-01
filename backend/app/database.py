import os
from contextlib import contextmanager
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker


DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./whot_arena.db")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+psycopg://", 1)
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg://", 1)
engine_options = {"pool_pre_ping": True}
if DATABASE_URL.startswith("sqlite"):
    engine_options["connect_args"] = {"check_same_thread": False}
engine = create_engine(DATABASE_URL, **engine_options)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def utcnow():
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(24), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    matches_played: Mapped[int] = mapped_column(Integer, default=0)
    wins: Mapped[int] = mapped_column(Integer, default=0)
    arena_coins: Mapped[int] = mapped_column(Integer, default=10_000)
    xp: Mapped[int] = mapped_column(Integer, default=0)
    win_streak: Mapped[int] = mapped_column(Integer, default=0)
    best_win_streak: Mapped[int] = mapped_column(Integer, default=0)
    achievements: Mapped[str] = mapped_column(String(500), default="")
    selected_theme: Mapped[str] = mapped_column(String(32), default="classic")
    selected_card_back: Mapped[str] = mapped_column(String(32), default="classic")
    selected_avatar: Mapped[str] = mapped_column(String(32), default="initial")
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    typing_to_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    typing_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    message_privacy: Mapped[str] = mapped_column(String(16), default="everyone")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    @property
    def level(self):
        return self.xp // 500 + 1

    @property
    def is_admin(self):
        configured = os.getenv("ADMIN_EMAILS", "adokiyenengisa@gmail.com")
        return self.email.lower() in {email.strip().lower() for email in configured.split(",") if email.strip()}

    @property
    def achievement_list(self):
        return [item for item in self.achievements.split(",") if item]

    @property
    def unlocked_themes(self):
        return ["classic"] + (["midnight"] if self.level >= 2 else []) + (["royal"] if self.level >= 4 else [])

    @property
    def unlocked_card_backs(self):
        return ["classic"] + (["crimson"] if self.level >= 2 else []) + (["gold"] if self.level >= 5 else [])

    @property
    def unlocked_avatars(self):
        return ["initial"] + (["crown"] if self.level >= 3 else []) + (["star"] if self.level >= 4 else [])


class MatchResult(Base):
    __tablename__ = "match_results"

    id: Mapped[int] = mapped_column(primary_key=True)
    room_code: Mapped[str] = mapped_column(String(12), index=True)
    winner_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    player_count: Mapped[int] = mapped_column(Integer)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    winner: Mapped[User | None] = relationship()
    participants: Mapped[list["MatchParticipant"]] = relationship(
        back_populates="match", cascade="all, delete-orphan"
    )


class MatchParticipant(Base):
    __tablename__ = "match_participants"

    id: Mapped[int] = mapped_column(primary_key=True)
    match_result_id: Mapped[int] = mapped_column(ForeignKey("match_results.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    did_win: Mapped[bool] = mapped_column(default=False)
    match: Mapped[MatchResult] = relationship(back_populates="participants")
    user: Mapped[User] = relationship()


class DirectMessage(Base):
    __tablename__ = "direct_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    recipient_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    text: Mapped[str] = mapped_column(String(500))
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ArenaTreasury(Base):
    __tablename__ = "arena_treasury"

    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    virtual_naira_balance: Mapped[int] = mapped_column(Integer, default=0)


class Friendship(Base):
    __tablename__ = "friendships"
    __table_args__ = (UniqueConstraint("requester_id", "recipient_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    requester_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    recipient_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class UserBlock(Base):
    __tablename__ = "user_blocks"
    __table_args__ = (UniqueConstraint("blocker_id", "blocked_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    blocker_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    blocked_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class MatchInvitation(Base):
    __tablename__ = "match_invitations"
    id: Mapped[int] = mapped_column(primary_key=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    recipient_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    room_code: Mapped[str] = mapped_column(String(12), index=True)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DataMigration(Base):
    __tablename__ = "data_migrations"

    name: Mapped[str] = mapped_column(String(100), primary_key=True)
    applied_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


def init_database():
    Base.metadata.create_all(bind=engine)
    existing = {column["name"] for column in inspect(engine).get_columns("users")}
    additions = {
        "xp": "INTEGER NOT NULL DEFAULT 0",
        "arena_coins": "INTEGER NOT NULL DEFAULT 10000",
        "win_streak": "INTEGER NOT NULL DEFAULT 0",
        "best_win_streak": "INTEGER NOT NULL DEFAULT 0",
        "achievements": "VARCHAR(500) NOT NULL DEFAULT ''",
        "selected_theme": "VARCHAR(32) NOT NULL DEFAULT 'classic'",
        "selected_card_back": "VARCHAR(32) NOT NULL DEFAULT 'classic'",
        "selected_avatar": "VARCHAR(32) NOT NULL DEFAULT 'initial'",
        "last_seen_at": "DATETIME",
        "typing_to_id": "INTEGER",
        "typing_at": "DATETIME",
        "message_privacy": "VARCHAR(16) NOT NULL DEFAULT 'everyone'",
    }
    with engine.begin() as connection:
        for name, definition in additions.items():
            if name not in existing:
                connection.execute(text(f"ALTER TABLE users ADD COLUMN {name} {definition}"))
        message_columns = {column["name"] for column in inspect(engine).get_columns("direct_messages")}
        for name in ("delivered_at", "read_at"):
            if name not in message_columns:
                connection.execute(text(f"ALTER TABLE direct_messages ADD COLUMN {name} DATETIME"))
        starting_balance_migration = "set_existing_users_starting_balance_10000"
        already_applied = connection.execute(
            text("SELECT name FROM data_migrations WHERE name = :name"),
            {"name": starting_balance_migration},
        ).first()
        if not already_applied:
            connection.execute(text("UPDATE users SET arena_coins = 10000"))
            connection.execute(
                text("INSERT INTO data_migrations (name, applied_at) VALUES (:name, :applied_at)"),
                {"name": starting_balance_migration, "applied_at": utcnow()},
            )


@contextmanager
def database_session():
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
