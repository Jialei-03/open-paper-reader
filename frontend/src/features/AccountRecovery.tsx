import { useState, useEffect, FormEvent } from "react";
import { api, send } from "../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function AccountRecovery({
  mode,
  onReset,
}: {
  mode: string;
  onReset: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const reset = mode === "reset-password";
  const verify = mode === "verify-email";
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    if (reset && f.get("password") !== f.get("confirm")) {
      setError("两次密码不一致");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const token =
        new URLSearchParams(location.hash.split("?")[1]).get("token") || "";
      const result = await send(
        verify
          ? "/auth/email/confirm"
          : reset
            ? "/auth/password-reset/complete"
            : "/auth/password-reset/request",
        verify
          ? { token }
          : reset
            ? { token, password: f.get("password") }
            : { email: f.get("email") },
      );
      setMessage(result.message);
      if (reset) onReset();
      if (verify || reset) history.replaceState(null, "", "#" + mode);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="min-h-dvh grid place-items-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            {verify ? "验证找回邮箱" : reset ? "设置新密码" : "找回账号与密码"}
          </CardTitle>
          <CardDescription>
            {verify
              ? "确认后，此邮箱可用于找回当前登录账号。"
              : "使用已验证的邮箱找回账号。"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {message ? (
            <Alert>
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          ) : (
            <form onSubmit={submit}>
              <FieldGroup>
                {!verify &&
                  (reset ? (
                    <>
                      <Field>
                        <FieldLabel htmlFor="reset-password">新密码</FieldLabel>
                        <Input
                          id="reset-password"
                          name="password"
                          type="password"
                          autoComplete="new-password"
                          minLength={8}
                          maxLength={256}
                          required
                        />
                        <FieldDescription>至少 8 个字符。</FieldDescription>
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="reset-confirm">
                          确认新密码
                        </FieldLabel>
                        <Input
                          id="reset-confirm"
                          name="confirm"
                          type="password"
                          autoComplete="new-password"
                          required
                        />
                      </Field>
                    </>
                  ) : (
                    <Field>
                      <FieldLabel htmlFor="recovery-email">找回邮箱</FieldLabel>
                      <Input
                        id="recovery-email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        required
                      />
                      <FieldDescription>
                        请输入在账户设置中验证过的邮箱。
                      </FieldDescription>
                    </Field>
                  ))}
                <Button type="submit" disabled={busy}>
                  {busy
                    ? "正在处理…"
                    : verify
                      ? "确认绑定邮箱"
                      : reset
                        ? "重置密码"
                        : "发送找回邮件"}
                </Button>
              </FieldGroup>
            </form>
          )}
        </CardContent>
        <CardFooter>
          <Button asChild variant="ghost">
            <a href={verify ? "#settings" : "#dashboard"}>
              {verify ? "返回账户设置" : "返回登录"}
            </a>
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}

export function AccountSettings({
  user,
}: {
  user: { username: string; email: string | null; email_verified: boolean };
}) {
  const [account, setAccount] = useState(user);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ user: typeof user }>("/auth/me")
      .then((r) => setAccount(r.user))
      .catch((e) => setError(e.message));
    api<{ email_recovery_enabled: boolean }>("/auth/options")
      .then((r) => setEnabled(r.email_recovery_enabled))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <Card>
      <CardHeader>
        <CardTitle>账户与找回</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-2">
          用户名：<strong>{account.username}</strong>
        </p>
        <p className="mb-4">
          找回邮箱：{account.email || "未绑定"}
          {account.email &&
            (account.email_verified ? "（已验证）" : "（待验证，尚不能找回）")}
        </p>
        {!enabled && (
          <Alert className="mb-4">
            <AlertDescription>
              邮件服务尚未配置，暂时无法绑定邮箱或发送找回邮件。
            </AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {message && (
          <Alert className="mb-4">
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            setMessage("");
            try {
              const r = await send("/auth/email/request", {
                email: f.get("email"),
                password: f.get("password"),
              });
              setMessage(r.message);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <FieldGroup className="max-w-md">
            <Field>
              <FieldLabel htmlFor="bind-email">找回邮箱</FieldLabel>
              <Input
                id="bind-email"
                type="email"
                name="email"
                defaultValue={account.email || ""}
                autoComplete="email"
                required
                disabled={!enabled}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="bind-password">当前密码</FieldLabel>
              <Input
                id="bind-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                disabled={!enabled}
              />
            </Field>
            <Button type="submit" variant="outline" disabled={!enabled || busy}>
              {busy ? "正在发送…" : "发送邮箱验证链接"}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
