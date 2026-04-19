"""JWT 服务：自家 session JWT 签发 + SaaS JWT 校验。"""

import logging
import time
from typing import Any, Dict, Optional

from jose import JWTError, jwt

logger = logging.getLogger(__name__)


def issue_session_jwt(
    secret: str,
    subject: str,
    extra: Optional[Dict[str, Any]] = None,
    ttl_seconds: int = 86400,
    algorithm: str = "HS256",
) -> str:
    """签发自家 session JWT，用于 widget 与后端之间的会话。"""
    now = int(time.time())
    payload: Dict[str, Any] = {
        "sub": subject,
        "iat": now,
        "exp": now + ttl_seconds,
        "iss": "arkclaw-saas-backend",
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, secret, algorithm=algorithm)


def decode_session_jwt(token: str, secret: str, algorithm: str = "HS256") -> Dict[str, Any]:
    try:
        return jwt.decode(token, secret, algorithms=[algorithm])
    except JWTError as e:
        raise ValueError(f"invalid session token: {e}") from e


def verify_saas_jwt(
    token: str,
    *,
    secret: str = "",
    public_key: str = "",
    algorithm: str = "HS256",
    issuer: str = "",
    audience: str = "",
) -> Dict[str, Any]:
    """校验 SaaS 传来的 JWT。

    支持 HS256（共享密钥）和 RS256（公钥）。
    """
    key = public_key if algorithm.startswith("RS") else secret
    if not key:
        raise ValueError("missing key for SaaS JWT verification")

    options = {"verify_aud": bool(audience)}
    try:
        payload = jwt.decode(
            token,
            key,
            algorithms=[algorithm],
            audience=audience or None,
            issuer=issuer or None,
            options=options,
        )
        return payload
    except JWTError as e:
        raise ValueError(f"invalid SaaS JWT: {e}") from e
