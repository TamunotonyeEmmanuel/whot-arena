from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, delete, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import create_access_token, current_user, get_db, hash_password, verify_password
from .database import DirectMessage, Friendship, MatchInvitation, MatchParticipant, MatchResult, User, UserBlock, utcnow
from .schemas import (AuthResponse, CosmeticsRequest, DirectMessageCreate,
                      DirectMessageResponse, LoginRequest, MatchHistoryResponse,
                      MatchInvitationCreate, PublicPlayerResponse, RegisterRequest,
                      TypingRequest, UserResponse)


router = APIRouter(prefix="/api", tags=["accounts"])


def find_player(username: str, db: Session):
    return db.scalar(select(User).where(User.username.ilike(username.strip())))


def friendship_between(first_id: int, second_id: int, db: Session):
    return db.scalar(select(Friendship).where(or_(
        and_(Friendship.requester_id == first_id, Friendship.recipient_id == second_id),
        and_(Friendship.requester_id == second_id, Friendship.recipient_id == first_id))))


def blocked_between(first_id: int, second_id: int, db: Session):
    return db.scalar(select(UserBlock).where(or_(
        and_(UserBlock.blocker_id == first_id, UserBlock.blocked_id == second_id),
        and_(UserBlock.blocker_id == second_id, UserBlock.blocked_id == first_id))))


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


