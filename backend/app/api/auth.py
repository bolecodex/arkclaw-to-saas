"""认证路由：飞书 OAuth + SaaS JWT。"""

import json
import logging
import urllib.parse

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse, RedirectResponse

from app.core.config import Settings, get_settings
from app.schemas.auth import LoginResponse, SaasLoginRequest
from app.services import lark
from app.services.jwt_service import issue_session_jwt, verify_saas_jwt

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/lark/login", summary="跳转飞书授权页")
def lark_login(
    redirect_to: str = Query(default="/", description="授权完成后前端跳转地址"),
    settings: Settings = Depends(get_settings),
):
    if not settings.lark_app_id or not settings.lark_app_secret:
        raise HTTPException(500, "LARK_APP_ID / LARK_APP_SECRET not configured")
    state = urllib.parse.quote(redirect_to)
    url = lark.build_authorize_url(
        settings.lark_app_id, settings.lark_redirect_uri, state=state
    )
    return RedirectResponse(url)


@router.get("/lark/callback", summary="飞书 OAuth 回调")
def lark_callback(
    code: str = Query(default=""),
    state: str = Query(default="/"),
    error: str = Query(default=""),
    settings: Settings = Depends(get_settings),
):
    if error:
        return HTMLResponse(_error_html("授权被拒绝", error), status_code=400)
    if not code:
        return HTMLResponse(_error_html("缺少授权码", "callback missing code"), status_code=400)

    result = lark.exchange_code(
        settings.lark_app_id, settings.lark_app_secret, code, settings.lark_redirect_uri
    )
    user_token = result.get("access_token", "")
    if not user_token:
        return HTMLResponse(
            _error_html("换取 token 失败", str(result.get("raw"))[:300]),
            status_code=400,
        )

    user_name = result.get("name", "已授权用户")
    session_token = issue_session_jwt(
        secret=settings.session_jwt_secret,
        subject=f"lark:{user_token[:8]}",
        extra={"name": user_name, "src": "lark", "lark_token": user_token},
        ttl_seconds=settings.session_jwt_ttl_seconds,
    )

    redirect_to = urllib.parse.unquote(state) or ""
    # 弹窗模式：postMessage 给 opener 然后自关；普通模式：带参跳回
    return HTMLResponse(_callback_html(session_token, user_name, redirect_to))


@router.post("/dev/session", response_model=LoginResponse, summary="开发模式：直接签发 session（受 DEV_SESSION_ENABLED 控制）")
def dev_session(settings: Settings = Depends(get_settings)):
    """无需 OAuth，签发一个 demo session，方便本地联调。
    通过设置 DEV_SESSION_ENABLED=false 在生产环境禁用。
    """
    if not settings.dev_session_enabled:
        raise HTTPException(403, "dev session disabled (set DEV_SESSION_ENABLED=true to allow)")
    session_token = issue_session_jwt(
        secret=settings.session_jwt_secret,
        subject="dev:demo",
        extra={"name": "Demo User", "src": "dev"},
        ttl_seconds=settings.session_jwt_ttl_seconds,
    )
    return LoginResponse(
        session_token=session_token,
        user_name="Demo User",
        user_id="dev:demo",
        expires_in=settings.session_jwt_ttl_seconds,
    )


@router.post("/saas/verify", response_model=LoginResponse, summary="校验 SaaS JWT 并签发 session")
def saas_verify(req: SaasLoginRequest, settings: Settings = Depends(get_settings)):
    if not settings.saas_jwt_secret and not settings.saas_jwt_public_key:
        raise HTTPException(500, "SaaS JWT verification not configured")
    try:
        payload = verify_saas_jwt(
            req.saas_token,
            secret=settings.saas_jwt_secret,
            public_key=settings.saas_jwt_public_key,
            algorithm=settings.saas_jwt_algorithm,
            issuer=settings.saas_jwt_issuer,
            audience=settings.saas_jwt_audience,
        )
    except ValueError as e:
        raise HTTPException(401, str(e)) from e

    user_id = str(payload.get("sub", "")) or "saas-user"
    user_name = payload.get("name", "") or payload.get("preferred_username", "")
    session_token = issue_session_jwt(
        secret=settings.session_jwt_secret,
        subject=f"saas:{user_id}",
        extra={"name": user_name, "src": "saas", "saas_payload": payload},
        ttl_seconds=settings.session_jwt_ttl_seconds,
    )
    return LoginResponse(
        session_token=session_token,
        user_name=user_name,
        user_id=user_id,
        expires_in=settings.session_jwt_ttl_seconds,
    )


def _callback_html(session_token: str, user_name: str, redirect_to: str) -> str:
    """OAuth 回调页：
    - 如果是弹窗（有 window.opener）：postMessage 通知 opener 后自关闭
    - 否则：直接跳回 redirect_to 并带 session token
    """
    payload = json.dumps({
        "type": "arkclaw:lark-success",
        "session_token": session_token,
        "user_name": user_name,
    })
    safe_redirect = json.dumps(redirect_to or "/")
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>登录成功</title>
<style>body{{font-family:-apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;
height:100vh;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#fff;margin:0}}
.card{{background:rgba(255,255,255,.1);backdrop-filter:blur(10px);padding:32px 48px;border-radius:16px;text-align:center;max-width:420px}}
.tick{{font-size:48px;margin-bottom:12px}}
h2{{margin:8px 0}}p{{opacity:.85;font-size:14px;margin:6px 0}}
.spinner{{width:24px;height:24px;border:3px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;
animation:spin 1s linear infinite;margin:16px auto 0}}
@keyframes spin{{to{{transform:rotate(360deg)}}}}</style>
</head><body><div class="card">
<div class="tick">✓</div>
<h2>登录成功</h2>
<p>欢迎回来，<b>{user_name}</b></p>
<p id="msg">正在返回应用…</p>
<div class="spinner"></div>
</div>
<script>
(function() {{
  var data = {payload};
  var redirect = {safe_redirect};
  try {{
    if (window.opener && !window.opener.closed) {{
      window.opener.postMessage(data, '*');
      document.getElementById('msg').textContent = '可以关闭此窗口了';
      setTimeout(function(){{ try{{window.close();}}catch(e){{}} }}, 600);
      return;
    }}
  }} catch(e) {{}}
  // 不是弹窗：跳回 redirect_to，带 session
  if (redirect && redirect !== '/' && redirect !== 'about:srcdoc') {{
    var sep = redirect.indexOf('?') > -1 ? '&' : '?';
    location.replace(redirect + sep + 'arkclaw_session=' + encodeURIComponent(data.session_token));
  }} else {{
    document.getElementById('msg').textContent = '已登录，可关闭本页';
  }}
}})();
</script>
</body></html>"""


def _error_html(title: str, detail: str) -> str:
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>{title}</title>
<style>body{{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#f0f2f5}}
.box{{background:#fff;padding:32px;border-radius:12px;max-width:520px;box-shadow:0 4px 20px rgba(0,0,0,.08)}}
h2{{color:#e74c3c;margin:0 0 12px}}pre{{background:#f7f7f7;padding:12px;border-radius:6px;font-size:12px;overflow:auto;max-height:200px}}</style>
</head><body><div class="box"><h2>{title}</h2><pre>{detail}</pre></div></body></html>"""
