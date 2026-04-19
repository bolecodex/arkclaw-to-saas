"""诊断接口：直接用 backend 模拟 widget 的 ws 链路，看 ArkClaw 实例真实响应。

用于排除"widget 解析问题"和"ArkClaw 实例 Agent 问题"。
"""

import json
import logging
import time
import urllib.parse
import uuid as _uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException

from app.core.config import Settings, get_settings
from app.core.security import get_current_session
from app.schemas.auth import SessionInfo
from app.schemas.chat import ChatTokenRequest
from app.services import arkclaw

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/diag", tags=["diag"])


@router.post("/chat-roundtrip", summary="模拟 widget 走完整链路并 dump 所有响应")
def chat_roundtrip(
    req: ChatTokenRequest,
    message: str = "你好，请用一句话介绍你自己",
    timeout_seconds: int = 20,
    user_token_override: Optional[str] = Body(
        default=None,
        description="可选：直接传一个飞书 user_access_token 走链路（dev 模式用），优先级高于 session.lark_token",
    ),
    settings: Settings = Depends(get_settings),
    session: SessionInfo = Depends(get_current_session),
) -> Dict[str, Any]:
    try:
        import websocket
    except ImportError as e:
        raise HTTPException(500, f"backend 缺少 websocket-client: {e}")

    if not settings.ak or not settings.sk:
        raise HTTPException(500, "VOLC AK/SK not configured")

    user_token = user_token_override or session.lark_token
    if not user_token:
        raise HTTPException(
            400,
            "需要 lark user_access_token：要么用飞书登录的 session 调用，"
            "要么在 body 里传 user_token_override（用 demo/web_demo.py 走完飞书 OAuth 后的 token）。",
        )

    instance_id = req.instance_id or settings.arkclaw_default_instance_id
    if not instance_id:
        raise HTTPException(400, "instance_id required")

    chat_token, endpoint = arkclaw.get_chat_token(
        settings.ak, settings.sk, instance_id, settings.arkclaw_region
    )
    ws_url = (
        f"wss://{endpoint}/?chatToken={urllib.parse.quote(chat_token)}"
        f"&clawInstanceId={urllib.parse.quote(instance_id)}"
        f"&token={urllib.parse.quote(user_token)}"
    )

    frames: List[Dict[str, Any]] = []
    handshake_done = False
    chat_received = False

    ws = websocket.create_connection(ws_url, timeout=timeout_seconds)
    try:
        ws.settimeout(2)
        deadline = time.time() + timeout_seconds
        sent_send = False

        while time.time() < deadline:
            try:
                raw = ws.recv()
            except websocket.WebSocketTimeoutException:
                continue
            except Exception as e:
                frames.append({"_recv_err": str(e)})
                break
            if not raw:
                continue
            try:
                data = json.loads(raw)
            except Exception:
                frames.append({"_raw": raw[:500]})
                continue
            frames.append(data)

            t = data.get("type")
            ev = data.get("event")

            if t == "event" and ev == "connect.challenge":
                connect_msg = {
                    "type": "req",
                    "id": str(_uuid.uuid4()),
                    "method": "connect",
                    "params": {
                        "minProtocol": 3,
                        "maxProtocol": 3,
                        "client": {
                            "id": "openclaw-control-ui",
                            "version": "diag",
                            "platform": "backend",
                            "mode": "webchat",
                        },
                        "role": "operator",
                        "scopes": ["operator.admin"],
                        "caps": ["tool-events"],
                        "userAgent": "arkclaw-diag/1.0",
                        "locale": "zh-CN",
                    },
                }
                ws.send(json.dumps(connect_msg))
                continue

            if t in ("res", "resp") and not handshake_done:
                handshake_done = True
                send_msg = {
                    "type": "req",
                    "id": str(_uuid.uuid4()),
                    "method": "chat.send",
                    "params": {
                        "sessionKey": "agent:main:main",
                        "message": message,
                        "deliver": False,
                        "idempotencyKey": str(_uuid.uuid4()),
                    },
                }
                ws.send(json.dumps(send_msg))
                sent_send = True
                continue

            if t == "event" and ev == "chat":
                chat_received = True
                payload = data.get("payload", {})
                # 拿到 final 就退出
                if payload.get("state") == "final" and sent_send:
                    # 再等一小会儿，看是否还有后续帧
                    end_extra = time.time() + 2
                    while time.time() < end_extra:
                        try:
                            r2 = ws.recv()
                            if r2:
                                frames.append(json.loads(r2))
                        except Exception:
                            break
                    break
    finally:
        try:
            ws.close()
        except Exception:
            pass

    chat_events = [f for f in frames if f.get("event") == "chat"]
    diagnosis = _diagnose(frames, chat_events, chat_received, handshake_done)

    return {
        "instance_id": instance_id,
        "endpoint": endpoint,
        "handshake_done": handshake_done,
        "frames_count": len(frames),
        "chat_event_count": len(chat_events),
        "chat_events": chat_events,
        "all_event_types": sorted({f"{f.get('type','?')}/{f.get('event','-')}" for f in frames}),
        "diagnosis": diagnosis,
    }


def _diagnose(
    frames: List[Dict[str, Any]],
    chat_events: List[Dict[str, Any]],
    chat_received: bool,
    handshake_done: bool,
) -> str:
    if not handshake_done:
        return "未完成握手 → 检查 ChatToken / user_access_token 是否过期"
    if not chat_received:
        return "握手成功但收不到任何 chat 事件 → 服务端可能挂了或 sessionKey 错"
    has_message_with_content = any(
        (e.get("payload", {}).get("message", {}).get("content") or [])
        for e in chat_events
    )
    if not has_message_with_content:
        return (
            "Agent 跑完了一次 run 但没生成任何 message.content → "
            "**ArkClaw 实例本身的 Agent 没配模型或模型调用失败**。"
            "请到火山引擎控制台 → ArkClaw → 实例 → 模型设置，确认绑定了可用的 doubao/etc 模型；"
            "或参考 docs/openapi.md 中 update_claw_instance_model.py 脚本批量更新实例模型。"
        )
    return "OK"