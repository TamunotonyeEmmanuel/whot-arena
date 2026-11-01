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
    from app.main import rooms

    init_database()
    rooms.clear()
    with SessionLocal.begin() as session:
        session.execute(delete(ActiveRoomSnapshot))
    yield
    rooms.clear()
    with SessionLocal.begin() as session:
        session.execute(delete(ActiveRoomSnapshot))
