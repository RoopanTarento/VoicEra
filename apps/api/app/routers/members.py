"""Member API routes."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import get_current_user
from app.database_init import ROLE_SUPER_ADMIN
from app.models.schemas import (
    MemberRoleUpdate,
    AssignAdminRequest,
    InvitationCreate,
    MemberInvite,
    MemberJoin,
    RemoveMemberRequest,
    UserLoginResponse,
)
from app import rbac
from app.services import audit_log, email_service, invitation_service, member_service, org_service
from app.services.secure import security_audit
from app.services import user_service

router = APIRouter(prefix="/members", tags=["members"])


def _require_active_org(current_user: dict[str, Any]) -> str:
    org_id = current_user.get("org_id")
    if not org_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active organisation in token",
        )
    return org_id


@router.post(
    "/invite",
    response_model=dict[str, Any],
    status_code=status.HTTP_201_CREATED,
)
async def invite_member(
    invite: MemberInvite,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Invite a user into the caller's active organisation (admin or super_admin)."""
    org_id = _require_active_org(current_user)
    result = member_service.invite_member(
        invite,
        current_user["email"],
        org_id,
        current_user.get("role") or "",
    )
    if result["status"] == "fail":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result["message"],
        )
    audit_log.record(
        org_id,
        entity_type="member",
        action="invited",
        actor_email=str(current_user["email"]),
        actor_role=str(current_user.get("role") or ""),
        entity_id=invite.email,
        entity_name=invite.email,
    )
    return result


@router.post(
    "/join",
    response_model=UserLoginResponse,
    status_code=status.HTTP_201_CREATED,
)
async def join_organisation(body: MemberJoin) -> dict[str, Any]:
    """Accept an invitation (token from the invite link) and sign in."""
    invitation = invitation_service.find_valid(body.invite_token or "")
    if not invitation:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "This invitation link isn't valid any more (used, expired or withdrawn). "
                "Ask your organisation's Super admin or an Admin to invite you again."
            ),
        )
    if str(body.email) != str(invitation["email"]).lower():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This invitation was sent to a different email address. Use the email it was sent to.",
        )
    result = member_service.join_organisation(
        body.email,
        body.password,
        invitation["org_id"],
        invitation["role"],
        name=body.name,
    )
    if result["status"] == "fail":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result["message"],
        )
    invitation_service.mark_accepted(invitation["invite_id"], result["email"])
    audit_log.record(
        result["org_id"],
        entity_type="member",
        action="joined",
        actor_email=result["email"],
        actor_role=result["role"],
        entity_id=result["email"],
        entity_name=result["email"],
        detail=f"role={result['role']} invite={invitation['invite_id']}",
    )
    return user_service.auth_response_for_membership(
        result["email"],
        result["org_id"],
        result["role"],
        message=result["message"],
        is_first_login=result.get("is_first_login", False),
    )


