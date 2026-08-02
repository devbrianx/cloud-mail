#!/usr/bin/env python3
"""End-to-end test for a deployed Cloud Mail temporary mailbox API.

The test creates a temporary mailbox, sends (or waits for) a real inbound email,
polls delivery, verifies message read/update/delete endpoints, then deletes the
mailbox. It never prints API keys, bearer tokens, or SMTP passwords.

Automated SMTP example:
  python test_temp_api.py --base-url https://mail.example.com --api-key AC-... \
      --domain example.com --smtp-host smtp.example.com --smtp-port 587 \
      --smtp-user sender@example.net --smtp-password '...' \
      --smtp-from sender@example.net --smtp-starttls

Manual delivery example:
  python test_temp_api.py --base-url https://mail.example.com --api-key AC-... \
      --domain example.com
  # Send the displayed subject to the displayed temporary address, then press Enter.
"""

from __future__ import annotations

import argparse
import json
import os
import smtplib
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass, field
from email.message import EmailMessage
from typing import Any


class SmokeTestError(RuntimeError):
    pass


@dataclass
class ApiClient:
    base_url: str
    api_key: str
    timeout: float
    created_accounts: list[str] = field(default_factory=list)

    def request(
        self,
        method: str,
        path: str,
        *,
        api_key: bool = False,
        token: str | None = None,
        payload: dict[str, Any] | None = None,
        expected: set[int] | None = None,
    ) -> tuple[int, dict[str, str], Any]:
        headers = {
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Cloud-Mail-Temporary-Mailbox-Test)",
        }
        body = None
        if api_key:
            headers["X-API-Key"] = self.api_key
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if payload is not None:
            headers["Content-Type"] = "application/json"
            body = json.dumps(payload).encode("utf-8")

        request = urllib.request.Request(
            urllib.parse.urljoin(self.base_url + "/", path.lstrip("/")),
            method=method,
            data=body,
            headers=headers,
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                status = response.status
                response_headers = dict(response.headers.items())
                raw_body = response.read()
        except urllib.error.HTTPError as error:
            status = error.code
            response_headers = dict(error.headers.items())
            raw_body = error.read()
        except urllib.error.URLError as error:
            raise SmokeTestError(f"HTTP 请求失败：{error.reason}") from error

        try:
            data = json.loads(raw_body) if raw_body else None
        except json.JSONDecodeError:
            data = raw_body.decode("utf-8", errors="replace")
        if expected is not None and status not in expected:
            detail = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False)
            raise SmokeTestError(f"{method} {path} 返回 HTTP {status}，期望 {sorted(expected)}：{detail}")
        return status, response_headers, data

    def api(self, method: str, path: str, payload: dict[str, Any] | None = None, expected: set[int] | None = None):
        return self.request(method, path, api_key=True, payload=payload, expected=expected)

    def cleanup(self) -> None:
        while self.created_accounts:
            account_id = self.created_accounts.pop()
            try:
                self.api("DELETE", f"/v1/accounts/{account_id}", expected={204, 404})
                print(f"清理临时邮箱：{account_id}")
            except SmokeTestError as error:
                print(f"警告：无法清理临时邮箱 {account_id}：{error}", file=sys.stderr)


def successful_data(data: Any, name: str) -> dict[str, Any]:
    if not isinstance(data, dict) or data.get("success") is not True or not isinstance(data.get("data"), dict):
        raise SmokeTestError(f"{name} 未返回成功 API 信封：{json.dumps(data, ensure_ascii=False)}")
    return data["data"]


