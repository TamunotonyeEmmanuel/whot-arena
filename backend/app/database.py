import os

from contextlib import contextmanager

from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, create_engine, inspect, select, text

from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./whot_arena.db")

if DATABASE_URL.startswith("postgres://"):

    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+psycopg://", 1)

elif DATABASE_URL.startswith("postgresql://"):

    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg://", 1)

if os.getenv("ENVIRONMENT", "development").lower() == "production" and not DATABASE_URL.startswith("postgresql+"):

    raise RuntimeError("Production requires a PostgreSQL DATABASE_URL")

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

    google_sub: Mapped[str | None] = mapped_column(String(255), nullable=True, unique=True, index=True)

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

        configured = os.getenv("ADMIN_EMAILS", "")

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

    match_key: Mapped[str | None] = mapped_column(String(64), nullable=True)

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


class RoomMembership(Base):
    """Persistent association between an authenticated player and a game table.

    A player can hold memberships in several rooms at once. Membership is
    preserved across browser refreshes, network drops, and supported server
    restarts. The active WebSocket session is tracked separately in memory.
    """

    __tablename__ = "room_memberships"

    __table_args__ = (
        UniqueConstraint("user_id", "room_code", name="uq_room_membership_user_room"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    room_code: Mapped[str] = mapped_column(
        String(12),
        nullable=False,
        index=True,
    )

    status: Mapped[str] = mapped_column(
        String(16),
        default="active",
        server_default=text("'active'"),
        nullable=False,
    )

    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        server_default=text("CURRENT_TIMESTAMP"),
        nullable=False,
    )

    last_active_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        server_default=text("CURRENT_TIMESTAMP"),
        nullable=False,
    )

    left_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )


class ActiveRoomSnapshot(Base):

    __tablename__ = "active_room_snapshots"

    room_code: Mapped[str] = mapped_column(String(12), primary_key=True)

    snapshot_json: Mapped[str] = mapped_column(Text)

    saved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


def _add_missing_columns(connection, table, additions):
    existing = {column["name"] for column in inspect(connection).get_columns(table)}
    for name, (column_type, default) in additions.items():
        if name in existing:
            continue
        definition = column_type.compile(dialect=connection.dialect)
        if default is not None:
            definition += f" NOT NULL DEFAULT {default}"
        connection.execute(
            text(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")
        )


def _add_user_account_fields_v1(connection):
    _add_missing_columns(connection, "users", {
        "xp": (Integer(), "0"),
        "arena_coins": (Integer(), "10000"),
        "win_streak": (Integer(), "0"),
        "best_win_streak": (Integer(), "0"),
        "achievements": (String(500), "''"),
        "selected_theme": (String(32), "'classic'"),
        "selected_card_back": (String(32), "'classic'"),
        "selected_avatar": (String(32), "'initial'"),
        "last_seen_at": (DateTime(timezone=True), None),
        "typing_to_id": (Integer(), None),
        "typing_at": (DateTime(timezone=True), None),
        "message_privacy": (String(16), "'everyone'"),
    })


def _add_message_delivery_fields_v1(connection):
    _add_missing_columns(connection, "direct_messages", {
        "delivered_at": (DateTime(timezone=True), None),
        "read_at": (DateTime(timezone=True), None),
    })


def _add_match_idempotency_key_v1(connection):
    _add_missing_columns(connection, "match_results", {
        "match_key": (String(64), None),
    })
    connection.execute(text(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_match_results_match_key "
        "ON match_results (match_key)"
    ))


def _ensure_arena_treasury_v1(connection):
    connection.execute(text(
        "INSERT INTO arena_treasury (id, virtual_naira_balance) "
        "VALUES (1, 0) ON CONFLICT (id) DO NOTHING"
    ))


def _add_room_memberships_v1(connection):
    RoomMembership.__table__.create(bind=connection, checkfirst=True)


def _add_google_account_id_v1(connection):
    _add_missing_columns(connection, "users", {
        "google_sub": (String(255), None),
    })
    connection.execute(text(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_google_sub "
        "ON users (google_sub)"
    ))


def _apply_migration(connection, name, upgrade):
    applied = connection.execute(
        text("SELECT name FROM data_migrations WHERE name = :name"),
        {"name": name},
    ).first()
    if applied:
        return
    upgrade(connection)
    connection.execute(
        text("INSERT INTO data_migrations (name, applied_at) VALUES (:name, :applied_at)"),
        {"name": name, "applied_at": utcnow()},
    )


def init_database():
    Base.metadata.create_all(bind=engine)
    with engine.begin() as connection:
        _apply_migration(
            connection,
            "001_add_user_account_fields",
            _add_user_account_fields_v1,
        )
        _apply_migration(
            connection,
            "002_add_message_delivery_fields",
            _add_message_delivery_fields_v1,
        )
        _apply_migration(
            connection,
            "003_add_match_idempotency_key",
            _add_match_idempotency_key_v1,
        )
        _apply_migration(
            connection,
            "004_ensure_arena_treasury",
            _ensure_arena_treasury_v1,
        )
        _apply_migration(
            connection,
            "005_add_room_memberships",
            _add_room_memberships_v1,
        )
        _apply_migration(
            connection,
            "006_add_google_account_id",
            _add_google_account_id_v1,
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


def upsert_active_room_snapshot(session, room_code, snapshot_json):
    snapshot = session.get(ActiveRoomSnapshot, room_code)
    if snapshot is None:
        snapshot = ActiveRoomSnapshot(
            room_code=room_code,
            snapshot_json=snapshot_json,
        )
        session.add(snapshot)
    else:
        snapshot.snapshot_json = snapshot_json
        snapshot.saved_at = utcnow()


def save_active_room_snapshot(room_code, snapshot_json):
    with database_session() as session:
        upsert_active_room_snapshot(session, room_code, snapshot_json)


def load_active_room_snapshots():
    with SessionLocal() as session:
        return [
            (snapshot.room_code, snapshot.snapshot_json, snapshot.saved_at)
            for snapshot in session.query(ActiveRoomSnapshot).all()
        ]


def delete_active_room_snapshot(room_code):
    with database_session() as session:
        snapshot = session.get(ActiveRoomSnapshot, room_code)
        if snapshot is not None:
            session.delete(snapshot)


def upsert_room_membership(session, user_id, room_code, status="active"):
    """Create or reactivate a membership row for a player in a room."""
    membership = session.execute(
        select(RoomMembership).where(
            RoomMembership.user_id == user_id,
            RoomMembership.room_code == room_code,
        )
    ).scalar_one_or_none()
    now = utcnow()
    if membership is None:
        membership = RoomMembership(
            user_id=user_id,
            room_code=room_code,
            status=status,
            joined_at=now,
            last_active_at=now,
            left_at=None,
        )
        session.add(membership)
    else:
        membership.status = status
        membership.last_active_at = now
        if status != "left":
            membership.left_at = None
    return membership


def touch_room_membership(session, user_id, room_code):
    membership = session.execute(
        select(RoomMembership).where(
            RoomMembership.user_id == user_id,
            RoomMembership.room_code == room_code,
        )
    ).scalar_one_or_none()
    if membership is None:
        return None
    membership.last_active_at = utcnow()
    return membership


def mark_room_membership_left(session, user_id, room_code):
    membership = session.execute(
        select(RoomMembership).where(
            RoomMembership.user_id == user_id,
            RoomMembership.room_code == room_code,
        )
    ).scalar_one_or_none()
    if membership is None:
        return None
    membership.status = "left"
    membership.left_at = utcnow()
    membership.last_active_at = membership.left_at
    return membership


def list_room_memberships(session, user_id, statuses=("active", "away")):
    return list(session.execute(
        select(RoomMembership).where(
            RoomMembership.user_id == user_id,
            RoomMembership.status.in_(tuple(statuses)),
        ).order_by(RoomMembership.last_active_at.desc())
    ).scalars().all())


def get_room_membership(session, user_id, room_code):
    return session.execute(
        select(RoomMembership).where(
            RoomMembership.user_id == user_id,
            RoomMembership.room_code == room_code,
        )
    ).scalar_one_or_none()
