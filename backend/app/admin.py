import os
import secrets

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import current_user, get_db
from .database import (
    AdminWalletTransaction, GameRuleSettings, RoomMembership, User, utcnow,
)
from .schemas import GameRulesRequest

router = APIRouter(prefix="/api/admin", tags=["Admin"])

DEFAULT_GAME_RULES = {
    "cards_per_player": 5,
    "pick_two": 2,
    "pick_three": 3,
    "general_market": 1,
    "penalty_stacking": True,
}


def require_admin(user: User = Depends(current_user)):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Administrator access required")
    return user


def rules_payload(settings: GameRuleSettings | None):
    if settings is None:
        return DEFAULT_GAME_RULES.copy()
    return {
        "cards_per_player": settings.cards_per_player,
        "pick_two": settings.pick_two,
        "pick_three": settings.pick_three,
        "general_market": settings.general_market,
        "penalty_stacking": settings.penalty_stacking,
    }


@router.get("/rules")
def get_admin_rules(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return rules_payload(db.get(GameRuleSettings, 1))


@router.put("/rules")
def update_admin_rules(
    payload: GameRulesRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    settings = db.get(GameRuleSettings, 1)
    if settings is None:
        settings = GameRuleSettings(id=1)
        db.add(settings)
    settings.cards_per_player = payload.cards_per_player
    settings.pick_two = payload.pick_two
    settings.pick_three = payload.pick_three
    settings.general_market = payload.general_market
    settings.penalty_stacking = payload.penalty_stacking
    db.commit()
    db.refresh(settings)
    return rules_payload(settings)


class UserUpdate(BaseModel):
    username: str = Field(min_length=3, max_length=24, pattern=r"^[A-Za-z0-9_]+$")
    email: EmailStr

    @field_validator("username", mode="before")
    @classmethod
    def normalize_username(cls, value: object):
        return value.strip() if isinstance(value, str) else value

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: EmailStr):
        return str(value).strip().lower()


class WalletUpdate(BaseModel):
    amount: int = Field(gt=0, le=1_000_000)
    reason: str = Field(min_length=3, max_length=200)

    @field_validator("reason", mode="before")
    @classmethod
    def normalize_reason(cls, value: object):
        return value.strip() if isinstance(value, str) else value


def user_summary(user: User):
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "arena_coins": user.arena_coins,
        "matches_played": user.matches_played,
        "wins": user.wins,
        "is_admin": user.is_admin,
    }


@router.get("/users")
def list_users(
    q: str = Query(default="", max_length=100),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    filters = [User.deleted_at.is_(None)]
    query = q.strip()
    if query:
        search = f"%{query}%"
        filters.append(or_(User.username.ilike(search), User.email.ilike(search)))

    total = db.scalar(select(func.count(User.id)).where(*filters)) or 0
    users = db.scalars(
        select(User).where(*filters).order_by(User.id.desc()).offset(offset).limit(limit)
    ).all()
    return {"items": [user_summary(user) for user in users], "total": total}


def get_manageable_user(user_id: int, db: Session):
    user = db.get(User, user_id)
    if user is None or user.deleted_at is not None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.is_admin:
        raise HTTPException(status_code=403, detail="Administrator accounts are protected")
    return user


@router.put("/users/{user_id}")
def edit_user(
    user_id: int,
    payload: UserUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = get_manageable_user(user_id, db)
    username = payload.username.strip()
    email = str(payload.email).strip().lower()
    reserved_admin_emails = {
        configured.strip().lower()
        for configured in os.getenv("ADMIN_EMAILS", "").split(",")
        if configured.strip()
    }
    if email in reserved_admin_emails:
        raise HTTPException(status_code=409, detail="Email is reserved for an administrator account")

    existing = db.scalar(
        select(User.id).where(
            User.id != user_id,
            or_(
                func.lower(User.username) == username.lower(),
                func.lower(User.email) == email,
            ),
        )
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail="Username or email already exists")

    user.username = username
    user.email = email
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="Username or email already exists") from error
    db.refresh(user)
    return user_summary(user)


def adjust_wallet(user_id: int, payload: WalletUpdate, admin: User, db: Session, action: str):
    user = get_manageable_user(user_id, db)
    if action == "fund":
        conditions = [User.id == user_id, User.deleted_at.is_(None)]
        balance_change = User.arena_coins + payload.amount
    else:
        conditions = [
            User.id == user_id,
            User.deleted_at.is_(None),
            User.arena_coins >= payload.amount,
        ]
        balance_change = User.arena_coins - payload.amount

    result = db.execute(update(User).where(*conditions).values(arena_coins=balance_change))
    if result.rowcount != 1:
        db.rollback()
        if action == "debit":
            raise HTTPException(status_code=400, detail="Insufficient balance")
        raise HTTPException(status_code=409, detail="Unable to fund account")

    db.refresh(user)
    db.add(AdminWalletTransaction(
        admin_user_id=admin.id,
        user_id=user.id,
        action=action,
        amount=payload.amount,
        balance_after=user.arena_coins,
        reason=payload.reason,
    ))
    db.commit()
    return {"message": f"Account {action}ed successfully", "balance": user.arena_coins}


@router.post("/users/{user_id}/fund")
def fund_user(
    user_id: int,
    payload: WalletUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return adjust_wallet(user_id, payload, admin, db, "fund")


@router.post("/users/{user_id}/debit")
def debit_user(
    user_id: int,
    payload: WalletUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return adjust_wallet(user_id, payload, admin, db, "debit")


@router.get("/users/{user_id}/wallet-history")
def wallet_history(
    user_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    get_manageable_user(user_id, db)
    transactions = db.execute(
        select(AdminWalletTransaction, User.username)
        .join(User, User.id == AdminWalletTransaction.admin_user_id)
        .where(AdminWalletTransaction.user_id == user_id)
        .order_by(AdminWalletTransaction.created_at.desc(), AdminWalletTransaction.id.desc())
        .limit(50)
    )
    return [
        {
            "id": transaction.id,
            "admin": admin_name,
            "action": transaction.action,
            "amount": transaction.amount,
            "balance_after": transaction.balance_after,
            "reason": transaction.reason,
            "created_at": transaction.created_at,
        }
        for transaction, admin_name in transactions
    ]


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = get_manageable_user(user_id, db)
    now = utcnow()
    user.deleted_at = now
    deletion_key = secrets.token_hex(4)
    user.username = f"deleted_{user.id}_{deletion_key}"[:24]
    user.email = f"deleted-{user.id}-{deletion_key}@deleted.invalid"
    user.password_hash = secrets.token_urlsafe(48)
    user.google_sub = None
    db.execute(
        update(RoomMembership)
        .where(RoomMembership.user_id == user_id, RoomMembership.status != "left")
        .values(status="left", left_at=now, last_active_at=now)
    )
    db.commit()
    return {"message": "Account deleted and personal details anonymized"}
