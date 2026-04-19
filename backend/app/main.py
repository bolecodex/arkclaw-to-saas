"""FastAPI 应用入口。"""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, chat, diag, instances
from app.core.config import get_settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="ArkClaw SaaS Backend",
        description="ArkClaw 消息外接的 SaaS 集成后端：飞书 OAuth + SaaS JWT 双认证",
        version="0.1.0",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(auth.router)
    app.include_router(chat.router)
    app.include_router(instances.router)
    app.include_router(diag.router)

    @app.get("/health", tags=["meta"])
    def health():
        return {
            "status": "ok",
            "region": settings.arkclaw_region,
            "default_instance_id": settings.arkclaw_default_instance_id,
            "has_volc": bool(settings.ak and settings.sk),
            "has_lark": bool(settings.lark_app_id),
            "has_saas_jwt": bool(settings.saas_jwt_secret or settings.saas_jwt_public_key),
            "dev_session_enabled": settings.dev_session_enabled,
        }

    @app.get("/", tags=["meta"])
    def root():
        return {
            "name": "ArkClaw SaaS Backend",
            "docs": "/docs",
            "health": "/health",
        }

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=True)
