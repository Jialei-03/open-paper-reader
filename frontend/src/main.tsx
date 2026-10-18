import { closeFileDownload } from "./lib/file-download";
import "./styles";
import { FileDownloadDialog } from "./components/FileDownloadDialog";
import {
  downloadUnsyncedNotes,
  forgetOfflineCopy,
  retireOfflineReading,
} from "./lib/offline-retirement";
import React, { Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ProductSite } from "./features/ProductSite";
import { Login } from "./features/Login";
import { AccountRecovery } from "./features/AccountRecovery";
import { useAppearance } from "./components/Appearance";
import { I18nProvider, useI18n } from "./i18n/I18nProvider";
import { api, errorStatus } from "./api";

/*
 * The entry carries only what a visitor needs before signing in: the public
 * site, sign-in and account recovery. The workspace (reader, editor, math,
 * graph…) is most of the code, so it loads once there is a session, and the
 * shared-paper viewer loads only for a share link.
 */
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
    return this.state.failed ? <StaleNotice /> : this.props.children;
  }
}

function StaleNotice() {
  const { t } = useI18n();
  return (
    <div className="boot">
      open-paper-reader <span>{t("boot.stale")}</span>
    </div>
  );
}

function Boot() {
  const { t } = useI18n();
  return (
    <div className="boot">
      open-paper-reader <span>{t("boot.opening")}</span>
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
    setSignedUser(value);
  };
  const [route, setRoute] = useState(location.hash.slice(1) || "dashboard");
  const routePath = route.split("?")[0];
  useEffect(() => {
    if (mayBeSignedIn()) void loadWorkspace();
    api("/auth/me")
      .then((x) => setUser(x.user))
      .catch((e) => {
        if (errorStatus(e) === 401) remember(false);
        else setError(e.message);
      })
      .finally(() => setBoot(false));
    const f = () => setRoute(location.hash.slice(1) || "dashboard");
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  const signedIn = !!user;
  useEffect(() => {
    if (!signedIn) return;
    void retireOfflineReading().then(async (unsynced) => {
      if (!unsynced.length) return;
      // The toaster lives in the workspace; show this once it is on screen.
      const [{ toast }] = await Promise.all([
        import("sonner"),
        loadWorkspace(),
      ]);
      setTimeout(
        () =>
          toast(
            `这台设备上有 ${unsynced.length} 篇离线时写下、尚未同步的笔记`,
            {
              description:
                "离线阅读已下线。请下载这些笔记的备份，再粘贴回对应论文。",
              duration: Infinity,
              action: {
                label: "下载备份",
                onClick: () => {
                  downloadUnsyncedNotes(unsynced);
                  forgetOfflineCopy();
                },
              },
            },
          ),
        1500,
      );
    });
  }, [signedIn]);
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
        onReset={() => {
          closeFileDownload();
          setUser(null);
        }}
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
  return !hash || hash === "#home" || hash === "#how" ? (
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
createRoot(document.getElementById("root")!).render(
  <I18nProvider>
    <Root />
    <FileDownloadDialog />
  </I18nProvider>,
);
