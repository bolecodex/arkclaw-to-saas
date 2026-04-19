"""认证相关 schema。"""

from typing import Optional

from pydantic import BaseModel, Field


class SaasLoginRequest(BaseModel):
    """SaaS 直接传 JWT 登录。"""

    saas_token: str = Field(..., description="SaaS 系统签发的 JWT")


class LoginResponse(BaseModel):
    session_token: str
    user_name: str = ""
    user_id: str = ""
    expires_in: int = 86400


class SessionInfo(BaseModel):
    user_id: str
    user_name: str = ""
    source: str = "lark"
    # 飞书 user_access_token，拼接到 ws_url 用，dev/saas 模式下为空
    lark_token: str = ""
    extra: Optional[dict] = None
