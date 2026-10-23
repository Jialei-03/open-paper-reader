import {
  ArrowLeft,
  Copy,
  MoreHorizontal,
  Plus,
  Workflow as WorkflowIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { Button, Dialog, IconButton, Menu, TextField } from "../../ui";
import { CustomizeHeader } from "../customize/CustomizeHeader";
import { useResearchNavigation } from "../research/ResearchNavigation";
import { getTeam, type Team } from "../research/team-api";
import { WorkspacePicker } from "../research/WorkspaceDialogs";
import { workflowMembers } from "../team/TeamSettings";
import { WorkflowView } from "../team/workflow/WorkflowView";
import type { Workflow as RuleWorkflow } from "../team/workflow/workflow-model";
import settingStyles from "../team/TeamSettings.module.css";
import {
  createWorkflow,
  deleteWorkflow,
  readWorkflows,
  ruleWorkflow,
  updateWorkflow,
  workflowName,
  type Workflow,
} from "./workflows-api";
import styles from "./Workflows.module.css";

export function WorkflowsSection() {
  const { t } = useI18n();
  const { data } = useResearchNavigation();
  const [workspaceId, setWorkspaceId] = useState("");
  const workspace =
    workspaceId || data.workspaces.find((w) => !w.archived)?.id || "";
  const [team, setTeam] = useState<Team | null>(null);
  const [items, setItems] = useState<Workflow[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [reads, setReads] = useState(0);
  const [draft, setDraft] = useState<RuleWorkflow | null>(null);
  const [copyFrom, setCopyFrom] = useState<string>();
  const [deleting, setDeleting] = useState<Workflow | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let stale = false;
    readWorkflows().then(
      (value) => {
        if (!stale) setItems(value);
      },
      (reason: unknown) => !stale && setError(String(reason)),
    );
    return () => {
      stale = true;
    };
  }, [reads]);
  useEffect(() => {
    if (!workspace) return;
    let stale = false;
    getTeam(workspace).then(
      (value) => !stale && setTeam(value),
      (reason: unknown) => !stale && setError(String(reason)),
    );
    return () => {
      stale = true;
    };
  }, [workspace]);
  const open = (item?: Workflow, copy = false) => {
    setCopyFrom(item && (item.builtin || copy) ? item.id : undefined);
    setDraft(
      item
        ? {
            ...ruleWorkflow(item),
            ...(copy || item.builtin
              ? {
                  id: `w-${crypto.randomUUID()}`,
                  builtin: false,
                  version: 1,
                  name: t("workflows.copyName", {
                    name: workflowName(item, t),
                  }),
                }
              : {}),
          }
        : {
            id: `w-${crypto.randomUUID()}`,
            name: "",
            version: 1,
            builtin: false,
            rules: [],
            layout: { members: {}, channels: {} },
          },
    );
  };
  if (draft)
    return (
      <div>
        <div className={styles.form}>
          <div>
            <Button
              variant="ghost"
              icon={ArrowLeft}
              onClick={() => setDraft(null)}
            >
              {t("workflows.title")}
            </Button>
          </div>
          <WorkspacePicker value={workspace} onChange={setWorkspaceId} />
          <TextField
            label={t("workflows.name")}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          {error && <p role="alert">{error}</p>}
          <Button
            variant="secondary"
            loading={busy}
            disabled={!draft.name.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                if (items?.some((w) => w.id === draft.id))
                  await updateWorkflow(draft.id, draft);
                else
                  await createWorkflow({
                    ...draft,
                    ...(copyFrom ? { copy_from: copyFrom } : {}),
                  });
                setDraft(null);
                setReads((n) => n + 1);
                setError("");
              } catch (reason) {
                setError(String(reason));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("details.save")}
          </Button>
        </div>
        <div className={settingStyles.editor}>
          <WorkflowView
            workflow={draft}
            onChange={setDraft}
            members={team ? workflowMembers(team, t) : []}
            channels={
              team?.channels.map((c) => ({
                id: c.id,
                name: c.name,
                kind: c.member_id ? "dm" : "channel",
              })) || []
            }
          />
        </div>
      </div>
    );
  return (
    <div className={styles.manager}>
      <CustomizeHeader
        title={t("workflows.title")}
        query={query}
        onQuery={setQuery}
        action={
          <Button
            variant="primary"
            size="sm"
            icon={Plus}
            onClick={() => open()}
          >
            {t("workflows.create")}
          </Button>
        }
      />
      {error && <p role="alert">{error}</p>}
      {!items ? (
        <div className={styles.skeleton} aria-label={t("common.loading")} />
      ) : (
        <ul className={styles.list}>
          {items
            .filter((w) =>
              workflowName(w, t).toLowerCase().includes(query.toLowerCase()),
            )
            .map((item) => (
              <li key={item.id} className={styles.row}>
                <WorkflowIcon aria-hidden />
                <button className={styles.name} onClick={() => open(item)}>
                  {workflowName(item, t)}
                </button>
                <span className={styles.status}>
                  {item.builtin
                    ? t("workflows.builtin")
                    : t("workflows.version", { n: item.version })}
                </span>
                <Menu
                  label={t("customize.more", { name: workflowName(item, t) })}
                  items={[
                    {
                      id: "copy",
                      label: t("workflows.copy"),
                      icon: Copy,
                      onSelect: () => open(item, true),
                    },
                    ...(!item.builtin
                      ? [
                          {
                            id: "delete",
                            label: t("details.delete"),
                            danger: true,
                            onSelect: () => setDeleting(item),
                          },
                        ]
                      : []),
                  ]}
                  trigger={(props) => (
                    <IconButton
                      {...props}
                      icon={MoreHorizontal}
                      label={t("customize.more", {
                        name: workflowName(item, t),
                      })}
                    />
                  )}
                />
              </li>
            ))}
        </ul>
      )}
      <Dialog
        open={!!deleting}
        title={t("workflows.deleteQuestion")}
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={async () => {
                if (!deleting) return;
                setBusy(true);
                try {
                  await deleteWorkflow(deleting.id);
                  setDeleting(null);
                  setReads((n) => n + 1);
                } catch (reason) {
                  setError(String(reason));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("details.delete")}
            </Button>
          </>
        }
      />
    </div>
  );
}
