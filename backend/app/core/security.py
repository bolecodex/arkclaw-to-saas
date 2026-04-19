"""依赖注入：从请求中解析 session。"""

from typing import Optional

from fastapi import Depends, Header, HTTPException, status

from app.core.config import Settings, get_settings
from app.schemas.auth import SessionInfo
from app.services.jwt_service import decode_session_jwt


def get_current_session(
    authorization: Optional[str] = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> SessionInfo:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing bearer token",
        )
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = decode_session_jwt(token, settings.session_jwt_secret)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    return SessionInfo(
        user_id=payload.get("sub", ""),
        user_name=payload.get("name", ""),
        source=payload.get("src", "lark"),
        lark_token=payload.get("lark_token", ""),
        extra=payload.get("extra"),
    )
