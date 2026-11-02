import os
import tempfile
from pathlib import Path

import pytest


_test_database_directory = tempfile.TemporaryDirectory(prefix="whot-arena-tests-")
os.environ["DATABASE_URL"] = str(
    Path(_test_database_directory.name, "test.db").as_uri()
).replace("file://", "sqlite:///")


@pytest.fixture(autouse=True)
def isolate_persisted_rooms():
    from sqlalchemy import delete

    from app.database import ActiveRoomSnapshot, SessionLocal, init_database
    from app.main import (
        connections, notification_connections, pid_user, rooms,
        turn_notification_state, user_pids,
    )

    init_database()
    rooms.clear()
    connections.clear()
    notification_connections.clear()
    turn_notification_state.clear()
    pid_user.clear()
    user_pids.clear()
    with SessionLocal.begin() as session:
        session.execute(delete(ActiveRoomSnapshot))
    yield
    rooms.clear()
    connections.clear()
    notification_connections.clear()
    turn_notification_state.clear()
    pid_user.clear()
    user_pids.clear()
    with SessionLocal.begin() as session:
        session.execute(delete(ActiveRoomSnapshot))
