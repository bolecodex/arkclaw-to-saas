"""聊天/实例相关 schema。"""

from typing import Optional

from pydantic import BaseModel, Field


class ChatTokenRequest(BaseModel):
    instance_id: Optional[str] = Field(default=None, description="ArkClaw 实例 ID")


class ChatTokenResponse(BaseModel):
    chat_token: str
    endpoint: str
    instance_id: str
    ws_url: str


class InstanceInfo(BaseModel):
    instance_id: str
    name: str = ""
    status: str = ""
    spec: str = ""


class CreateInstanceRequest(BaseModel):
    space_id: Optional[str] = None
    name: str = "saas-widget-instance"
    spec: str = "Starter"