@router.get("/players/search", response_model=list[PublicPlayerResponse])
def search_players(q: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    query = q.strip()
    if len(query) < 2:
        return []
    return list(db.scalars(
        select(User).where(User.id != user.id, User.username.ilike(f"%{query}%"))
        .order_by(User.username.asc()).limit(10)
    ))


def direct_message_payload(message: DirectMessage, db: Session):
    sender = db.get(User, message.sender_id)
    recipient = db.get(User, message.recipient_id)
    return {"id": message.id, "sender_username": sender.username,
            "recipient_username": recipient.username, "text": message.text,
            "sent_at": message.sent_at, "delivered_at": message.delivered_at,
            "read_at": message.read_at}


@router.get("/messages", response_model=list[DirectMessageResponse])
def direct_messages(limit: int = 100, user: User = Depends(current_user),
                    db: Session = Depends(get_db)):
    limit = max(1, min(limit, 200))
    messages = list(db.scalars(
        select(DirectMessage)
        .where(or_(DirectMessage.sender_id == user.id,
                   DirectMessage.recipient_id == user.id))
        .order_by(DirectMessage.sent_at.desc()).limit(limit)
    ))
    now = utcnow()
    user.last_seen_at = now
    for message in messages:
        if message.recipient_id == user.id and message.delivered_at is None:
            message.delivered_at = now
    db.commit()
    return [direct_message_payload(message, db) for message in reversed(messages)]


@router.post("/messages/read/{username}")
def read_conversation(username: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    other = db.scalar(select(User).where(User.username.ilike(username.strip())))
    if not other:
        raise HTTPException(status_code=404, detail="Player username not found")
    now = utcnow()
    messages = db.scalars(select(DirectMessage).where(
        DirectMessage.sender_id == other.id, DirectMessage.recipient_id == user.id,
        DirectMessage.read_at.is_(None)))
    count = 0
    for message in messages:
        message.delivered_at = message.delivered_at or now
        message.read_at = now
        count += 1
    user.last_seen_at = now
    db.commit()
    return {"read": count}


@router.post("/messages/typing")
def set_typing(payload: TypingRequest, user: User = Depends(current_user), db: Session = Depends(get_db)):
    recipient = db.scalar(select(User).where(User.username.ilike(payload.recipient_username.strip())))
    if not recipient:
        raise HTTPException(status_code=404, detail="Player username not found")
    user.last_seen_at = utcnow()
    user.typing_to_id = recipient.id if payload.typing else None
    user.typing_at = utcnow() if payload.typing else None
    db.commit()
    return {"ok": True}


@router.get("/players/{username}/presence")
def player_presence(username: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    other = db.scalar(select(User).where(User.username.ilike(username.strip())))
    if not other:
        raise HTTPException(status_code=404, detail="Player username not found")
    now = utcnow()
    last_seen = other.last_seen_at
    online = bool(last_seen and now - last_seen.replace(tzinfo=last_seen.tzinfo or now.tzinfo) < timedelta(seconds=20))
    typing = bool(other.typing_to_id == user.id and other.typing_at and
                  now - other.typing_at.replace(tzinfo=other.typing_at.tzinfo or now.tzinfo) < timedelta(seconds=5))
    return {"online": online, "typing": typing, "last_seen_at": last_seen}


@router.get("/players/{username}/card")
def player_card(username: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    other = find_player(username, db)
    if not other:
        raise HTTPException(status_code=404, detail="Player username not found")
    friendship = friendship_between(user.id, other.id, db)
    blocked = db.scalar(select(UserBlock).where(UserBlock.blocker_id == user.id,
                                                UserBlock.blocked_id == other.id))
    return {"username": other.username, "wins": other.wins, "matches_played": other.matches_played,
            "level": other.level, "achievements": other.achievement_list,
            "friend_status": friendship.status if friendship else None,
            "friend_requested_by_you": bool(friendship and friendship.requester_id == user.id),
            "blocked": bool(blocked)}


@router.get("/friends")
def friends(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = list(db.scalars(select(Friendship).where(or_(Friendship.requester_id == user.id,
                                                        Friendship.recipient_id == user.id))))
    result = []
    for row in rows:
        other = db.get(User, row.recipient_id if row.requester_id == user.id else row.requester_id)
        result.append({"username": other.username, "status": row.status,
                       "direction": "outgoing" if row.requester_id == user.id else "incoming"})
    return result


@router.post("/friends/{username}")
def request_friend(username: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    other = find_player(username, db)
    if not other or other.id == user.id:
        raise HTTPException(status_code=400, detail="Choose another player")
    if blocked_between(user.id, other.id, db):
        raise HTTPException(status_code=403, detail="Friend request unavailable")
    existing = friendship_between(user.id, other.id, db)
    if existing:
        if existing.recipient_id == user.id and existing.status == "pending":
            existing.status = "accepted"
        else:
            return {"status": existing.status}
    else:
        db.add(Friendship(requester_id=user.id, recipient_id=other.id))
    db.commit()
    return {"status": "accepted" if existing and existing.status == "accepted" else "pending"}


@router.post("/friends/{username}/accept")
def accept_friend(username: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    other = find_player(username, db)
    friendship = friendship_between(user.id, other.id, db) if other else None
    if not friendship or friendship.recipient_id != user.id:
        raise HTTPException(status_code=404, detail="Friend request not found")
    friendship.status = "accepted"; db.commit(); return {"status": "accepted"}


@router.delete("/friends/{username}")
def remove_friend(username: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    other = find_player(username, db)
    friendship = friendship_between(user.id, other.id, db) if other else None
    if friendship: db.delete(friendship); db.commit()
    return {"ok": True}


@router.post("/blocks/{username}")
def block_player(username: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    other = find_player(username, db)
    if not other or other.id == user.id: raise HTTPException(status_code=400, detail="Choose another player")
    if not db.scalar(select(UserBlock).where(UserBlock.blocker_id == user.id, UserBlock.blocked_id == other.id)):
        db.add(UserBlock(blocker_id=user.id, blocked_id=other.id))
    friendship = friendship_between(user.id, other.id, db)
    if friendship: db.delete(friendship)
    db.commit(); return {"blocked": True}


@router.delete("/blocks/{username}")
def unblock_player(username: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    other = find_player(username, db)
    if other: db.execute(delete(UserBlock).where(UserBlock.blocker_id == user.id, UserBlock.blocked_id == other.id)); db.commit()
    return {"blocked": False}


@router.put("/profile/message-privacy")
def message_privacy(value: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if value not in {"everyone", "friends"}: raise HTTPException(status_code=400, detail="Invalid privacy option")
    user.message_privacy = value; db.commit(); return {"message_privacy": value}


def invitation_payload(invitation: MatchInvitation, user: User, db: Session):
    sender = db.get(User, invitation.sender_id); recipient = db.get(User, invitation.recipient_id)
    return {"id": invitation.id, "sender_username": sender.username,
            "recipient_username": recipient.username, "room_code": invitation.room_code,
            "status": invitation.status, "created_at": invitation.created_at,
            "incoming": invitation.recipient_id == user.id}


@router.get("/match-invitations")
def match_invitations(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(MatchInvitation).where(or_(MatchInvitation.sender_id == user.id,
                                                        MatchInvitation.recipient_id == user.id))
                      .order_by(MatchInvitation.created_at.desc()).limit(50))
    return [invitation_payload(row, user, db) for row in rows]


@router.post("/match-invitations", status_code=status.HTTP_201_CREATED)
def create_match_invitation(payload: MatchInvitationCreate, user: User = Depends(current_user),
                            db: Session = Depends(get_db)):
    recipient = find_player(payload.recipient_username, db)
    if not recipient or recipient.id == user.id: raise HTTPException(status_code=400, detail="Choose another player")
    if blocked_between(user.id, recipient.id, db): raise HTTPException(status_code=403, detail="Invitation unavailable")
    invitation = MatchInvitation(sender_id=user.id, recipient_id=recipient.id,
                                 room_code=payload.room_code.strip().upper())
    db.add(invitation); db.commit(); db.refresh(invitation)
    return invitation_payload(invitation, user, db)


@router.post("/match-invitations/{invitation_id}/{decision}")
def respond_match_invitation(invitation_id: int, decision: str, user: User = Depends(current_user),
                             db: Session = Depends(get_db)):
    if decision not in {"accept", "decline"}: raise HTTPException(status_code=400, detail="Invalid decision")
    invitation = db.get(MatchInvitation, invitation_id)
    if not invitation or invitation.recipient_id != user.id: raise HTTPException(status_code=404, detail="Invitation not found")
    invitation.status = "accepted" if decision == "accept" else "declined"
    db.commit(); return invitation_payload(invitation, user, db)


@router.post("/messages", response_model=DirectMessageResponse, status_code=status.HTTP_201_CREATED)
def send_direct_message(payload: DirectMessageCreate, user: User = Depends(current_user),
                        db: Session = Depends(get_db)):
    recipient = db.scalar(select(User).where(
        User.username.ilike(payload.recipient_username.strip())))
    if not recipient:
        raise HTTPException(status_code=404, detail="Player username not found")
    if recipient.id == user.id:
        raise HTTPException(status_code=400, detail="Choose another player")
    if blocked_between(user.id, recipient.id, db):
        raise HTTPException(status_code=403, detail="Messaging is unavailable for this player")
    friendship = friendship_between(user.id, recipient.id, db)
    if recipient.message_privacy == "friends" and (not friendship or friendship.status != "accepted"):
        raise HTTPException(status_code=403, detail="This player only accepts messages from friends")
    text_value = payload.text.strip()
    if not text_value:
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    message = DirectMessage(sender_id=user.id, recipient_id=recipient.id, text=text_value)
    db.add(message)
    db.commit()
    db.refresh(message)
    return direct_message_payload(message, db)
