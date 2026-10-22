import {
  Check,
  Laptop,
  Plus,
  Server,
  Settings2,
  SquareTerminal,
} from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import { AppActions } from "../../app/AppSidebar";
import { useI18n } from "../../i18n/I18nProvider";
import { Button, IconButton, Menu } from "../../ui";
import { readModels, type ModelRow } from "../setup/model-api";
import { refreshResearchNavigation } from "./navigation-api";
import { workspaceMachine } from "./workspace-machine";
import { useResearchNavigation } from "./ResearchNavigation";
import { startProject } from "./research-api";
import { Composer } from "./talk/Composer";
import { ModelPicker } from "./talk/Pickers";
import { CollectionDialog } from "./ResearchLibrary";
import { WorkspacePicker } from "./WorkspaceDialogs";
import styles from "./Workspace.module.css";

function stored(key: string) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

export function NewResearch({
  workspaceId,
  collectionId,
  go,
}: {
  workspaceId?: string;
  collectionId?: string;
  go(hash: string): void;
}) {
  const { t } = useI18n();
  const { owner = "" } = useContext(AppActions);
  const { data, connections, ready, loading, error, reload } =
    useResearchNavigation();
  const [workspace, setWorkspace] = useState(
    workspaceId || stored(`research-workspace:${owner}`),
  );
  const [collection, setCollection] = useState(collectionId || "");
  const [creating, setCreating] = useState(false);
  const pendingWorkspace = useRef("");
  const current = data.workspaces.find(
    (item) => item.id === workspace && !item.archived,
  );
  const project = data.collections.find(
    (item) => item.id === collection && !item.archived,
  );
  const unavailable =
    ready &&
    !!workspaceId &&
    pendingWorkspace.current !== workspaceId &&
    !data.workspaces.some((item) => item.id === workspaceId && !item.archived);
  useEffect(() => {
    setWorkspace(workspaceId || stored(`research-workspace:${owner}`));
    setCollection(collectionId || "");
  }, [workspaceId, collectionId, owner]);
  const chooseContext = (nextWorkspace: string, nextCollection: string) => {
    pendingWorkspace.current = nextWorkspace;
    setWorkspace(nextWorkspace);
    setCollection(nextCollection);
    const params = new URLSearchParams();
    if (nextWorkspace) params.set("workspace", nextWorkspace);
    if (nextCollection) params.set("collection", nextCollection);
    go(`new${params.size ? `?${params}` : ""}`);
  };
  useEffect(() => {
    // Wait for real navigation data before changing the remembered folder.
    if (!ready || loading || error) return;
    // A missing explicit target must be selected again, never silently switch machines.
    if (unavailable) {
      setWorkspace("");
      return;
    }
    if (
      data.workspaces.some((item) => item.id === workspace && !item.archived)
    ) {
      pendingWorkspace.current = "";
    } else if (
      !pendingWorkspace.current ||
      workspace !== pendingWorkspace.current
    ) {
      const next = data.workspaces.find((item) => !item.archived)?.id || "";
      setWorkspace(next);
      if (!next) {
        try {
          localStorage.removeItem(`research-workspace:${owner}`);
        } catch {
          /* Optional preference. */
        }
      }
    }
  }, [workspace, data.workspaces, ready, loading, error, owner, unavailable]);
  useEffect(() => {
    if (current) {
      try {
        localStorage.setItem(`research-workspace:${owner}`, current.id);
      } catch {
        /* Optional preference. */
      }
    }
  }, [current, owner]);
  const machine = workspaceMachine(
    current?.location,
    connections,
    t("workspace.local"),
    t("workspace.remote"),
  );
  return (
    <main className={styles.newPage} data-testid="new-research">
      <div className={styles.newHeading}>
        <SquareTerminal
          className={styles.newHeadingIcon}
          size={46}
          strokeWidth={1.25}
          aria-hidden
        />
        <h1>
          {current
            ? t("workspace.startInQuestion", { name: current.name })
            : t("workspace.startQuestion")}
        </h1>
      </div>
      <div className={styles.startArea}>
        {!current && ready && (
          <section className={styles.workspaceStart}>
            {unavailable && <p role="alert">{t("workspace.notFound")}</p>}
            <p>{t("workspace.startHint")}</p>
            <ol>
              <li>{t("workspace.stepFolder")}</li>
              <li>{t("workspace.stepQuestion")}</li>
            </ol>
            <WorkspacePicker
              prominent
              value={workspace}
              onChange={(next) => chooseContext(next, collection)}
            />
          </section>
        )}
        <div className={styles.contextBar}>
          <div
            className={styles.newContextWorkspace}
            title={
              current
                ? `${current.name}\n${current.location.path}`
                : t("workspace.choose")
            }
          >
            <WorkspacePicker
              value={workspace}
              onChange={(next) => chooseContext(next, collection)}
            />
          </div>
          {current && (
            <span
              className={styles.device}
              title={`${machine.title}\n${current.location.path}`}
            >
              {current.location.kind === "ssh" ? (
                <Server size={14} aria-hidden />
              ) : (
                <Laptop size={14} aria-hidden />
              )}
              <span>{machine.label}</span>
            </span>
          )}
          <Menu
            label={t("workspace.classify")}
            items={[
              {
                id: "none",
                label: t("workspace.unclassified"),
                icon: !collection ? Check : undefined,
                onSelect: () => chooseContext(workspace, ""),
              },
              ...data.collections
                .filter((item) => !item.archived)
                .map((item) => ({
                  id: item.id,
                  label: item.name,
                  icon: collection === item.id ? Check : undefined,
                  onSelect: () => chooseContext(workspace, item.id),
                })),
              {
                id: "create",
                label: t("workspace.addCollection"),
                icon: Plus,
                onSelect: () => setCreating(true),
              },
            ]}
            trigger={(props) => (
              <IconButton
                className={styles.newContextSettings}
                icon={Settings2}
                size="sm"
                label={t("workspace.classify")}
                title={
                  project
                    ? `${t("workspace.classify")}: ${project.name}`
                    : t("workspace.optionalCollection")
                }
                {...props}
              />
            )}
          />
        </div>
        <FirstMessage
          key={owner}
          draftKey={`research-draft:${owner}:new`}
          legacyDraftKey={`research-draft:${owner}:new:${workspace}:${collection}`}
          workspaceId={current?.id || ""}
          collectionId={collection || null}
          go={go}
        />
        {error && (
          <p className={styles.error} role="alert">
            {error}{" "}
            <Button size="sm" variant="ghost" onClick={reload}>
              {t("common.retry")}
            </Button>
          </p>
        )}
      </div>
      {creating && (
        <CollectionDialog
          onClose={() => setCreating(false)}
          onCreated={(item) => {
            chooseContext(workspace, item.id);
            setCreating(false);
          }}
        />
      )}
    </main>
  );
}

