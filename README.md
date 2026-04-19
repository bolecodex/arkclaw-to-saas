# ArkClaw → SaaS Widget

把 ArkClaw 智能体封装成可嵌入任意 SaaS 工具的对话 Widget。用户既能在抽屉里和 AI 自然语言对话，也能让 AI 反向控制宿主页面（填表、点击、跳转、高亮）。

> **Copilot 风格**：不只是 chatbot，更是 SaaS 内嵌的 AI 协作伙伴。

## 项目架构

```
arkclaw-to-saas/
├── backend/                # FastAPI 后端：飞书 OAuth + SaaS JWT 双认证 + ChatToken 签发
│   ├── app/
│   │   ├── main.py         # FastAPI 入口
│   │   ├── api/            # auth.py / chat.py / instances.py
│   │   ├── services/       # arkclaw / lark / jwt / volc_sign
│   │   ├── core/           # 配置、安全
│   │   └── schemas/        # Pydantic 模型
│   ├── Dockerfile
│   └── requirements.txt
│
├── widget/                 # 前端 Widget：React + Vite + TypeScript
│   ├── src/
│   │   ├── components/     # ChatPanel / MessageList / InputBar / SelectionToolbar / ...
│   │   ├── hooks/          # useWebSocket / useHostBridge
│   │   ├── sdk/            # Arkclaw 主类 + HostBridge + utils
│   │   ├── store/          # Zustand chat 状态
│   │   ├── api/            # 后端 REST 客户端
│   │   └── styles/         # 主题 CSS variables
│   ├── examples/
│   │   ├── vanilla-html/   # <script> 引入接入示例
│   │   ├── react-app/      # React + Vite 接入
│   │   └── nextjs/         # Next.js (App Router) 接入
│   └── Dockerfile          # 用 nginx 托管 dist + examples
│
├── demo/                   # 旧的 CLI/HTML demo（保留作参考）
├── docker-compose.yml      # 一键启动 backend + widget
└── .env.example
```

```mermaid
flowchart LR
    subgraph host[SaaS 宿主页面]
        ui[页面 UI]
        sdk[Arkclaw SDK]
    end
    subgraph widget[Widget Iframe]
        chat[ChatPanel]
        bridge[Host Bridge]
    end
    subgraph backend[FastAPI 后端]
        auth[/auth: 飞书OAuth / SaaS JWT/]
        chat_token[/chat/token 签发/]
        instances[/instances 代理/]
    end
    arkclaw[ArkClaw OpenAPI + WSS]

    ui -- click/select --> sdk
    sdk <-- postMessage --> bridge
    bridge --> chat
    chat -- REST --> backend
    chat -. WSS .-> arkclaw
    backend -- V4 签名 --> arkclaw
```

## 核心能力

| 能力 | 描述 |
|------|------|
| 自然语言对话 | 流式回复 + 思考过程展示 + 媒体预览 |
| 上下文捕获 | 用户点击宿主元素 / 划词，自动作为上下文推送给 AI |
| 划词工具栏 | 在 widget 内对消息划词，弹出 "问 AI / 总结 / 翻译" |
| AI 反向操作 | AI 可调用宿主注册的 actions（填表、点击、跳转） |
| 高亮回示 | AI 提到的元素可通过 `<arkclaw:action name="highlight">` 自动高亮+滚动 |
| 双认证 | 飞书 OAuth（内部）+ SaaS JWT（外部 SaaS 集成） |
| 样式隔离 | iframe 模式天然隔离；inline 模式用 Shadow DOM 隔离 |
| 单文件分发 | Vite lib mode 输出 UMD bundle，`<script>` 即可引入 |

## 快速开始

### 1. 准备环境变量

```bash
cp .env.example .env
# 编辑 .env，填入 VOLC_ACCESS_KEY_ID / SECRET / SPACE_ID / LARK_APP_ID 等
```

### 2. 一键启动（推荐）

需要 Docker：

```bash
docker compose up --build
```

- 后端：http://127.0.0.1:8000 （Swagger: `/docs`）
- Widget 演示：http://127.0.0.1:8080

### 3. 本地开发模式

后端：

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

前端 Widget：

```bash
cd widget
npm install
npm run dev          # 开发模式（http://127.0.0.1:5173）
npm run build        # 输出 dist/arkclaw-widget.umd.js
```

集成示例：

```bash
cd widget/examples/vanilla-html && python3 -m http.server 5500
cd widget/examples/react-app && npm install && npm run dev
cd widget/examples/nextjs && npm install && npm run dev
```

## SaaS 集成方式

### 方式 1：UMD Script（最简）