@router.post("/invitations", status_code=status.HTTP_201_CREATED)
async def create_invitation(
    body: InvitationCreate,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Invite a person with a role. Returns the one-time link; optionally emails it."""
    org_id = _require_active_org(current_user)
    caller_email = str(current_user["email"])
    caller_role = rbac.membership_role(caller_email, org_id) or str(current_user.get("role") or "")
    try:
        invitation, token = invitation_service.create_invitation(
            org_id, email=str(body.email), role=body.role, caller_email=caller_email, caller_role=caller_role
        )
    except invitation_service.InvitationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    url = invitation_service.invite_url(token)
    email_sent = False
    email_note = None
    if body.send_email:
        if not email_service.email_configured():
            email_note = "Email isn't set up on this VoicEra yet (MAILTRAP_API_TOKEN). Copy the link and send it yourself."
        else:
            org = org_service.get_organisation(org_id) or {}
            email_sent = email_service.send_invitation_email(
                str(body.email),
                org_name=str(org.get("name") or org_id),
                role_label=invitation["role_label"],
                invite_url=url,
                inviter=caller_email,
            )
            if email_sent:
                invitation_service.mark_email_sent(invitation["invite_id"])
            else:
                email_note = "The email couldn't be sent. Copy the link and send it yourself."
    audit_log.record(
        org_id,
        entity_type="member",
        action="invited",
        actor_email=caller_email,
        actor_role=caller_role,
        entity_id=str(body.email),
        entity_name=str(body.email),
        detail=f"role={body.role} email_sent={email_sent}",
    )
    return {**invitation, "email_sent": email_sent, "email_note": email_note, "invite_url": url}


@router.get("/invitations")
async def list_invitations(current_user: dict[str, Any] = Depends(get_current_user)) -> list[dict[str, Any]]:
    """Pending invitations (links are not shown again)."""
    return invitation_service.list_pending(_require_active_org(current_user))


@router.delete("/invitations/{invite_id}")
async def revoke_invitation(invite_id: str, current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    org_id = _require_active_org(current_user)
    if not invitation_service.revoke(org_id, invite_id):
        raise HTTPException(status_code=404, detail="Invitation not found")
    audit_log.record(
        org_id,
        entity_type="member",
        action="invitation_revoked",
        actor_email=str(current_user["email"]),
        actor_role=str(current_user.get("role") or ""),
        entity_id=invite_id,
        entity_name=invite_id,
    )
    return {"status": "success", "message": "Invitation withdrawn"}


@router.get("/invitations/lookup/{token}")
async def lookup_invitation(token: str) -> dict[str, Any]:
    """Public: what the join page shows for an invite link."""
    found = invitation_service.lookup(token)
    if not found:
        raise HTTPException(
            status_code=404,
            detail="This invitation link isn't valid any more (used, expired or withdrawn).",
        )
    return found


@router.get("/{org_id}", response_model=dict[str, Any])
async def get_members(
    org_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """List members for an organisation (Bearer; must be a member of that org)."""
    membership = member_service.get_membership(current_user["email"], org_id)
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to access members of this organization",
        )

    result = member_service.get_members_by_org(org_id)
    if result["status"] == "fail":
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=result["message"],
        )
    return result


@router.post("/assign-admin", response_model=dict[str, Any])
async def assign_admin(
    body: AssignAdminRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Promote a member to admin (super_admin only; active org from JWT)."""
    org_id = _require_active_org(current_user)
    if current_user.get("role") != ROLE_SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only super admins can assign admins",
        )

    result = member_service.assign_admin(
        body,
        current_user["email"],
        org_id,
        current_user.get("role") or "",
    )
    if result["status"] == "fail":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result["message"],
        )
    audit_log.record(
        org_id,
        entity_type="member",
        action="role_changed",
        actor_email=str(current_user["email"]),
        actor_role=str(current_user.get("role") or ""),
        entity_id=body.email,
        entity_name=body.email,
        detail="promoted to admin",
    )
    return result


@router.patch("/role", response_model=dict[str, Any])
async def change_member_role(
    body: MemberRoleUpdate,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Change a member's role (Super admin: any role but Super admin; Admin: Campaign manager or Viewer)."""
    org_id = _require_active_org(current_user)
    caller_role = rbac.membership_role(str(current_user["email"]), org_id) or str(current_user.get("role") or "")
    result = member_service.set_role(
        str(body.email),
        body.role,
        caller_email=str(current_user["email"]),
        caller_role=caller_role,
        org_id=org_id,
    )
    if result["status"] == "fail":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=result["message"])
    if result.get("previous_role") != result.get("role"):
        audit_log.record(
            org_id,
            entity_type="member",
            action="role_changed",
            actor_email=str(current_user["email"]),
            actor_role=caller_role,
            entity_id=str(body.email),
            entity_name=str(body.email),
            detail=f"{result.get('previous_role')} -> {result.get('role')}",
        )
        security_audit.record(
            "config.change",
            org_id=org_id,
            actor_type="user",
            actor_id=str(current_user["email"]),
            actor_role=caller_role,
            outcome="success",
            action="role_changed",
            metadata={"member": str(body.email), "from": result.get("previous_role"), "to": result.get("role")},
        )
    return result


@router.post("/remove", response_model=dict[str, Any])
async def remove_member(
    body: RemoveMemberRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Remove a member (Super admin: anyone but themselves; Admin: Campaign managers and Viewers)."""
    org_id = _require_active_org(current_user)
    caller_role = rbac.membership_role(str(current_user["email"]), org_id) or str(current_user.get("role") or "")
    result = member_service.remove_member(
        body,
        current_user["email"],
        org_id,
        caller_role,
    )
    if result["status"] == "fail":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result["message"],
        )
    audit_log.record(
        org_id,
        entity_type="member",
        action="removed",
        actor_email=str(current_user["email"]),
        actor_role=str(current_user.get("role") or ""),
        entity_id=body.email,
        entity_name=body.email,
    )
    return result
