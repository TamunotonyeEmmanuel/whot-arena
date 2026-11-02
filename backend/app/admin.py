from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .auth import current_user, get_db
from .database import User

router = APIRouter(prefix="/api/admin", tags=["Admin"])


def require_admin(user: User = Depends(current_user)):
    if not user.is_admin:
        raise HTTPException(
            status_code=403,
            detail="Administrator access required"
        )
    return user


class UserUpdate(BaseModel):
    username: str = Field(min_length=3, max_length=24)


class WalletUpdate(BaseModel):
    amount: int = Field(gt=0, le=1_000_000)
    reason: str = Field(min_length=3, max_length=200)


@router.get("/users")
def list_users(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    users = db.scalars(select(User).order_by(User.id)).all()

    return [
        {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "arena_coins": user.arena_coins,
            "matches_played": user.matches_played,
            "wins": user.wins,
            "is_admin": user.is_admin,
        }
        for user in users
    ]


@router.put("/users/{user_id}")
def edit_user(
    user_id: int,
    payload: UserUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    user = db.get(User, user_id)

    if not user:
        raise HTTPException(404, "User not found")

    if user.is_admin:
        raise HTTPException(403, "Administrator accounts are protected")

    username = payload.username.strip()

    existing = db.scalar(
        select(User).where(
            User.username == username,
            User.id != user_id
        )
    )

    if existing:
        raise HTTPException(409, "Username already exists")

    user.username = username
    db.commit()

    return {"message": "User updated successfully"}


@router.post("/users/{user_id}/fund")
def fund_user(
    user_id: int,
    payload: WalletUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    user = db.get(User, user_id)

    if not user:
        raise HTTPException(404, "User not found")

    if user.is_admin:
        raise HTTPException(403, "Administrator accounts are protected")

    result = db.execute(
        update(User)
        .where(User.id == user_id)
        .values(arena_coins=User.arena_coins + payload.amount)
    )

    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "Unable to fund account")

    db.commit()
    db.refresh(user)

    return {
        "message": "Account funded successfully",
        "balance": user.arena_coins
    }


@router.post("/users/{user_id}/debit")
def debit_user(
    user_id: int,
    payload: WalletUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    user = db.get(User, user_id)

    if not user:
        raise HTTPException(404, "User not found")

    if user.is_admin:
        raise HTTPException(403, "Administrator accounts are protected")

    result = db.execute(
        update(User)
        .where(
            User.id == user_id,
            User.arena_coins >= payload.amount
        )
        .values(arena_coins=User.arena_coins - payload.amount)
    )

    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(400, "Insufficient balance")

    db.commit()
    db.refresh(user)

    return {
        "message": "Account debited successfully",
        "balance": user.arena_coins
    }                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           