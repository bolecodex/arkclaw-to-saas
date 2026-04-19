# Next.js (App Router) 接入示例

通过客户端组件挂载 Widget，避免 SSR 时访问 `window`。

## 运行

```bash
# 1. 在 widget 根目录构建一次（首次或修改后）
cd widget && npm install && npm run build

# 2. 安装 example 依赖
cd examples/nextjs && npm install

# 3. 启动后端
cd ../../../backend && uvicorn app.main:app --reload --port 8000

# 4. 启动 Next.js example
cd widget/examples/nextjs && npm run dev
```

打开 http://127.0.0.1:5175 体验。

## 关键代码

`components/ClawProvider.tsx` 是一个 `'use client'` 组件，使用动态 import 加载 widget：

```tsx
'use client';
import { useEffect, useRef } from 'react';

export function ClawProvider({ children }) {
  useEffect(() => {
    import('@arkclaw/widget').then(({ Arkclaw }) => {
      const claw = new Arkclaw({ /* ... */ });
      claw.mount();
    });
  }, []);
  return <>{children}</>;
}
```
