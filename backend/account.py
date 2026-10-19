"""Verified recovery email and single-use password reset, separate from login."""

import os
import smtplib
import ssl
from email.message import EmailMessage
from datetime import datetime, timedelta, timezone
from fastapi import Depends, Request, BackgroundTasks
from sqlalchemy import select, delete, update
from argon2.exceptions import VerificationError, InvalidHashError
from .models import User, Session, Token, AccountChallenge, now
from .schemas import EmailBinding, RecoveryRequest, ChallengeInput, PasswordReset


def install_account_routes(app, settings, db, auth, human, rate):
    from .main import PASSWORD, digest, fail
    import secrets

    def mail_ready():
        return bool(
            getattr(app.state, "mail_sender", None)
            or (os.getenv("SMTP_HOST") and os.getenv("SMTP_FROM"))
        )

    def send_mail(address, subject, body):
        injected = getattr(app.state, "mail_sender", None)
        if injected:
            return injected(address, subject, body)
        message = EmailMessage()
        message["From"] = os.environ["SMTP_FROM"]
        message["To"] = address
        message["Subject"] = subject
        message.set_content(body)
        with smtplib.SMTP(
            os.environ["SMTP_HOST"], int(os.getenv("SMTP_PORT", "587")), timeout=10
        ) as server:
            server.starttls(context=ssl.create_default_context())
            if os.getenv("SMTP_USERNAME"):
                server.login(os.environ["SMTP_USERNAME"], os.environ["SMTP_PASSWORD"])
            server.send_message(message)

    def deliver(address, subject, body):
        try:
            send_mail(address, subject, body)
        except Exception:
            # Do not log credentials, reset links or the recipient address.
            import logging

            logging.getLogger(__name__).warning("Account email delivery failed")

    def create_challenge(d, user, purpose, address):
        cutoff = (datetime.now(timezone.utc) - timedelta(seconds=60)).isoformat()
        recent = d.scalar(
            select(AccountChallenge).where(
                AccountChallenge.owner == user.id,
                AccountChallenge.purpose == purpose,
                AccountChallenge.created_at > cutoff,
            )
        )
        if recent:
            return None
        d.execute(
            delete(AccountChallenge).where(
                AccountChallenge.owner == user.id, AccountChallenge.purpose == purpose
            )
        )
        raw = secrets.token_urlsafe(32)
        d.add(
            AccountChallenge(
                id=digest(raw),
                owner=user.id,
                purpose=purpose,
                email=address,
                expires=(
                    datetime.now(timezone.utc) + timedelta(minutes=30)
                ).isoformat(),
            )
        )
        d.commit()
        return raw

    @app.get("/api/v1/auth/options")
    def options():
        return {"email_recovery_enabled": mail_ready()}

    @app.post("/api/v1/auth/email/request")
    def request_email(
        body: EmailBinding,
        request: Request,
        tasks: BackgroundTasks,
        a=Depends(auth),
        d=Depends(db),
    ):
        human(a)
        rate(request)
        if not mail_ready():
            fail(503, "邮件服务尚未配置，请联系管理员")
        user = d.scalar(select(User).where(User.id == a["id"]).with_for_update())
        try:
            PASSWORD.verify(user.password, body.password)
        except (VerificationError, InvalidHashError):
            fail(401, "当前密码不正确")
        other = d.scalar(
            select(User).where(User.email == body.email, User.id != user.id)
        )
        if other:
            fail(409, "该邮箱不可绑定")
        token = create_challenge(d, user, "email", body.email)
        if token:
            tasks.add_task(
                deliver,
                body.email,
                "Open Paper Reader：验证找回邮箱",
                f"请打开以下链接并确认绑定邮箱，30 分钟内有效：\n{settings.origin}/#verify-email?token={token}\n如非本人操作，请忽略。",
            )
        return {"message": "验证邮件已请求发送，请查收。再次发送需间隔 60 秒。"}

    @app.post("/api/v1/auth/email/confirm")
    def confirm_email(
        body: ChallengeInput, request: Request, a=Depends(auth), d=Depends(db)
    ):
        human(a)
        rate(request)
        d.scalar(select(User).where(User.id == a["id"]).with_for_update())
        challenge = d.scalar(
            select(AccountChallenge).where(
                AccountChallenge.id == digest(body.token),
                AccountChallenge.owner == a["id"],
                AccountChallenge.purpose == "email",
                AccountChallenge.expires > now(),
            )
        )
        if not challenge:
            fail(400, "验证链接无效或已过期")
        consumed = d.execute(
            delete(AccountChallenge).where(AccountChallenge.id == challenge.id)
        )
        if consumed.rowcount != 1:
            fail(400, "验证链接已使用")
        d.execute(
            update(User)
            .where(User.id == a["id"])
            .values(email=challenge.email, email_verified=True)
        )
        d.execute(delete(AccountChallenge).where(AccountChallenge.owner == a["id"]))
        d.commit()
        return {"message": "找回邮箱已验证"}

    @app.post("/api/v1/auth/password-reset/request")
    def request_reset(
        body: RecoveryRequest, request: Request, tasks: BackgroundTasks, d=Depends(db)
    ):
        rate(request)
        if not mail_ready():
            fail(503, "邮件服务尚未配置，请联系管理员")
        user = d.scalar(
            select(User).where(User.email == body.email, User.email_verified == True)
        )
        if user:
            token = create_challenge(d, user, "reset", body.email)
            if token:
                tasks.add_task(
                    deliver,
                    body.email,
                    "Open Paper Reader：找回账号与密码",
                    f"你的用户名：{user.username}\n重置密码链接（30 分钟内有效，只能使用一次）：\n{settings.origin}/#reset-password?token={token}\n如非本人操作，请忽略。",
                )
        return {
            "message": "如果该邮箱已验证并绑定账号，你将收到包含用户名和密码重置链接的邮件。"
        }

    @app.post("/api/v1/auth/password-reset/complete")
    def complete_reset(body: PasswordReset, request: Request, d=Depends(db)):
        rate(request)
        challenge = d.scalar(
            select(AccountChallenge).where(
                AccountChallenge.id == digest(body.token),
                AccountChallenge.purpose == "reset",
                AccountChallenge.expires > now(),
            )
        )
        if not challenge:
            fail(400, "重置链接无效或已过期")
        user = d.scalar(
            select(User).where(User.id == challenge.owner).with_for_update()
        )
        if not user.email_verified or user.email != challenge.email:
            fail(400, "找回邮箱已变化，请重新发起找回")
        password_hash = PASSWORD.hash(body.password)
        consumed = d.execute(
            delete(AccountChallenge).where(AccountChallenge.id == challenge.id)
        )
        if consumed.rowcount != 1:
            fail(400, "重置链接已使用")
        d.execute(update(User).where(User.id == user.id).values(password=password_hash))
        d.execute(delete(Session).where(Session.owner == user.id))
        d.execute(update(Token).where(Token.owner == user.id).values(revoked=True))
        d.execute(delete(AccountChallenge).where(AccountChallenge.owner == user.id))
        d.commit()
        return {"message": "密码已重置，请用用户名和新密码重新登录。"}