def unique_local_part(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


def create_account(client: ApiClient, domain: str) -> dict[str, Any]:
    _, _, data = client.api(
        "POST",
        "/v1/accounts",
        {"domain": domain, "localPart": unique_local_part("mailtest")},
        expected={201},
    )
    account = successful_data(data, "创建临时邮箱")
    required = {"id", "address", "token", "mode", "expiresAt"}
    if required - account.keys() or not account["token"]:
        raise SmokeTestError(f"创建临时邮箱返回字段不完整：缺少 {sorted(required - account.keys())}")
    client.created_accounts.append(account["id"])
    print(f"创建临时邮箱：{account['address']}")
    return account


def send_smtp(args: argparse.Namespace, recipient: str, subject: str, code: str) -> None:
    message = EmailMessage()
    message["From"] = args.smtp_from
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(f"Cloud Mail temporary inbox end-to-end test. Verification code: {code}")

    try:
        if args.smtp_ssl:
            server: smtplib.SMTP | smtplib.SMTP_SSL = smtplib.SMTP_SSL(
                args.smtp_host, args.smtp_port, timeout=args.timeout, context=ssl.create_default_context()
            )
        else:
            server = smtplib.SMTP(args.smtp_host, args.smtp_port, timeout=args.timeout)
            server.ehlo()
            if args.smtp_starttls:
                server.starttls(context=ssl.create_default_context())
                server.ehlo()
        with server:
            if args.smtp_user:
                server.login(args.smtp_user, args.smtp_password)
            server.send_message(message)
    except (OSError, smtplib.SMTPException) as error:
        raise SmokeTestError(f"SMTP 发信失败：{error}") from error
    print("已通过 SMTP 发送测试邮件，等待 Cloudflare Email Routing 投递。")


def wait_for_message(client: ApiClient, address: str, subject: str, wait_seconds: int) -> dict[str, Any]:
    encoded_address = urllib.parse.quote(address, safe="")
    deadline = time.monotonic() + wait_seconds
    while True:
        _, _, data = client.api("GET", f"/v1/messages?address={encoded_address}&limit=100", expected={200})
        page = successful_data(data, "查询临时邮箱邮件")
        if not isinstance(page.get("messages"), list):
            raise SmokeTestError("邮件列表未返回 messages 数组")
        for message in page["messages"]:
            if message.get("subject") == subject:
                return message
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise SmokeTestError(f"等待 {wait_seconds} 秒仍未收到测试邮件；请检查域名 MX、Cloudflare Email Routing 和 SMTP 发件状态")
        print(f"尚未收到测试邮件，{int(remaining)} 秒后超时…")
        time.sleep(min(5, remaining))


def run(client: ApiClient, args: argparse.Namespace) -> None:
    for docs_path in ("/v1/openapi.json", "/v1/openapi.yaml", "/v1/llms.txt", "/v1/error-codes"):
        client.request("GET", docs_path, expected={200})
    print("通过：公开 API 文档端点")

    account = create_account(client, args.domain.lower())
    _, _, data = client.request("GET", "/v1/accounts/me", token=account["token"], expected={200})
    _, _, data = client.request(
        "POST", "/v1/token", token=account["token"], payload={"address": account["address"]}, expected={200}
    )
    if not successful_data(data, "刷新临时 token").get("token"):
        raise SmokeTestError("临时 token 刷新失败")
    print("通过：临时 token 刷新")

    code = str(100000 + int(uuid.uuid4().hex[:8], 16) % 900000)
    subject = f"Cloud Mail 临时邮箱收件测试 {code}"
    if args.smtp_host:
        send_smtp(args, account["address"], subject, code)
    else:
        print("\n请从外部邮箱向以下临时邮箱发送一封邮件，然后按 Enter 开始轮询：")
        print(f"收件人：{account['address']}")
        print(f"主题：{subject}")
        input()

    message = wait_for_message(client, account["address"], subject, args.wait_seconds)
    message_id = message.get("id")
    if not message_id:
        raise SmokeTestError("收到的邮件缺少 id")
    print(f"通过：真实入站邮件已投递，消息 ID：{message_id}")

    address = urllib.parse.quote(account["address"], safe="")
    _, _, data = client.api("GET", f"/v1/messages/{message_id}?address={address}", expected={200})
    detail = successful_data(data, "查询入站邮件详情")
    if detail.get("subject") != subject or detail.get("verificationCode") != code:
        raise SmokeTestError("入站邮件详情或验证码提取结果不正确")
    print("通过：邮件详情和验证码提取")

    _, _, data = client.api("GET", f"/v1/sources/{message_id}?address={address}", expected={200})
    source = successful_data(data, "读取原始邮件")["data"]
    if not source:
        raise SmokeTestError("原始 RFC 822 邮件内容为空")
    print("通过：原始邮件读取")
    print("\n收到邮件的接口详情：")
    print(json.dumps(detail, ensure_ascii=False, indent=2))
    print("\n原始 RFC 822 邮件：")
    print(source)

    _, _, data = client.api("PATCH", f"/v1/messages/{message_id}?address={address}", {"starred": True}, expected={200})
    if successful_data(data, "标记星标").get("starred") is not True:
        raise SmokeTestError("邮件星标更新失败")
    print("通过：邮件状态更新")

    client.api("DELETE", f"/v1/messages/{message_id}?address={address}", expected={204})
    client.api("GET", f"/v1/messages/{message_id}?address={address}", expected={404})
    print("通过：邮件删除")


def main() -> int:
    parser = argparse.ArgumentParser(description="端到端测试已部署 Cloud Mail 临时邮箱的收件、查询和删除")
    parser.add_argument("--base-url", default=os.getenv("CLOUD_MAIL_BASE_URL"), help="部署地址，例如 https://mail.example.com")
    parser.add_argument("--api-key", default=os.getenv("CLOUD_MAIL_API_KEY"), help="带全部四项权限的 AC- API 密钥")
    parser.add_argument("--domain", default=os.getenv("CLOUD_MAIL_DOMAIN"), help="已启用 API 的临时邮箱域名")
    parser.add_argument("--wait-seconds", type=int, default=120, help="等待外部邮件投递的秒数，默认 120")
    parser.add_argument("--timeout", type=float, default=20, help="单个 HTTP/SMTP 请求超时秒数，默认 20")
    parser.add_argument("--smtp-host", help="SMTP 主机；指定后自动发送测试邮件")
    parser.add_argument("--smtp-port", type=int, default=587, help="SMTP 端口，默认 587")
    parser.add_argument("--smtp-user", help="SMTP 用户名；省略则不登录")
    parser.add_argument("--smtp-password", default=os.getenv("CLOUD_MAIL_SMTP_PASSWORD"), help="SMTP 密码；也可使用 CLOUD_MAIL_SMTP_PASSWORD")
    parser.add_argument("--smtp-from", help="SMTP 发件人地址")
    security = parser.add_mutually_exclusive_group()
    security.add_argument("--smtp-starttls", action="store_true", help="SMTP 使用 STARTTLS")
    security.add_argument("--smtp-ssl", action="store_true", help="SMTP 使用隐式 TLS")
    args = parser.parse_args()

    if not args.base_url or not args.api_key or not args.domain:
        parser.error("必须提供 --base-url、--api-key 和 --domain（支持 CLOUD_MAIL_* 环境变量）")
    if not args.api_key.startswith("AC-"):
        parser.error("--api-key 必须是 AC- API 密钥")
    if args.wait_seconds < 1:
        parser.error("--wait-seconds 必须至少为 1")
    if args.smtp_host:
        if not args.smtp_from:
            parser.error("指定 --smtp-host 时必须同时指定 --smtp-from")
        if bool(args.smtp_user) != bool(args.smtp_password):
            parser.error("SMTP 用户名和密码必须同时提供，或同时省略")

    client = ApiClient(args.base_url.rstrip("/"), args.api_key, args.timeout)
    try:
        run(client, args)
        print("\n全部临时邮箱收件、查询和删除测试通过。")
        return 0
    except SmokeTestError as error:
        print(f"\n测试失败：{error}", file=sys.stderr)
        return 1
    finally:
        client.cleanup()


if __name__ == "__main__":
    raise SystemExit(main())