```html
<script src="https://your-cdn/arkclaw-widget.umd.js"></script>
<script>
  const claw = new window.Arkclaw.Arkclaw({
    endpoint: 'https://your-backend.com',
    auth: { type: 'jwt', token: '<SaaS 签发的 JWT>' },
    ui: { mode: 'side-drawer', defaultOpen: false },
    context: { captureClicks: true, captureSelection: true },
    actions: {
      fillForm: ({ field, value }) => { /* 你的表单逻辑 */ },
      navigate: ({ url }) => location.assign(url),
    },
  });
  claw.mount();
</script>
```

### 方式 2：NPM 包（React/Vue/Next）

```bash
npm install @arkclaw/widget
```

```ts
import { Arkclaw } from '@arkclaw/widget';

const claw = new Arkclaw({ /* 同上 */ });
claw.mount();
claw.send('总结当前页面');
claw.on('action', console.log);
```

详细示例见 [`widget/examples/`](widget/examples/)。

## SDK API 概览

```ts
class Arkclaw {
  constructor(opts: ArkclawOptions);

  mount(target?: HTMLElement | string): void;   // 默认 document.body
  unmount(): void;
  open(): void;
  close(): void;
  toggle(): void;
  send(text: string, meta?: object): Promise<void>;

  registerAction(name: string, handler: ActionHandler): void;
  unregisterAction(name: string): void;
  pushContext(opts: { trigger?, element?, selection?, extra? }): void;

  on('message' | 'open' | 'close' | 'action' | 'highlight' | 'state-change' | 'error', fn): () => void;
}
```

完整类型定义在 [`widget/src/sdk/types.ts`](widget/src/sdk/types.ts)。

## 双向通信协议

宿主 SDK 与 Widget 之间通过 `postMessage` 通信，所有消息都带 `__arkclaw__: true` 信封。

| 方向 | 类型 | 用途 |
|------|------|------|
| Host → Widget | `OPEN` / `CLOSE` / `TOGGLE` | 控制面板开合 |
| Host → Widget | `SEND` | 主动发问 |
| Host → Widget | `HOST_CONTEXT` | 推送页面上下文（点击/划词） |
| Host → Widget | `ACTION_RESULT` | 回传 AI 调用动作的执行结果 |
| Widget → Host | `READY` / `STATE` | 就绪和状态广播 |
| Widget → Host | `MESSAGE` | 用户/AI 消息广播（埋点用） |
| Widget → Host | `AI_ACTION` | AI 请求宿主执行动作 |
| Widget → Host | `HIGHLIGHT` | 高亮某个 selector |
| Widget → Host | `NEED_AUTH` | 需要重新授权 |

详见 [`widget/src/sdk/types.ts`](widget/src/sdk/types.ts) 的 `BridgeFromHost` / `BridgeFromWidget`。

## AI Action 协议

让 AI 触发宿主动作有两种方式：

1. **AI 工具调用**：ArkClaw 协议中的 `tool_call` 自动转发到宿主注册的 handler。
2. **结构化标签**：AI 在文本里写 `<arkclaw:action name="fillForm">{"field":"amount","value":100}</arkclaw:action>`，widget 解析后调用 handler。

宿主端注册：

```ts
new Arkclaw({
  actions: {
    fillForm: async ({ field, value }) => {
      document.querySelector(`[name="${field}"]`).value = value;
      return { ok: true };
    },
  },
});
```

执行结果会通过 `ACTION_RESULT` 回传给 widget，再由 widget 把结果作为系统消息发回 AI，形成闭环。

## 安全考虑

1. **AK/SK 不下发前端**：后端用 V4 签名调用 ArkClaw OpenAPI，只把 `ChatToken + ws_url` 给前端。
2. **Session JWT TTL 较短**：默认 24h，过期需重新走 OAuth/SaaS 验证。
3. **CORS 严格控制**：生产环境 `CORS_ORIGINS` 不要用 `*`，写死 SaaS 域名。
4. **postMessage origin 校验**：`HostBridge` 默认接受所有 origin（方便开发），生产建议传具体 origin。
5. **Action 白名单**：只暴露安全的 SaaS 操作，不要把 `eval`、任意 fetch 等危险能力暴露给 AI。
6. **划词/点击采集 selectorsBlacklist**：屏蔽密码框等敏感字段。

## 开发路线图

- [ ] 多实例选择器（用户在多个 ClawInstance 之间切换）
- [ ] 消息持久化（IndexedDB / 后端 history API）
- [ ] 文件上传（图片/PDF）
- [ ] 主题市场（自定义 CSS variables 集合）
- [ ] 国际化（i18n）

## 旧版 demo

`demo/` 目录保留了原始的纯 Python + HTML 演示，作为协议参考与最小可运行原型：

- `demo/main.py`：CLI 交互式聊天（用于快速验证后端凭证）
- `demo/web_demo.py`：旧的单文件 HTTP/HTML 演示

新项目以 `backend/` + `widget/` 为准。

## License

MIT
