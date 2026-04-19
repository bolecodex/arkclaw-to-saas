"""聊天凭证签发：用 session 换 ChatToken+Endpoint。"""

import logging
import urllib.parse

from fastapi import APIRouter, Depends, HTTPException

from app.core.config import Settings, get_settings
from app.core.security import get_current_session
from app.schemas.auth import SessionInfo
from app.schemas.chat import ChatTokenRequest, ChatTokenResponse
from app.services import arkclaw

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("/token", response_model=ChatTokenResponse, summary="签发 ChatToken")
def issue_chat_token(
    req: ChatTokenRequest,
    settings: Settings = Depends(get_settings),
    session: SessionInfo = Depends(get_current_session),
) -> ChatTokenResponse:
    if not settings.ak or not settings.sk:
        raise HTTPException(500, "VOLC AK/SK not configured")

    instance_id = req.instance_id or settings.arkclaw_default_instance_id
    if not instance_id:
        raise HTTPException(400, "instance_id required")

    status = arkclaw.get_instance_status(settings.ak, settings.sk, instance_id, settings.arkclaw_region)
    if status != "Running":
        try:
            arkclaw.wait_ready(
                settings.ak, settings.sk, instance_id, settings.arkclaw_region,
                interval=3, timeout=60,
            )
        except TimeoutError as e:
            raise HTTPException(503, f"instance not ready: {e}") from e

    chat_token, endpoint = arkclaw.get_chat_token(
        settings.ak, settings.sk, instance_id, settings.arkclaw_region
    )

    # 关键：ArkClaw WebSocket 协议握手要求带上 user_access_token（来自飞书 OAuth）
    # demo/web_demo.py 验证过的拼接：?chatToken=&clawInstanceId=&token=USER_TOKEN
    ws_url = (
        f"wss://{endpoint}/?chatToken={urllib.parse.quote(chat_token)}"
        f"&clawInstanceId={urllib.parse.quote(instance_id)}"
    )
    if session.lark_token:
        ws_url += f"&token={urllib.parse.quote(session.lark_token)}"

    logger.info(
        "issued chat token for user=%s instance=%s has_user_token=%s",
        session.user_id, instance_id, bool(session.lark_token),
    )
    return ChatTokenResponse(
        chat_token=chat_token,
        endpoint=endpoint,
        instance_id=instance_id,
        ws_url=ws_url,
    )
