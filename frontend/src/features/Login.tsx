import { useRef, useState, type FormEvent } from "react";
import { send } from "../api";
import { useI18n } from "../i18n/I18nProvider";
import { Button, TextField } from "../ui";
import { AuthFrame } from "./AuthFrame";
import styles from "./auth.module.css";

export function Login({
  error,
  setError,
  onLogin,
}: {
  error: string;
  setError: (s: string) => void;
  onLogin: (u: any) => void;
}) {
  const { t } = useI18n();
  const [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false),
    form = useRef<HTMLFormElement>(null);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    const data = { username: f.get("username"), password: f.get("password") };
    const invitation = String(f.get("invitation") || "").trim();
    try {
      if (register)
        await send("/auth/register", {
          ...data,
          // Only sent when filled in: a site that is open to anyone does not need it.
          ...(invitation ? { invitation } : {}),
        });
      const r = await send("/auth/login", data);
      onLogin(r.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthFrame
      title={register ? t("login.title.register") : t("login.title")}
      lead={register ? t("login.lead.register") : t("login.lead")}
    >
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <form ref={form} className={styles.form} onSubmit={submit}>
        <TextField
          name="username"
          label={t("login.username")}
          autoComplete="username"
          placeholder={t("login.username.placeholder")}
          required
          minLength={3}
          maxLength={32}
        />
        <TextField
          name="password"
          type="password"
          label={t("login.password")}
          description={register ? t("login.password.hint") : undefined}
          required
          minLength={register ? 8 : 1}
          maxLength={256}
          autoComplete={register ? "new-password" : "current-password"}
        />
        {register && (
          <TextField
            name="invitation"
            label={t("login.invitation")}
            description={t("login.invitation.hint")}
            placeholder={t("login.invitation.placeholder")}
            autoComplete="off"
            maxLength={200}
          />
        )}
        <Button
          type="submit"
          variant="primary"
          className={styles.submit}
          loading={busy}
        >
          {register ? t("login.submit.register") : t("login.submit")}
        </Button>
      </form>
      <div className={styles.links}>
        <button
          type="button"
          className={styles.link}
          onClick={() => {
            setRegister(!register);
            setError("");
            // A password typed for one mode should never carry into the other.
            const password = form.current?.elements.namedItem("password");
            if (password instanceof HTMLInputElement) password.value = "";
          }}
        >
          {register ? t("login.toLogin") : t("login.toRegister")}
        </button>
        {!register && (
          <a className={styles.link} href="#forgot-password">
            {t("login.forgot")}
          </a>
        )}
      </div>
    </AuthFrame>
  );
}
