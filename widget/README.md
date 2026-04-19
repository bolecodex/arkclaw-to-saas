# @arkclaw/widget

可嵌入任意 SaaS 工具的 ArkClaw AI 对话 Widget。

```bash
npm install @arkclaw/widget
```

```ts
import { Arkclaw } from '@arkclaw/widget';

const claw = new Arkclaw({
  endpoint: 'https://your-backend.com',
  auth: { type: 'jwt', token: '<SaaS JWT>' },
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

## 开发

```bash
npm install
npm run dev          # 开发服务器：http://127.0.0.1:5173
npm run build        # 输出 dist/arkclaw-widget.{es,umd}.js
npm run type-check
```

完整文档见 [项目根 README](../README.md)。
