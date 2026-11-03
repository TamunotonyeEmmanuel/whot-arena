import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pwdlib import PasswordHash
from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import SessionLocal, User


ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()
JWT_SECRET = os.getenv("JWT_SECRET", "development-only-change-me-before-production-32bytes")
if ENVIRONMENT == "production" and (
    JWT_SECRET == "development-only-change-me-before-production-32bytes"
    or len(JWT_SECRET) < 32
):
    raise RuntimeError("Production requires a JWT_SECRET of at least 32 characters")
JWT_ALGORITHM = "HS256"
TOKEN_MINUTES = int(os.getenv("ACCESS_TOKEN_MINUTES", "1440"))
password_hash = PasswordHash.recommended()
bearer = HTTPBearer(auto_error=False)


def hash_password(password: str):
    return password_hash.hash(password)


def verify_password(password: str, encoded: str):
    return password_hash.verify(password, encoded)


def create_access_token(user: User):
    now = datetime.now(timezone.utc)
    return jwt.encode({"sub": str(user.id), "iat": now,
                       "exp": now + timedelta(minutes=TOKEN_MINUTES)},
                      JWT_SECRET, algorithm=JWT_ALGORITHM)


def token_user_id(token: str | None):
    if not token:
        return None
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return int(payload["sub"])
    except (jwt.PyJWTError, KeyError, TypeError, ValueError):
        return None


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
                 db: Session = Depends(get_db)):
    user_id = token_user_id(credentials.credentials if credentials else None)
    user = db.get(User, user_id) if user_id else None
    if not user or user.deleted_at is not None:
        raise HTTPException(status_code=401, detail="Invalid or expired access token")
    return user
