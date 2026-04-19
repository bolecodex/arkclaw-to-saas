# Vanilla HTML 接入示例

最简集成：在任意 HTML 页面引入 UMD bundle，几行代码就能让 ArkClaw 助手出现在右侧抽屉里。

## 运行

```bash
# 在 widget 目录构建一次
cd widget && npm install && npm run build

# 启动后端
cd ../backend && uvicorn app.main:app --reload --port 8000

# 用任意静态服务托管这个 example
cd widget/examples/vanilla-html
python3 -m http.server 5500
```

打开 http://127.0.0.1:5500 体验。

## 关键代码

```html
<script src="../../dist/arkclaw-widget.umd.js"></script>
<script>
  const claw = new window.Arkclaw.Arkclaw({
    endpoint: 'http://127.0.0.1:8000',
    auth: { type: 'lark' },          // 飞书登录；外部 SaaS 用 { type: 'jwt', token: '...' }
    ui: { mode: 'side-drawer', defaultOpen: true },
    context: { captureClicks: true, captureSelection: true },
    actions: {
      fillForm: ({ field, value }) => {
        const el = document.querySelector(`[name="${field}"]`);
        el.value = value;
        return { ok: !!el };
      },
    },
  });
  claw.mount();
</script>
```
