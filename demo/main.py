#!/usr/bin/env python3
"""
ArkClaw 消息外接 CLI Demo

通过终端与 ArkClaw 实例进行交互式对话（无需浏览器）。

流程:
  1. 读取环境变量中的火山引擎 AK/SK
  2. 创建/复用 ClawInstance
  3. 轮询等待实例就绪
  4. 获取 ChatToken + Endpoint
  5. WebSocket 连接 + 交互式对话

使用方式:
  python3 main.py --space-id csi-xxx                         # 新建实例
  python3 main.py --space-id csi-xxx --instance-id ci-xxx    # 直接连接已有实例
"""

import argparse
import json
import logging
import os
import sys
import threading
import time
import uuid

import websocket

from arkclaw_api import (
    create_claw_instance,
    get_claw_instance_chat_token,
    get_claw_instance_status,
    wait_instance_ready,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

REGION = "cn-beijing"


# ─── WebSocket 协议消息 ───


def build_connect_message() -> str:
    return json.dumps({
        "type": "req",
        "id": str(uuid.uuid4()),
        "method": "connect",
        "params": {
            "minProtocol": 3,
            "maxProtocol": 3,
            "client": {
                "id": "arkclaw-demo",
                "version": "1.0",
                "platform": "python",
                "mode": "webchat",
            },
            "role": "operator",
            "scopes": ["operator.admin"],
            "caps": ["tool-events"],
            "locale": "zh-CN",
        },
    })


def build_chat_message(text: str) -> str:
    return json.dumps({
        "type": "req",
        "id": str(uuid.uuid4()),
        "method": "chat.send",
        "params": {
            "sessionKey": "agent:main:main",
            "message": text,
            "deliver": False,
            "idempotencyKey": str(uuid.uuid4()),
        },
    })


# ─── WebSocket 回调 ───


def on_message(ws, message):
    try:
        data = json.loads(message)
        msg_type = data.get("type", "")
        method = data.get("method", "")

        if msg_type == "resp":
            logger.info(f"<-- 响应: {json.dumps(data, indent=2, ensure_ascii=False)[:500]}")
        elif msg_type == "evt":
            if method == "chat.message":
                params = data.get("params", {})
                content = params.get("text", "") or params.get("message", "")
                sender = params.get("sender", {}).get("role", "unknown")
                if content:
                    print(f"\n[{sender}]: {content}")
            else:
                logger.debug(f"<-- 事件 [{method}]")
        else:
            logger.info(f"<-- {json.dumps(data, indent=2, ensure_ascii=False)[:500]}")
    except json.JSONDecodeError:
        print(f"\n<-- (原始): {message[:500]}")


def on_error(ws, error):
    logger.error(f"WebSocket 错误: {error}")


def on_close(ws, close_status_code, close_msg):
    logger.info(f"WebSocket 关闭 (code={close_status_code}, msg={close_msg})")


def on_open(ws):
    logger.info("WebSocket 已连接，发送握手消息...")
    ws.send(build_connect_message())
    logger.info("握手消息已发送")


def interactive_chat(ws):
    print("\n" + "=" * 50)
    print("  ArkClaw 交互式对话")
    print("  输入消息后按回车发送，输入 quit 退出")
    print("=" * 50 + "\n")

    while True:
        try:
            user_input = input("你: ").strip()
            if not user_input:
                continue
            if user_input.lower() in ("quit", "exit", "q"):
                logger.info("用户退出对话")
                ws.close()
                break
            ws.send(build_chat_message(user_input))
        except (EOFError, KeyboardInterrupt):
            print()
            logger.info("对话结束")
            ws.close()
            break


# ─── 主流程 ───


def main():
    parser = argparse.ArgumentParser(
        description="ArkClaw 消息外接 CLI Demo"
    )
    parser.add_argument("--space-id", required=True,
                        help="ClawSpace ID (格式: csi-xxx)")
    parser.add_argument("--instance-id",
                        help="已有实例 ID，跳过创建直接连接 (格式: ci-xxx)")
    parser.add_argument("--spec", default="Starter",
                        choices=["Starter", "Standard", "Premium", "Ultimate"],
                        help="实例规格 (默认: Starter)")
    args = parser.parse_args()

    # ── 1. 读取字节 AK/SK ──
    ak = os.getenv("VOLC_ACCESS_KEY_ID", "") or os.getenv("VOLC_2_ACCESS_KEY_ID", "")
    sk = os.getenv("VOLC_SECRET_ACCESS_KEY", "") or os.getenv("VOLC_2_SECRET_ACCESS_KEY", "")
    if not ak or not sk:
        logger.error(
            "未找到火山引擎 AK/SK 环境变量，请设置:\n"
            "  VOLC_ACCESS_KEY_ID / VOLC_SECRET_ACCESS_KEY"
        )
        sys.exit(1)
    logger.info(f"已加载 AK/SK (region={REGION})")

    step = 1
    total = 4 if not args.instance_id else 2

    # ── 2. 创建或复用实例 ──
    if args.instance_id:
        instance_id = args.instance_id
        logger.info(f"使用已有实例: {instance_id}")
        status = get_claw_instance_status(ak, sk, instance_id, region=REGION)
        if status != "Running":
            logger.info(f"实例状态为 {status}，等待就绪...")
            wait_instance_ready(ak, sk, instance_id, region=REGION)
    else:
        logger.info("=" * 40)
        logger.info(f"步骤 {step}/{total}: 创建 ClawInstance")
        instance_id = create_claw_instance(
            ak, sk, args.space_id, spec=args.spec, region=REGION
        )
        step += 1

        # ── 3. 等待就绪 ──
        logger.info("=" * 40)
        logger.info(f"步骤 {step}/{total}: 等待实例就绪 (每5秒轮询)")
        wait_instance_ready(ak, sk, instance_id, region=REGION)
        step += 1

    # ── 4. 获取聊天凭证 ──
    logger.info("=" * 40)
    logger.info(f"步骤 {step}/{total}: 获取聊天凭证")
    chat_token, endpoint = get_claw_instance_chat_token(
        ak, sk, instance_id, region=REGION
    )
    step += 1

    # ── 5. WebSocket 连接 ──
    logger.info("=" * 40)
    logger.info(f"步骤 {step}/{total}: 建立 WebSocket 连接")
    ws_url = f"wss://{endpoint}/?chatToken={chat_token}&clawInstanceId={instance_id}"
    logger.info(f"目标: wss://{endpoint}/?chatToken=***&clawInstanceId={instance_id}")

    ws = websocket.WebSocketApp(
        ws_url,
        on_open=on_open,
        on_message=on_message,
        on_error=on_error,
        on_close=on_close,
    )

    wst = threading.Thread(target=ws.run_forever, daemon=True)
    wst.start()
    time.sleep(2)

    interactive_chat(ws)


if __name__ == "__main__":
    main()
