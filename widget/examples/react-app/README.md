# React 接入示例

通过 npm link / 本地路径依赖把 widget 接入到 React 应用。

## 运行

```bash
# 1. 在 widget 根目录构建一次
cd widget && npm install && npm run build

# 2. 安装 example 依赖（指向本地 widget 包）
cd examples/react-app && npm install

# 3. 启动后端（参考 backend/README.md）
cd ../../../backend && uvicorn app.main:app --reload --port 8000

# 4. 启动 React example
cd widget/examples/react-app && npm run dev
```

打开 http://127.0.0.1:5174 体验。

## 关键代码

`useArkclaw` 自定义 Hook 把 SDK 生命周期绑定到 React 组件：

```tsx
const claw = useArkclaw({
  endpoint: 'http://127.0.0.1:8000',
  auth: { type: 'lark' },
  ui: { defaultOpen: true },
  actions: {
    fillForm: ({ field, value }) => {
      // 直接修改 React state，框架会自然 re-render
    },
  },
});
```
