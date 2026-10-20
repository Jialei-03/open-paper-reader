import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, send, type Paper } from "../api";
import { clearPaperCovers } from "../features/PaperCover";
import { I18nProvider, useI18n } from "../i18n/I18nProvider";
import { closeFileDownload } from "../lib/file-download";
import {
  downloadUnsyncedNotes,
  forgetOfflineCopy,
  retireOfflineReading,
} from "../lib/offline-retirement";
import { recentPapers } from "../lib/recent-papers";
import { useMediaQuery } from "../reader/useMediaQuery";
import { useModel } from "../reader/useModel";
import { DiscoverScreen } from "../screens/discover/DiscoverScreen";
import { HomeScreen } from "../screens/HomeScreen";
import { LibraryScreen } from "../screens/LibraryScreen";
import { OpenScreen } from "../screens/open/OpenScreen";
import {
  CATEGORIES,
  SettingsWindow,
  type SettingsCategory,
} from "../screens/settings/SettingsWindow";
import { SetupScreen } from "../screens/SetupScreen";
import {
  Shell,
  Spinner,
  Toaster,
  currentPlatformIsMac,
  matchesShortcut,
  toast,
} from "../ui";
import { AppActions, AppSidebar, QUICK_OPEN_SHORTCUT } from "./AppSidebar";
import styles from "./AppShell.module.css";
import { QuickOpen } from "./QuickOpen";
import { parseAppRoute, type AppRoute } from "./routes";
import { ProjectPage } from "../screens/research/projects/ProjectPage";
import { ProjectsHome } from "../screens/research/projects/ProjectsHome";
import { ResearchProject } from "../screens/research/ResearchProject";

// The reader is most of the code: it loads as a chunk of its own, when a paper is opened.
const ReaderScreen = lazy(() =>
  import("../reader/ReaderScreen").then((module) => ({
    default: module.ReaderScreen,
  })),
);

/** Below this the sidebar is a rail of icons that floats open over the cards (as in the reader). */
const SIDEBAR_FLOATS = "(max-width: 899.98px)";

type User = { id: string; username?: string };

/** The current address, read; one that is not the app's own is replaced where it stands. */
function readRoute(): AppRoute {
  const route = parseAppRoute(location.hash.slice(1));
  if (route.redirect)
    history.replaceState(history.state, "", "#" + route.redirect);
  return route;
}

/**
 * The signed-in app: home, the library, the settings and the reader, on the
 * new interface. It holds the library's papers for every screen, sends the
 * addresses of what has been taken out home, and opens the first-run setup
 * when there is no model to read with.
 */
export function AppShell(props: { user: User; setUser: (user: null) => void }) {
  return (
    <I18nProvider>
      <App {...props} />
    </I18nProvider>
  );
}

