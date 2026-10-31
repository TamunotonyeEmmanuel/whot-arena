from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=24, pattern=r"^[A-Za-z0-9_]+$")
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value):
        return value.strip()


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    email: str
    matches_played: int
    wins: int
    arena_coins: int
    xp: int
    level: int
    win_streak: int
    best_win_streak: int
    achievements: list[str] = Field(validation_alias="achievement_list")
    unlocked_themes: list[str]
    unlocked_card_backs: list[str]
    unlocked_avatars: list[str]
    selected_theme: str
    selected_card_back: str
    selected_avatar: str


class CosmeticsRequest(BaseModel):
    theme: str
    card_back: str
    avatar: str


class PublicPlayerResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    matches_played: int
    wins: int


class MatchHistoryResponse(BaseModel):
    room_code: str
    result: str
    player_count: int
    completed_at: datetime


class DirectMessageCreate(BaseModel):
    recipient_username: str = Field(min_length=3, max_length=24)
    text: str = Field(min_length=1, max_length=500)


class DirectMessageResponse(BaseModel):
    id: int
    sender_username: str
    recipient_username: str
    text: str
    sent_at: datetime


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse
