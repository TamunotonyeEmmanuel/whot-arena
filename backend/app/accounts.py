from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import create_access_token, current_user, get_db, hash_password, verify_password
from .database import MatchParticipant, MatchResult, User
from .schemas import (AuthResponse, CosmeticsRequest, LoginRequest, MatchHistoryResponse,
                      PublicPlayerResponse, RegisterRequest, UserResponse)


router = APIRouter(prefix="/api", tags=["accounts"])


@router.post("/auth/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    email = str(payload.email).lower()
    exists = db.scalar(select(User).where(or_(User.email == email,
                                               User.username == payload.username)))
    if exists:
        raise HTTPException(status_code=409, detail="Email or username already registered")
    user = User(username=payload.username, email=email,
                password_hash=hash_password(payload.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Email or username already registered")
    db.refresh(user)
    return AuthResponse(access_token=create_access_token(user), user=user)


@router.post("/auth/login", response_model=AuthResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == str(payload.email).lower()))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return AuthResponse(access_token=create_access_token(user), user=user)


@router.get("/profile", response_model=UserResponse)
def profile(user: User = Depends(current_user)):
    return user


@router.put("/profile/cosmetics", response_model=UserResponse)
def update_cosmetics(payload: CosmeticsRequest, user: User = Depends(current_user),
                     db: Session = Depends(get_db)):
    if payload.theme not in user.unlocked_themes or payload.card_back not in user.unlocked_card_backs or payload.avatar not in user.unlocked_avatars:
        raise HTTPException(status_code=403, detail="That cosmetic has not been unlocked")
    user.selected_theme = payload.theme
    user.selected_card_back = payload.card_back
    user.selected_avatar = payload.avatar
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.get("/leaderboard", response_model=list[PublicPlayerResponse])
def leaderboard(limit: int = 50, db: Session = Depends(get_db)):
    limit = max(1, min(limit, 100))
    return list(db.scalars(select(User).order_by(User.wins.desc(),
                                                  User.matches_played.asc(),
                                                  User.username.asc()).limit(limit)))


@router.get("/history", response_model=list[MatchHistoryResponse])
def match_history(limit: int = 20, user: User = Depends(current_user),
                  db: Session = Depends(get_db)):
    limit = max(1, min(limit, 100))
    matches = db.scalars(
        select(MatchResult)
        .join(MatchParticipant)
        .where(MatchParticipant.user_id == user.id)
        .order_by(MatchResult.completed_at.desc())
        .limit(limit)
    )
    return [{
        "room_code": match.room_code,
        "result": "win" if match.winner_user_id == user.id else "loss",
        "player_count": match.player_count,
        "completed_at": match.completed_at,
    } for match in matches]