function FirstMessage({
  draftKey,
  legacyDraftKey,
  workspaceId,
  collectionId,
  go,
}: {
  draftKey: string;
  legacyDraftKey: string;
  workspaceId: string;
  collectionId: string | null;
  go(hash: string): void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(
    () => stored(draftKey) || stored(legacyDraftKey),
  );
  const migratedDraft = useRef(stored(draftKey) ? "" : legacyDraftKey);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [modelId, setModelId] = useState(() => stored(`${draftKey}:model`));
  const [modelKnown, setModelKnown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    readModels().then(
      (value) => {
        if (!cancelled) {
          setModels(value.models);
          setModelKnown(true);
          setModelId((previous) =>
            value.models.some((model) => model.id === previous)
              ? previous
              : value.active_id || value.models[0]?.id || "",
          );
        }
      },
      (reason: unknown) => {
        if (!cancelled) {
          setModelKnown(true);
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    try {
      if (text) localStorage.setItem(draftKey, text);
      else localStorage.removeItem(draftKey);
      if (text && migratedDraft.current) {
        localStorage.removeItem(migratedDraft.current);
        migratedDraft.current = "";
      }
    } catch {
      /* The draft remains editable when storage is unavailable. */
    }
  }, [draftKey, text]);
  useEffect(() => {
    if (!modelId) return;
    try {
      localStorage.setItem(`${draftKey}:model`, modelId);
    } catch {
      /* Optional preference. */
    }
  }, [draftKey, modelId]);
  const send = async () => {
    if (!workspaceId || !modelId || !text.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const research = await startProject({
        message: text.trim(),
        workspace_id: workspaceId,
        collection_id: collectionId,
        model_config_id: modelId,
      });
      try {
        localStorage.removeItem(draftKey);
        localStorage.removeItem(legacyDraftKey);
      } catch {
        /* Optional cache. */
      }
      refreshResearchNavigation();
      go(`research/${research.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  };
  return (
    <div className={styles.firstMessage}>
      <Composer
        value={text}
        onChange={setText}
        onSend={send}
        label={t("workspace.firstMessage")}
        placeholder={t("workspace.firstPlaceholder")}
        sendLabel={t("research.home.send")}
        busy={busy}
        disabled={!workspaceId || !modelId}
        tools={
          <ModelPicker
            models={models}
            value={modelId}
            onChange={setModelId}
            label={t("research.home.model")}
          />
        }
        autoFocus
      />
      {modelKnown && !modelId && (
        <Button size="sm" variant="ghost" onClick={() => go("settings/models")}>
          {t("workspace.configureModel")}
        </Button>
      )}
      {!workspaceId && (
        <p className={styles.muted}>{t("workspace.selectFirst")}</p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
