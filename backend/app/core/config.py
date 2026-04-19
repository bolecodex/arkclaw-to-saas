"""集中配置（pydantic-settings）。"""

from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _find_env_files() -> tuple:
    """优先用项目根的 .env，再回退到 backend/.env。"""
    here = Path(__file__).resolve()
    backend_dir = here.parents[2]
    project_root = backend_dir.parent
    candidates = [project_root / ".env", backend_dir / ".env"]
    return tuple(str(p) for p in candidates if p.exists())


class Settings(BaseSettings):
    """应用配置，从环境变量或 .env 加载。"""

    model_config = SettingsConfigDict(
        env_file=_find_env_files() or ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ── 火山引擎 ArkClaw ──
    volc_access_key_id: str = Field(default="", validation_alias="VOLC_ACCESS_KEY_ID")
    volc_secret_access_key: str = Field(default="", validation_alias="VOLC_SECRET_ACCESS_KEY")
    arkclaw_region: str = Field(default="cn-beijing", validation_alias="ARKCLAW_REGION")
    arkclaw_space_id: str = Field(default="", validation_alias="ARKCLAW_SPACE_ID")
    arkclaw_default_instance_id: str = Field(default="", validation_alias="ARKCLAW_INSTANCE_ID")

    # 兼容旧变量名
    volc_access_key_id_legacy: str = Field(default="", validation_alias="VOLC_2_ACCESS_KEY_ID")
    volc_secret_access_key_legacy: str = Field(default="", validation_alias="VOLC_2_SECRET_ACCESS_KEY")

    # ── 飞书 OAuth ──
    lark_app_id: str = Field(default="", validation_alias="LARK_APP_ID")
    lark_app_secret: str = Field(default="", validation_alias="LARK_APP_SECRET")
    lark_redirect_uri: str = Field(
        default="http://127.0.0.1:8000/auth/lark/callback",
        validation_alias="LARK_REDIRECT_URI",
    )

    # ── 自家 Session JWT ──
    session_jwt_secret: str = Field(
        default="change-me-in-production",
        validation_alias="SESSION_JWT_SECRET",
    )
    session_jwt_ttl_seconds: int = Field(default=86400, validation_alias="SESSION_JWT_TTL")

    # ── SaaS JWT 校验 ──
    saas_jwt_secret: str = Field(default="", validation_alias="SAAS_JWT_SECRET")
    saas_jwt_public_key: str = Field(default="", validation_alias="SAAS_JWT_PUBLIC_KEY")
    saas_jwt_algorithm: str = Field(default="HS256", validation_alias="SAAS_JWT_ALGORITHM")
    saas_jwt_issuer: str = Field(default="", validation_alias="SAAS_JWT_ISSUER")
    saas_jwt_audience: str = Field(default="", validation_alias="SAAS_JWT_AUDIENCE")

    # ── 服务 ──
    host: str = Field(default="127.0.0.1", validation_alias="HOST")
    port: int = Field(default=8000, validation_alias="PORT")
    cors_origins: str = Field(default="*", validation_alias="CORS_ORIGINS")

    # ── 开发模式 ──
    # 默认开启，方便本地 demo；生产环境务必设为 false
    dev_session_enabled: bool = Field(default=True, validation_alias="DEV_SESSION_ENABLED")

    @property
    def ak(self) -> str:
        return self.volc_access_key_id or self.volc_access_key_id_legacy

    @property
    def sk(self) -> str:
        return self.volc_secret_access_key or self.volc_secret_access_key_legacy

    @property
    def cors_origin_list(self) -> List[str]:
        if self.cors_origins.strip() == "*":
            return ["*"]
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