function App({ user, setUser }: { user: User; setUser: (user: null) => void }) {
  const { t, tn } = useI18n();
  const [route, setRoute] = useState(readRoute);
  // The settings are a window over what was open: that stays drawn beneath.
  const under = useRef<{ route: AppRoute; hash: string }>({
    route: { screen: "home" },
    hash: "home",
  });
  if (route.screen !== "settings")
    under.current = { route, hash: location.hash.slice(1) || "home" };
  const [papers, setPapers] = useState<Paper[]>([]);
  const [tick, setTick] = useState(0);
  const [quickOpen, setQuickOpen] = useState(false);
  const [setupDone, setSetupDone] = useState(false);
  // This machine's own server (`mode: "local"`) has one person and no session to end.
  const [local, setLocal] = useState(false);
  const floating = useMediaQuery(SIDEBAR_FLOATS);
  useEffect(() => {
    const controller = new AbortController();
    api<{ mode?: string }>("/health", { signal: controller.signal }).then(
      (health) => setLocal(health.mode === "local"),
      () => {
        /* Without an answer the sign-out stays: it is the safer way to be wrong. */
      },
    );
    return () => controller.abort();
  }, []);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  const go = useCallback((hash: string) => {
    location.hash = hash;
  }, []);

  useEffect(() => {
    // The app loaded, so a stale-release reload (see main.tsx) worked.
    try {
      sessionStorage.removeItem("paper-stale-reload");
    } catch {
      /* Storage may be unavailable. */
    }
  }, []);

  useLayoutEffect(() => {
    const changed = () => setRoute(readRoute());
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);

  // The library, read again with each screen, on reload(), and when the window comes back.
  const screenKey =
    route.screen === "reader" ? `read/${route.reader.paperId}` : route.screen;
  useEffect(() => {
    const controller = new AbortController();
    api<Paper[]>("/papers", { signal: controller.signal }).then(
      setPapers,
      () => {
        /* The screens say for themselves what they could not load. */
      },
    );
    return () => controller.abort();
  }, [tick, screenKey]);
  useEffect(() => {
    const focus = () => reload();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [reload]);

  // Notes written offline before offline reading went away: offered once, as a backup to download.
  useEffect(() => {
    void retireOfflineReading().then((unsynced) => {
      if (!unsynced.length) return;
      toast.show({
        message: tn("app.offline.unsynced", unsynced.length),
        description: t("app.offline.description"),
        duration: Infinity,
        action: {
          label: t("app.offline.download"),
          onClick: () => {
            downloadUnsyncedNotes(unsynced);
            forgetOfflineCopy();
          },
        },
      });
    });
  }, [t, tn]);

  useEffect(() => {
    const mac = currentPlatformIsMac();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing || event.defaultPrevented) return;
      if (!matchesShortcut(event, QUICK_OPEN_SHORTCUT, mac)) return;
      event.preventDefault();
      setQuickOpen((open) => !open);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await send("/auth/logout", {});
    } catch (error) {
      toast.show({
        message:
          error instanceof Error ? error.message : t("app.signOutFailed"),
        tone: "error",
      });
      return;
    }
    closeFileDownload();
    void clearPaperCovers();
    setUser(null);
  }, [setUser, t]);

  const actions = useMemo(
    () => ({
      owner: user.id,
      quickOpen: () => setQuickOpen(true),
      signOut: local ? undefined : () => void signOut(),
    }),
    [signOut, local, user.id],
  );
  const visits = useMemo(
    () => recentPapers(user.id),
    // Read again whenever the screen changes: the reader writes them.
    [user.id, screenKey, quickOpen],
  );

  const shown: AppRoute =
    route.screen === "settings" ? under.current.route : route;
  const category = (
    route.screen === "settings" &&
    CATEGORIES.includes(route.category as SettingsCategory)
      ? route.category
      : "general"
  ) as SettingsCategory;
  const settings = route.screen === "settings" && (
    <SettingsWindow
      category={category}
      onCategory={(next) => go(`settings/${next}`)}
      onClose={() => go(under.current.hash)}
      go={go}
    />
  );
  const quick = (
    <QuickOpen
      open={quickOpen}
      onClose={() => setQuickOpen(false)}
      papers={papers}
      visits={visits}
      go={go}
    />
  );

  if (shown.screen === "reader")
    return (
      <AppActions.Provider value={actions}>
        <div className={styles.reader} data-app-screen="reader">
          <Suspense fallback={<Loading />}>
            <ReaderScreen
              paperId={shown.reader.paperId}
              route={shown.reader}
              go={go}
              owner={user.id}
              papers={papers}
            />
          </Suspense>
        </div>
        {quick}
        {settings}
      </AppActions.Provider>
    );

  if (shown.screen === "open")
    return (
      <div data-app-screen="open">
        <OpenScreen url={shown.url} go={go} reload={reload} />
        <Toaster />
      </div>
    );

  const screen = (
    <AppActions.Provider value={actions}>
      <div className={styles.root} data-app-screen={shown.screen}>
        <Shell
          sidebar={
            <AppSidebar
              floating={floating}
              screen={route.screen}
              papers={papers}
              visits={visits}
              go={go}
            />
          }
        >
          {shown.screen === "home" && (
            <HomeScreen
              owner={user.id}
              papers={papers}
              go={go}
              reload={reload}
            />
          )}
          {shown.screen === "library" && (
            <LibraryScreen
              owner={user.id}
              papers={papers}
              go={go}
              reload={reload}
            />
          )}
          {shown.screen === "discover" && (
            <DiscoverScreen papers={papers} go={go} reload={reload} />
          )}
          {shown.screen === "research" && shown.projectId && (
            <ResearchProject
              key={shown.projectId}
              id={shown.projectId}
              go={go}
            />
          )}
          {shown.screen === "projects" &&
            (shown.workspaceId ? (
              <ProjectPage
                key={shown.workspaceId}
                id={shown.workspaceId}
                tab={shown.tab}
                go={go}
              />
            ) : (
              <ProjectsHome go={go} />
            ))}
        </Shell>
        <Toaster />
      </div>
      {quick}
      {settings}
    </AppActions.Provider>
  );
  return shown.screen === "home" && !setupDone ? (
    <SetupGate onDone={() => setSetupDone(true)}>{screen}</SetupGate>
  ) : (
    screen
  );
}

/**
 * Home, unless there is no model to read with: then the first thing is to set
 * one up. Only home asks (the library, the settings and the reader stay
 * reachable), and only while it shows, so the reader reads the settings anew.
 */
function SetupGate({
  onDone,
  children,
}: {
  onDone: () => void;
  children: ReactNode;
}) {
  const model = useModel();
  // Once it is showing, the setup stays until it is done with: a model saved on the way does not take it away.
  const [needed, setNeeded] = useState(false);
  const missing = model.known && !model.id;
  useEffect(() => {
    if (missing) setNeeded(true);
  }, [missing]);
  if (!needed && !missing) return model.known ? children : <Loading />;
  return (
    <div className={styles.root} data-app-screen="setup">
      <SetupScreen
        onDone={() => {
          onDone();
          window.dispatchEvent(new Event("model-settings-updated"));
        }}
      />
      <Toaster />
    </div>
  );
}

/** What shows while the reader's chunk loads. */
function Loading() {
  const { t } = useI18n();
  return (
    <div
      role="status"
      aria-label={t("common.loading")}
      className={styles.loading}
    >
      <Spinner />
    </div>
  );
}
