"""实例管理代理（列表/创建/状态查询）。"""

import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from app.core.config import Settings, get_settings
from app.core.security import get_current_session
from app.schemas.auth import SessionInfo
from app.schemas.chat import CreateInstanceRequest, InstanceInfo
from app.services import arkclaw

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/instances", tags=["instances"])


@router.get("", response_model=List[InstanceInfo], summary="列出实例")
def list_instances(
    settings: Settings = Depends(get_settings),
    session: SessionInfo = Depends(get_current_session),
) -> List[InstanceInfo]:
    if not settings.arkclaw_space_id:
        raise HTTPException(400, "ARKCLAW_SPACE_ID not configured")
    items = arkclaw.list_instances(
        settings.ak, settings.sk, settings.arkclaw_space_id, settings.arkclaw_region
    )
    return [
        InstanceInfo(
            instance_id=it.get("ClawInstanceId", ""),
            name=it.get("Name", ""),
            status=it.get("Status", ""),
            spec=it.get("Spec", ""),
        )
        for it in items
    ]


@router.post("", response_model=InstanceInfo, summary="创建实例")
def create_instance(
    req: CreateInstanceRequest,
    settings: Settings = Depends(get_settings),
    session: SessionInfo = Depends(get_current_session),
) -> InstanceInfo:
    space_id = req.space_id or settings.arkclaw_space_id
    if not space_id:
        raise HTTPException(400, "space_id required")
    instance_id = arkclaw.create_instance(
        settings.ak, settings.sk, space_id, name=req.name, spec=req.spec, region=settings.arkclaw_region
    )
    return InstanceInfo(instance_id=instance_id, name=req.name, status="Creating", spec=req.spec)


@router.get("/{instance_id}", response_model=InstanceInfo, summary="查询实例状态")
def get_instance(
    instance_id: str,
    settings: Settings = Depends(get_settings),
    session: SessionInfo = Depends(get_current_session),
) -> InstanceInfo:
    status = arkclaw.get_instance_status(
        settings.ak, settings.sk, instance_id, settings.arkclaw_region
    )
    return InstanceInfo(instance_id=instance_id, status=status)
