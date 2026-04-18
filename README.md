# ArkClaw OpenAPI Demo

ArkClaw 消息外接（WebSocket 对话）的完整 Demo，支持终端 CLI 和浏览器 Web 两种交互方式。

## 功能

- **CLI Demo** (`main.py`)：终端交互式对话，适合快速验证和调试
- **Web Demo** (`web_demo.py`)：浏览器对话界面，支持飞书 OAuth 登录、AI 思考过程展示、图片预览

## 前置条件

1. **火山引擎账号**：获取 Access Key ID 和 Secret Access Key
2. **ArkClaw Space**：在 ArkClaw 企业版 Admin 控制台创建 ClawSpace，获取 SpaceId
3. **飞书应用**（仅 Web Demo 需要）：在飞书开发者后台创建应用，获取 App ID 和 App Secret，并配置重定向 URL

## 快速开始

### 1. 安装依赖

```bash
cd demo
pip install -r requirements.txt
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 填入实际凭证，然后 source
```

或直接 export：

```bash
export VOLC_ACCESS_KEY_ID="your-ak"
export VOLC_SECRET_ACCESS_KEY="your-sk"
export LARK_APP_ID="cli_xxxxx"        # Web Demo 需要
export LARK_APP_SECRET="xxxxx"        # Web Demo 需要
```

### 3. 运行

**CLI Demo**（终端对话）：

```bash
# 使用已有实例
python3 demo/main.py --space-id csi-xxx --instance-id ci-xxx

# 创建新实例
python3 demo/main.py --space-id csi-xxx
```

**Web Demo**（浏览器对话）：

```bash
# 使用已有实例
python3 demo/web_demo.py --instance-id ci-xxx

# 创建新实例
python3 demo/web_demo.py --space-id csi-xxx
```

浏览器会自动打开 `http://127.0.0.1:8765`，点击飞书登录后即可开始对话。

## 项目结构

```
demo/
├── arkclaw_api.py      # ArkClaw OpenAPI 接口封装
├── volc_sign.py        # 火山引擎 V4 签名实现
├── main.py             # CLI 交互式对话入口
├── web_demo.py         # Web 浏览器对话入口（含飞书 OAuth）
└── requirements.txt    # Python 依赖
```

## 消息外接流程

```
创建实例 → 等待就绪 → 获取 ChatToken → WebSocket 连接 → 对话
```

1. 调用 `CreateClawInstance` 创建实例
2. 轮询 `GetClawInstance` 等待状态变为 `Running`
3. 调用 `GetClawInstanceChatToken` 获取 ChatToken 和 Endpoint
4. 建立 WebSocket 连接：`wss://{Endpoint}/?chatToken={ChatToken}&clawInstanceId={Id}`
5. 发送 `connect` 握手，开始收发消息
