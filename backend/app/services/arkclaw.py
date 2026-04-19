"""ArkClaw OpenAPI 业务封装。"""

import logging
import time
from typing import Optional, Tuple

from app.services.volc_sign import volc_request

logger = logging.getLogger(__name__)

VERSION = "2026-03-01"
SERVICE = "arkclaw"


def _make_host(region: str) -> str:
    return f"arkclaw.{region}.volcengineapi.com"


def _call(action: str, body: dict, ak: str, sk: str, region: str) -> dict:
    host = _make_host(region)
    logger.info("call %s region=%s", action, region)
    resp = volc_request(
        action=action,
        body=body,
        ak=ak,
        sk=sk,
        service=SERVICE,
        version=VERSION,
        region=region,
        host=host,
    )
    err = resp.get("ResponseMetadata", {}).get("Error")
    if err:
        raise RuntimeError(f"{action} failed: [{err.get('Code')}] {err.get('Message')}")
    return resp


def create_instance(
    ak: str, sk: str, space_id: str, name: str = "demo", spec: str = "Starter", region: str = "cn-beijing"
) -> str:
    body = {
        "Spec": spec,
        "Name": name,
        "Description": "ArkClaw SaaS Widget instance",
        "ProjectName": "default",
        "SpaceId": space_id,
    }
    resp = _call("CreateClawInstance", body, ak, sk, region)
    instance_id = resp.get("Result", {}).get("ClawInstanceId", "")
    if not instance_id:
        raise RuntimeError(f"CreateClawInstance returned no ClawInstanceId: {resp}")
    return instance_id


def get_instance_status(ak: str, sk: str, instance_id: str, region: str = "cn-beijing") -> str:
    body = {"ClawInstanceId": instance_id, "ProjectName": "default"}
    resp = _call("GetClawInstance", body, ak, sk, region)
    return resp.get("Result", {}).get("ClawInstance", {}).get("Status", "").strip()


def wait_ready(
    ak: str, sk: str, instance_id: str, region: str = "cn-beijing",
    interval: int = 5, timeout: int = 300,
) -> None:
    elapsed = 0
    status = ""
    while elapsed < timeout:
        status = get_instance_status(ak, sk, instance_id, region=region)
        if status == "Running":
            return
        time.sleep(interval)
        elapsed += interval
    raise TimeoutError(f"instance {instance_id} not ready after {timeout}s, last={status}")


def get_chat_token(
    ak: str, sk: str, instance_id: str, region: str = "cn-beijing"
) -> Tuple[str, str]:
    """返回 (chat_token, endpoint)。"""
    body = {"ClawInstanceId": instance_id, "ProjectName": "default"}
    resp = _call("GetClawInstanceChatToken", body, ak, sk, region)
    result = resp.get("Result", {})
    chat_token = result.get("ChatToken", "").strip()
    endpoint = result.get("Endpoint", "").strip()
    if not chat_token or not endpoint:
        raise RuntimeError(f"GetClawInstanceChatToken returned empty creds: {resp}")
    return chat_token, endpoint


def list_instances(ak: str, sk: str, space_id: str, region: str = "cn-beijing") -> list:
    body = {"ProjectName": "default", "SpaceId": space_id, "PageNumber": 1, "PageSize": 20}
    resp = _call("ListClawInstances", body, ak, sk, region)
    items = resp.get("Result", {}).get("ClawInstances", []) or resp.get("Result", {}).get("Items", [])
    return items or []
