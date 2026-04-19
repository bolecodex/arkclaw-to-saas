# @arkclaw/widget

可嵌入任意 SaaS 工具的 ArkClaw AI 对话 Widget。AI 不仅能回答问题，还能直接操作宿主页面（填表、点按钮、高亮等）。

```bash
npm install @arkclaw/widget
```

## 最小接入

```ts
import { Arkclaw } from '@arkclaw/widget';

const claw = new Arkclaw({
  endpoint: 'https://your-backend.com',
  auth: { type: 'lark' },
  ui: { mode: 'side-drawer', defaultOpen: false, theme: 'auto' },
  context: { captureClicks: true, captureSelection: true },
  actions: {
    fillForm: ({ field, value }) => {
      const el = document.querySelector(`[name="${field}"]`);
      if (el) el.value = value;
      return { ok: !!el };
    },
  },
});
claw.mount();
```

## AI 怎么知道你的页面有什么字段？

Widget 在挂载时会自动扫描宿主页面所有的 `input/select/textarea/button`，把它们的 `name`、`label`、`type`、`options` 推送给 AI（通过 `HOST_INFO` 消息）。AI 第一次收到用户提问时，会拿到完整的「页面字段清单 + 你注册的 actions 列表 + 调用规则」作为系统提示。

所以你 **不需要** 自己写 prompt 告诉 AI"页面有哪些字段"——只要：

1. 给 input 加上有意义的 `name` 属性（或 `<label for="id">` 关联）
2. 在 `actions` 里注册 `fillForm` / `clickButton` 等动作
3. AI 会按 `<arkclaw:action name="fillForm">{"field":"title","value":"4月差旅"}</arkclaw:action>` 的格式输出，widget 自动解析并调用你的 action

如果页面是 SPA 切了路由后字段变了，调 `claw.refreshHostInfo()` 让 widget 重扫并推送。

## 受控组件 vs 非受控组件

**这是接入时最容易踩的坑**：

### 非受控组件（原生 HTML / jQuery / Alpine 等）

直接操作 DOM 即可，但要触发多种事件覆盖各种监听：

```ts
fillForm: ({ field, value }) => {
  let el = document.querySelector(`[name="${CSS.escape(field)}"]`);
  if (!el) el = document.getElementById(field);
  if (!el) return { ok: false, reason: 'field not found' };
  el.focus();
  if (el.tagName === 'SELECT') el.value = value;
  else if (el.type === 'checkbox' || el.type === 'radio') el.checked = !!value;
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.blur();
  return { ok: true, value: el.value };
}
```

参考 `examples/vanilla-html/`、`examples/nextjs/`。

### 受控组件（React `value={state}`、Vue v-model）

**dispatchEvent 无效**——React 已经接管了 input value，只有 `setState` 能让组件重渲染：

```tsx
const [form, setForm] = useState({ title: '', amount: '' });

const claw = useArkclaw({
  // ...
  actions: {
    fillForm: ({ field, value }) => {
      setForm(prev => ({ ...prev, [field]: String(value) }));
      return { ok: true };
    },
  },
});
```

参考 `examples/react-app/`，里面有完整的 select / textarea / checkbox / radio 受控示例。

## 调试：看 AI 到底调了什么 action

抽屉里输入框上方有「已执行动作」折叠面板（有调用时自动出现），列出每个 action 的：

- 动作名 + 参数
- `✓ ok` / `✗ error` / `…` 三种状态
- 你 action 函数的返回值
- 时间戳

这样不用再去 console 翻日志就能看到："AI 是不是发了 action？参数对不对？我的 fillForm 是不是返回了错误？"

## 离线回归测试

```bash
docker run --rm -v $PWD:/w -w /w node:20-alpine node scripts/verify-action-pipeline.mjs
```

覆盖 6 个场景：标准 XML 标签、markdown json 块、JSON 数组、OpenAI tool_call、闲聊不误触发、流式半成品不误触发。

## 开发

```bash
npm install
npm run dev          # 开发服务器：http://127.0.0.1:5173
npm run build        # 输出 dist/arkclaw-widget.{es,umd}.js
npm run type-check
```

完整接入文档见 [项目根 README](../README.md)。
