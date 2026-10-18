import { useState, useEffect, FormEvent } from "react";
import { api, send } from "../api";
import { Button as OldButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useI18n } from "../i18n/I18nProvider";
import { Button, TextField } from "../ui";
import { AuthFrame } from "./AuthFrame";
import styles from "./auth.module.css";

export function AccountRecovery({
  mode,
  onReset,
}: {
  mode: string;
  onReset: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const reset = mode === "reset-password";
  const verify = mode === "verify-email";
  const kind = verify ? "verify" : reset ? "reset" : "request";
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    if (reset && f.get("password") !== f.get("confirm")) {
      setError(t("recovery.mismatch"));
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
    <AuthFrame
      title={t(`recovery.title.${kind}`)}
      lead={
        reset
          ? undefined
          : t(verify ? "recovery.lead.verify" : "recovery.lead.request")
      }
    >
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {message ? (
        <p className={styles.notice} role="status">
          {message}
        </p>
      ) : (
        <form className={styles.form} onSubmit={submit}>
          {reset && (
            <>
              <TextField
                name="password"
                type="password"
                label={t("recovery.password")}
                description={t("recovery.password.hint")}
                autoComplete="new-password"
                minLength={8}
                maxLength={256}
                required
              />
              <TextField
                name="confirm"
                type="password"
                label={t("recovery.confirm")}
                autoComplete="new-password"
                required
              />
            </>
          )}
          {!verify && !reset && (
            <TextField
              name="email"
              type="email"
              label={t("recovery.email")}
              description={t("recovery.email.hint")}
              autoComplete="email"
              required
            />
          )}
          <Button
            type="submit"
            variant="primary"
            className={styles.submit}
            loading={busy}
          >
            {busy ? t("recovery.busy") : t(`recovery.submit.${kind}`)}
          </Button>
        </form>
      )}
      <div className={styles.links}>
        <a className={styles.link} href={verify ? "#settings" : "#dashboard"}>
          {verify ? t("recovery.back.verify") : t("recovery.back")}
        </a>
      </div>
    </AuthFrame>
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
            <OldButton
              type="submit"
              variant="outline"
              disabled={!enabled || busy}
            >
              {busy ? "正在发送…" : "发送邮箱验证链接"}
            </OldButton>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
