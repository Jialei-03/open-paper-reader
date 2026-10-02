import "./styles";
import { offlineOwner, setOfflineOwner } from "./lib/offline";
import React, { Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ProductSite } from "./features/ProductSite";
import { Login } from "./features/Login";
import { AccountRecovery } from "./features/AccountRecovery";
import { useAppearance } from "./components/Appearance";
import { api, errorStatus } from "./api";

/*
 * The entry carries only what a visitor needs before signing in: the public
 * site, sign-in and account recovery. The workspace (reader, editor, math,
 * graph…) is most of the code, so it loads once there is a session, and the
 * shared-paper viewer loads only for a share link.
 */
const OfflineWorkspace = lazy(() =>
  import("./features/OfflineWorkspace").then((module) => ({
    default: module.OfflineWorkspace,
  })),
);
const Workspace = lazy(() =>
  import("./Workspace").then((module) => ({ default: module.Workspace })),
);
// A device that was signed in a moment ago starts fetching the workspace while
// it asks who you are, instead of after the answer arrives.
const hint = "paper-signed-in";
const mayBeSignedIn = () => {
  try {
    return localStorage.getItem(hint) === "1";
  } catch {
    return false;
  }
};
const remember = (signedIn: boolean) => {
  try {
    if (signedIn) localStorage.setItem(hint, "1");
    else localStorage.removeItem(hint);
  } catch {
    /* Private browsing: the workspace simply loads after the session check. */
  }
};
const loadWorkspace = () => import("./Workspace");
const SharedPaper = lazy(() =>
  import("./features/PaperSharing").then((module) => ({
    default: module.SharedPaper,
  })),
);

/**
 * A tab opened before an update asks for module files the new release no longer
 * serves. Reload once to pick up the new page; if that fails too, say so
 * instead of showing a blank screen.
 */
class StaleRelease extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    if (
      !/dynamically imported module|Loading chunk|Importing a module script/i.test(
        error.message,
      )
    )
      return;
    try {
      if (sessionStorage.getItem("paper-stale-reload") === "1") return;
      sessionStorage.setItem("paper-stale-reload", "1");
      location.reload();
    } catch {
      /* Without storage a reload could loop, so leave the message showing. */
    }
  }
  render() {
    return this.state.failed ? (
      <div className="boot">
        纸间 <span>页面已更新，请刷新后继续</span>
      </div>
    ) : (
      this.props.children
    );
  }
}

function Boot() {
  return (
    <div className="boot">
      纸间 <span>正在打开你的空间…</span>
    </div>
  );
}

function AuthGate() {
  useAppearance();
  const [user, setSignedUser] = useState<any>(null),
    [boot, setBoot] = useState(true),
    [error, setError] = useState("");
  const setUser = (value: any) => {
    remember(!!value);
    setOfflineOwner(value?.id || "");
    setSignedUser(value);
  };
  const [route, setRoute] = useState(location.hash.slice(1) || "dashboard");
  const routePath = route.split("?")[0];
  useEffect(() => {
    if (mayBeSignedIn()) void loadWorkspace();
    api("/auth/me")
      .then((x) => setUser(x.user))
      .catch((e) => {
        if (errorStatus(e) === 401) {
          remember(false);
          setOfflineOwner("");
        } else if (errorStatus(e) === 0 && offlineOwner())
          location.hash = "offline";
        else setError(e.message);
      })
      .finally(() => setBoot(false));
    const f = () => setRoute(location.hash.slice(1) || "dashboard");
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  const signedOut = !boot && !user;
  useEffect(() => {
    if (!signedOut) return;
    // Someone at the sign-in form is about to need the workspace: fetch it as
    // soon as they touch the page, or after a few quiet seconds.
    const fetchIt = () => void loadWorkspace();
    const timer = setTimeout(fetchIt, 3000);
    window.addEventListener("keydown", fetchIt, { once: true });
    window.addEventListener("pointerdown", fetchIt, { once: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", fetchIt);
      window.removeEventListener("pointerdown", fetchIt);
    };
  }, [signedOut]);
  if (boot) return <Boot />;
  if (
    ["forgot-password", "reset-password"].includes(routePath) ||
    (user && routePath === "verify-email")
  )
    return (
      <AccountRecovery
        key={routePath}
        mode={routePath}
        onReset={() => setUser(null)}
      />
    );
  if (!user)
    return <Login error={error} setError={setError} onLogin={setUser} />;
  return (
    <StaleRelease>
      <Suspense fallback={<Boot />}>
        <Workspace
          user={user}
          setUser={setUser}
          error={error}
          setError={setError}
        />
      </Suspense>
    </StaleRelease>
  );
}

function Root() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const update = () => setHash(location.hash);
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  if (hash === "#offline" || (!navigator.onLine && offlineOwner()))
    return (
      <StaleRelease>
        <Suspense fallback={<Boot />}>
          <OfflineWorkspace />
        </Suspense>
      </StaleRelease>
    );
  return !hash ||
    hash === "#home" ||
    hash === "#features" ||
    hash.startsWith("#docs") ? (
    <ProductSite path={hash.slice(1) || "home"} />
  ) : hash.startsWith("#shared/") ? (
    <StaleRelease>
      <Suspense fallback={<Boot />}>
        <SharedPaper token={hash.slice(8)} />
      </Suspense>
    </StaleRelease>
  ) : (
    <AuthGate />
  );
}
createRoot(document.getElementById("root")!).render(<Root />);
