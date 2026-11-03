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


class ProfileUpdate(BaseModel):
    username: str = Field(min_length=3, max_length=24, pattern=r"^[A-Za-z0-9_]+$")

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value):
        return value.strip()


class GameRulesRequest(BaseModel):
    cards_per_player: int = Field(ge=3, le=10)
    pick_two: int = Field(ge=1, le=10)
    pick_three: int = Field(ge=1, le=10)
    pick_three_enabled: bool = True
    general_market: int = Field(ge=1, le=5)
    penalty_stacking: bool


class GoogleCredentialRequest(BaseModel):
    credential: str = Field(min_length=1, max_length=8192)


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
    is_admin: bool


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


class TypingRequest(BaseModel):
    recipient_username: str = Field(min_length=3, max_length=24)
    typing: bool = True


class MatchInvitationCreate(BaseModel):
    recipient_username: str = Field(min_length=3, max_length=24)
    room_code: str = Field(min_length=4, max_length=12)


class DirectMessageResponse(BaseModel):
    id: int
    sender_username: str
    recipient_username: str
    text: str
    sent_at: datetime
    delivered_at: datetime | None = None
    read_at: datetime | None = None


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse
