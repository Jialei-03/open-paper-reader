import { Brand } from "../components/Brand";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useRef, useState, FormEvent } from "react";
import { BookOpen, ArrowUpRight, ShieldCheck, CircleAlert } from "lucide-react";
import { send } from "../api";
export function Login({
  error,
  setError,
  onLogin,
}: {
  error: string;
  setError: (s: string) => void;
  onLogin: (u: any) => void;
}) {
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
    <main className="login-page min-h-dvh flex flex-col items-center justify-center gap-8 bg-muted/40 p-6">
      <a href="#home" aria-label="纸间首页">
        <Brand />
      </a>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{register ? "创建账户" : "欢迎回来"}</CardTitle>
          {!register && (
            <CardDescription>登录后继续你的阅读与研究。</CardDescription>
          )}
          {register && (
            <CardDescription>创建你的论文工作空间。</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <CircleAlert />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <form ref={form} onSubmit={submit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="login-username">用户名</FieldLabel>
                <Input
                  id="login-username"
                  name="username"
                  autoComplete="username"
                  placeholder="输入用户名"
                  required
                  minLength={3}
                  maxLength={32}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="login-password">密码</FieldLabel>
                <Input
                  id="login-password"
                  name="password"
                  type="password"
                  required
                  minLength={register ? 8 : 1}
                  maxLength={256}
                  autoComplete={register ? "new-password" : "current-password"}
                />
                {register && (
                  <FieldDescription>至少 8 个字符。</FieldDescription>
                )}
              </Field>
              {register && (
                <Field>
                  <FieldLabel htmlFor="login-invitation">邀请码</FieldLabel>
                  <Input
                    id="login-invitation"
                    name="invitation"
                    autoComplete="off"
                    placeholder="没有可以留空"
                    maxLength={200}
                  />
                  <FieldDescription>
                    仅在站点要求邀请码时填写。
                  </FieldDescription>
                </Field>
              )}
              <Button type="submit" disabled={busy}>
                {busy && <Spinner data-icon="inline-start" />}
                {register ? "注册并进入空间" : "登录空间"}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
        <CardFooter className="flex-col gap-1">
          <Button
            variant="ghost"
            type="button"
            onClick={() => {
              setRegister(!register);
              setError("");
              // A password typed for one mode should never carry into the other.
              const password = form.current?.elements.namedItem("password");
              if (password instanceof HTMLInputElement) password.value = "";
            }}
          >
            {register ? "返回登录" : "创建账户"}
          </Button>
          {!register && (
            <Button asChild variant="link">
              <a href="#forgot-password">忘记用户名或密码？</a>
            </Button>
          )}
        </CardFooter>
      </Card>
    </main>
  );
}
