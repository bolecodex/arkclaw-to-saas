# ArkClaw SaaS Backend (FastAPI)

## 启动

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

启动后：
- 文档：http://127.0.0.1:8000/docs
- 健康检查：http://127.0.0.1:8000/health

## 环境变量

复制根目录的 `.env.example` 为 `.env`，填好以下变量：

| 变量 | 说明 |
|------|------|
| `VOLC_ACCESS_KEY_ID` / `VOLC_SECRET_ACCESS_KEY` | 火山引擎 AK/SK |
| `ARKCLAW_REGION` / `ARKCLAW_SPACE_ID` / `ARKCLAW_INSTANCE_ID` | ArkClaw 资源 |
| `LARK_APP_ID` / `LARK_APP_SECRET` | 飞书应用凭证（lark 模式） |
| `LARK_REDIRECT_URI` | 飞书回调地址，必须与开发者后台一致 |
| `SESSION_JWT_SECRET` | 自家 session JWT 签名密钥（强随机串） |
| `SAAS_JWT_SECRET` / `SAAS_JWT_PUBLIC_KEY` | SaaS JWT 校验密钥（HS256/RS256 二选一） |
| `CORS_ORIGINS` | 允许的跨域，多个逗号分隔；生产不要用 `*` |

## API 一览

| Method | Path | 说明 |
|--------|------|------|
| GET | `/auth/lark/login?redirect_to=/page` | 重定向飞书授权 |
| GET | `/auth/lark/callback` | 飞书回调，签发 session JWT |
| POST | `/auth/saas/verify` | 校验 SaaS JWT 并签发 session JWT |
| POST | `/api/chat/token` | 用 session 换 ChatToken+Endpoint |
| GET | `/api/instances` | 列出实例 |
| POST | `/api/instances` | 创建实例 |
| GET | `/api/instances/{id}` | 查询实例状态 |

需要 `Authorization: Bearer <session_jwt>` 才能访问 `/api/*`。

## Docker

```bash
docker build -t arkclaw-backend .
docker run --env-file ../.env -p 8000:8000 arkclaw-backend
```
