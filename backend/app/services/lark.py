"""飞书 OAuth 客户端封装。"""

import json
import logging
import urllib.parse
import urllib.request
from typing import Any, Dict

logger = logging.getLogger(__name__)


def get_app_access_token(app_id: str, app_secret: str) -> str:
    """获取应用级 access_token。"""
    data = json.dumps({"app_id": app_id, "app_secret": app_secret}).encode()
    req = urllib.request.Request(
        "https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal",
        data=data,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        result = json.loads(resp.read())
    return result["app_access_token"]


def build_authorize_url(app_id: str, redirect_uri: str, state: str = "") -> str:
    """构建飞书 OAuth 授权 URL。"""
    params = {
        "client_id": app_id,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "state": state or "arkclaw_widget",
    }
    qs = urllib.parse.urlencode(params, safe=":/")
    return f"https://accounts.feishu.cn/open-apis/authen/v1/authorize?{qs}"


def exchange_code_v2(app_id: str, app_secret: str, code: str, redirect_uri: str) -> Dict[str, Any]:
    """v2 接口换取 user_access_token。"""
    data = json.dumps({
        "grant_type": "authorization_code",
        "client_id": app_id,
        "client_secret": app_secret,
        "code": code,
        "redirect_uri": redirect_uri,
    }).encode()
    req = urllib.request.Request(
        "https://open.feishu.cn/open-apis/authen/v2/oauth/token",
        data=data,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        logger.error("v2 exchange failed (%s): %s", e.code, body)
        return {"error": body, "code": e.code}


def exchange_code_v1(app_access_token: str, code: str) -> Dict[str, Any]:
    """v1 接口换取 user_access_token (兜底)。"""
    data = json.dumps({"grant_type": "authorization_code", "code": code}).encode()
    req = urllib.request.Request(
        "https://open.feishu.cn/open-apis/authen/v1/oidc/access_token",
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {app_access_token}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        logger.error("v1 exchange failed (%s): %s", e.code, body)
        return {"error": body, "code": e.code}


def exchange_code(
    app_id: str, app_secret: str, code: str, redirect_uri: str
) -> Dict[str, Any]:
    """先 v2 再 v1。"""
    result = exchange_code_v2(app_id, app_secret, code, redirect_uri)
    user_token = result.get("access_token", "")
    if user_token:
        return {
            "access_token": user_token,
            "name": result.get("name", "") or "已授权用户",
            "raw": result,
        }
    app_token = get_app_access_token(app_id, app_secret)
    result_v1 = exchange_code_v1(app_token, code)
    data = result_v1.get("data", {})
    user_token = data.get("access_token", "")
    return {
        "access_token": user_token,
        "name": data.get("name", "") or "已授权用户",
        "raw": result_v1,
    }
