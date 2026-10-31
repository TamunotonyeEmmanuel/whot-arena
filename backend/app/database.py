import os
from contextlib import contextmanager
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, create_engine, inspect, text
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
    xp: Mapped[int] = mapped_column(Integer, default=0)
    win_streak: Mapped[int] = mapped_column(Integer, default=0)
    best_win_streak: Mapped[int] = mapped_column(Integer, default=0)
    achievements: Mapped[str] = mapped_column(String(500), default="")
    selected_theme: Mapped[str] = mapped_column(String(32), default="classic")
    selected_card_back: Mapped[str] = mapped_column(String(32), default="classic")
    selected_avatar: Mapped[str] = mapped_column(String(32), default="initial")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    @property
    def level(self):
        return self.xp // 500 + 1

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


def init_database():
    Base.metadata.create_all(bind=engine)
    existing = {column["name"] for column in inspect(engine).get_columns("users")}
    additions = {
        "xp": "INTEGER NOT NULL DEFAULT 0",
        "win_streak": "INTEGER NOT NULL DEFAULT 0",
        "best_win_streak": "INTEGER NOT NULL DEFAULT 0",
        "achievements": "VARCHAR(500) NOT NULL DEFAULT ''",
        "selected_theme": "VARCHAR(32) NOT NULL DEFAULT 'classic'",
        "selected_card_back": "VARCHAR(32) NOT NULL DEFAULT 'classic'",
        "selected_avatar": "VARCHAR(32) NOT NULL DEFAULT 'initial'",
    }
    with engine.begin() as connection:
        for name, definition in additions.items():
            if name not in existing:
                connection.execute(text(f"ALTER TABLE users ADD COLUMN {name} {definition}"))


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
