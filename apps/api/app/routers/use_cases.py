"""Agent use cases: the scheme, intent and survey catalogue, custom schemes and prompt presets."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field

from app.auth import get_current_user
from app.services import audit_log, knowledge_packs, use_cases

router = APIRouter(prefix="/use-cases", tags=["use-cases"])


class PresetRequest(BaseModel):
    use_case: str
    intent: Optional[str] = None
    scheme_ids: list[str] = Field(default_factory=list)
    survey_id: Optional[str] = None


class CustomSchemeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    category: str = ""
    summary: str = ""
    benefit: str = Field(min_length=1, max_length=600)
    eligibility: str = Field(min_length=1, max_length=600)
    how_to_apply: str = Field(min_length=1, max_length=600)
    website: str = ""
    helpline: str = ""
    kind: str = "other"
    documents: list[str] = Field(default_factory=list)
    questions: list[str] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)


def _org(current_user: dict[str, Any]) -> str:
    org_id = str(current_user.get("org_id") or "")
    if not org_id:
        raise HTTPException(status_code=400, detail="No active organisation")
    return org_id


def _raise(exc: use_cases.UseCaseError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("")
async def get_catalogue(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    return use_cases.catalogue(_org(current_user))


@router.post("/preset")
async def preset(body: PresetRequest, current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """Agent text for a use case. Scheme agents get their schemes' built-in
    knowledge packs written into the prompt; ``knowledge`` lists those packs."""
    org_id = _org(current_user)
    try:
        result = use_cases.build_preset(
            org_id,
            use_case=body.use_case,
            intent=body.intent,
            scheme_ids=body.scheme_ids,
            survey_id=body.survey_id,
        )
    except use_cases.UseCaseError as exc:
        _raise(exc)
        raise
    schemes = use_cases._schemes_for(org_id, result["use_case"]["scheme_ids"]) if result["use_case"]["type"] == "scheme" else []
    knowledge = [{"scheme_id": s["id"], "name": knowledge_packs.pack_filename(s)} for s in schemes]
    return {**result, "knowledge": knowledge}


@router.get("/knowledge/{scheme_id}")
async def knowledge_pack(scheme_id: str, current_user: dict[str, Any] = Depends(get_current_user)) -> Response:
    """A scheme's built-in knowledge pack as a PDF (built-in or this organisation's own scheme)."""
    scheme = next((s for s in use_cases.catalogue(_org(current_user))["schemes"] if s["id"] == scheme_id), None)
    if not scheme:
        raise HTTPException(status_code=404, detail="Scheme not found")
    return Response(
        content=knowledge_packs.pack_pdf(scheme),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{knowledge_packs.pack_filename(scheme)}"'},
    )


@router.post("/schemes", status_code=status.HTTP_201_CREATED)
async def add_scheme(body: CustomSchemeCreate, current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    org_id = _org(current_user)
    try:
        scheme = use_cases.add_custom_scheme(org_id, body.model_dump(), actor_email=str(current_user.get("email") or ""))
    except use_cases.UseCaseError as exc:
        _raise(exc)
        raise
    audit_log.record(
        org_id,
        entity_type="agent",
        action="created",
        actor_email=str(current_user["email"]),
        actor_role=str(current_user.get("role") or ""),
        entity_id=scheme["id"],
        entity_name=f"Scheme: {scheme['name']}",
    )
    return scheme


@router.delete("/schemes/{scheme_id}")
async def delete_scheme(scheme_id: str, current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    org_id = _org(current_user)
    try:
        use_cases.delete_custom_scheme(org_id, scheme_id)
    except use_cases.UseCaseError as exc:
        _raise(exc)
        raise
    audit_log.record(
        org_id,
        entity_type="agent",
        action="deleted",
        actor_email=str(current_user["email"]),
        actor_role=str(current_user.get("role") or ""),
        entity_id=scheme_id,
        entity_name=f"Scheme: {scheme_id}",
    )
    return {"status": "success", "message": "Scheme removed"}
