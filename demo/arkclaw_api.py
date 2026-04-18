"""
ArkClaw OpenAPI 接口封装

封装创建实例、查询实例状态、获取聊天凭证等接口。
注: ClawSpace 需在控制台手动创建，不提供 OpenAPI。
"""

import json
import logging
import time

from volc_sign import volc_request

logger = logging.getLogger(__name__)

VERSION = "2026-03-01"
SERVICE = "arkclaw"


def _make_host(region: str) -> str:
    return f"arkclaw.{region}.volcengineapi.com"


def _call_api(action: str, body: dict, ak: str, sk: str, region: str = "cn-shanghai") -> dict:
    """统一调用入口，打印请求/响应日志。"""
    host = _make_host(region)
    logger.info(f"调用 {action} (region={region}) ...")
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
    logger.debug(f"{action} 响应:\n{json.dumps(resp, indent=2, ensure_ascii=False)}")

    if "ResponseMetadata" in resp:
        error = resp["ResponseMetadata"].get("Error")
        if error:
            raise RuntimeError(
                f"{action} 失败: [{error.get('Code')}] {error.get('Message')}"
            )
    return resp


def create_claw_instance(
    ak: str,
    sk: str,
    space_id: str,
    name: str = "demo-instance",
    spec: str = "Starter",
    region: str = "cn-shanghai",
) -> str:
    """
    创建 Claw 实例，返回 ClawInstanceId。

    Spec 可选值: Starter(轻量版), Standard(标准版), Premium(高级版), Ultimate(旗舰版)
    """
    body = {
        "Spec": spec,
        "Name": name,
        "Description": "ArkClaw Demo Instance",
        "ProjectName": "default",
        "SpaceId": space_id,
    }
    resp = _call_api("CreateClawInstance", body, ak, sk, region=region)
    instance_id = resp.get("Result", {}).get("ClawInstanceId", "")
    if not instance_id:
        raise RuntimeError(f"CreateClawInstance 未返回 ClawInstanceId: {resp}")
    logger.info(f"实例创建成功: {instance_id}")
    return instance_id


def get_claw_instance_status(ak: str, sk: str, instance_id: str, region: str = "cn-shanghai") -> str:
    """查询 Claw 实例状态，返回状态字符串（如 Creating / Running / Stopped）。"""
    body = {
        "ClawInstanceId": instance_id,
        "ProjectName": "default",
    }
    resp = _call_api("GetClawInstance", body, ak, sk, region=region)
    status = (
        resp.get("Result", {})
        .get("ClawInstance", {})
        .get("Status", "")
        .strip()
    )
    return status


def wait_instance_ready(
    ak: str,
    sk: str,
    instance_id: str,
    interval: int = 5,
    timeout: int = 300,
    region: str = "cn-shanghai",
) -> None:
    """
    轮询等待实例状态变为 Running。

    Args:
        interval: 轮询间隔（秒）
        timeout: 最大等待时间（秒）
    """
    elapsed = 0
    while elapsed < timeout:
        status = get_claw_instance_status(ak, sk, instance_id, region=region)
        if status == "Running":
            logger.info("实例已就绪 (Running)")
            return
        logger.info(f"当前状态: {status}，等待 {interval} 秒后重试...")
        time.sleep(interval)
        elapsed += interval
    raise TimeoutError(
        f"等待 {timeout} 秒后实例 {instance_id} 仍未就绪，最后状态: {status}"
    )


def get_claw_instance_chat_token(
    ak: str, sk: str, instance_id: str, region: str = "cn-shanghai"
) -> tuple:
    """
    获取 Claw 实例的聊天凭证。

    Returns:
        (chat_token, endpoint) 元组
    """
    body = {
        "ClawInstanceId": instance_id,
        "ProjectName": "default",
    }
    resp = _call_api("GetClawInstanceChatToken", body, ak, sk, region=region)
    result = resp.get("Result", {})
    chat_token = result.get("ChatToken", "").strip()
    endpoint = result.get("Endpoint", "").strip()
    if not chat_token or not endpoint:
        raise RuntimeError(
            f"GetClawInstanceChatToken 未返回有效凭证: {resp}"
        )
    logger.info(f"聊天凭证获取成功 (Endpoint: {endpoint})")
    return chat_token, endpoint
