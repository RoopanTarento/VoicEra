"""Email delivery via Mailtrap."""

from __future__ import annotations

import logging

from mailtrap import Address, Mail, MailtrapClient

from app.config import settings

logger = logging.getLogger(__name__)


def send_password_reset_email(email: str, reset_token: str, reset_url: str) -> bool:
    """
    Send a password-reset email.

    Returns True on success, False otherwise.
    """
    del reset_token  # reserved for future templates; URL carries the token
    try:
        if not settings.MAILTRAP_API_TOKEN:
            logger.error("MAILTRAP_API_TOKEN not configured")
            return False

        mail = Mail(
            sender=Address(
                email=settings.MAILTRAP_FROM_EMAIL,
                name=settings.MAILTRAP_FROM_NAME,
            ),
            to=[Address(email=email)],
            subject="Reset Your Password - Voicera",
            text=(
                "Hello,\n\n"
                "You requested to reset your password for your Voicera account.\n\n"
                f"Click the link below to reset your password:\n{reset_url}\n\n"
                "This link will expire in 1 hour.\n\n"
                "If you didn't request this password reset, please ignore this email.\n\n"
                "Best regards,\nVoicera Team\n"
            ),
            html=f"""<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
        .button {{ display: inline-block; padding: 12px 24px; background-color: #007bff;
                   color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }}
        .footer {{ margin-top: 30px; font-size: 12px; color: #666; }}
    </style>
</head>
<body>
    <div class="container">
        <h2>Reset Your Password</h2>
        <p>Hello,</p>
        <p>You requested to reset your password for your Voicera account.</p>
        <p>Click the button below to reset your password:</p>
        <a href="{reset_url}" class="button">Reset Password</a>
        <p>Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #007bff;">{reset_url}</p>
        <p>This link will expire in 1 hour.</p>
        <p>If you didn't request this password reset, please ignore this email.</p>
        <div class="footer">
            <p>Best regards,<br>Voicera Team</p>
        </div>
    </div>
</body>
</html>""",
        )

        client = MailtrapClient(token=settings.MAILTRAP_API_TOKEN)
        client.send(mail)
        logger.info("Password reset email sent to: %s", email)
        return True
    except Exception as exc:
        logger.error("Error sending password reset email: %s", exc)
        return False


def email_configured() -> bool:
    return bool(settings.MAILTRAP_API_TOKEN)


def send_invitation_email(email: str, *, org_name: str, role_label: str, invite_url: str, inviter: str) -> bool:
    """Send an organisation invitation. Returns True on success, False otherwise."""
    try:
        if not settings.MAILTRAP_API_TOKEN:
            logger.warning("Invitation email not sent: MAILTRAP_API_TOKEN not configured")
            return False
        mail = Mail(
            sender=Address(email=settings.MAILTRAP_FROM_EMAIL, name=settings.MAILTRAP_FROM_NAME),
            to=[Address(email=email)],
            subject=f"You're invited to {org_name} on Voicera",
            text=(
                "Hello,\n\n"
                f"{inviter} invited you to join {org_name} on Voicera as {role_label}.\n\n"
                f"Accept the invitation and set your password here:\n{invite_url}\n\n"
                "This link works once and expires in 7 days.\n\n"
                "If you weren't expecting this, you can ignore this email.\n\n"
                "Best regards,\nVoicera Team\n"
            ),
            html=f"""<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
    <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2>Join {org_name} on Voicera</h2>
        <p>{inviter} invited you to join <strong>{org_name}</strong> as <strong>{role_label}</strong>.</p>
        <a href="{invite_url}" style="display: inline-block; padding: 12px 24px; background-color: #007bff;
           color: white; text-decoration: none; border-radius: 5px; margin: 20px 0;">Accept invitation</a>
        <p>Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #007bff;">{invite_url}</p>
        <p>This link works once and expires in 7 days. If you weren't expecting this, you can ignore this email.</p>
        <p style="margin-top: 30px; font-size: 12px; color: #666;">Best regards,<br>Voicera Team</p>
    </div>
</body>
</html>""",
        )
        MailtrapClient(token=settings.MAILTRAP_API_TOKEN).send(mail)
        logger.info("Invitation email sent")
        return True
    except Exception as exc:
        logger.error("Error sending invitation email: %s", exc)
        return False
