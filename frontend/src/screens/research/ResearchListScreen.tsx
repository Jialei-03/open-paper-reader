import { Check, ChevronDown, FlaskConical, Plus } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/i18n";
import { followLink } from "../../reader/route";
import {
  Button,
  Card,
  CardHeader,
  Menu,
  Spinner,
  TextArea,
  TextField,
  toast,
  type MenuEntry,
} from "../../ui";
import { readModels, type ModelRow } from "../setup/model-api";
import {
  createProject,
  listProjects,
  type ResearchProject,
} from "./research-api";
import { PlaybookPanel } from "./PlaybookPanel";
import styles from "./Research.module.css";

export interface ResearchListScreenProps {
  go(hash: string): void;
}

/** A project's state, in the reader's words. */
export const statusKey = (project: ResearchProject): MessageKey =>
  project.status === "finished"
    ? (`research.end.${project.end_reason || "stopped"}` as MessageKey)
    : (`research.status.${project.status}` as MessageKey);

/**
 * The research projects, newest activity first, and the form that starts one:
 * the question to answer, what the agent should know first, the model it
 * thinks with, and how many sprints it may take.
 */
export function ResearchListScreen({ go }: ResearchListScreenProps) {
  const { t, locale } = useI18n();
  const [projects, setProjects] = useState<ResearchProject[] | null>(null);
  const [failed, setFailed] = useState("");
  const [models, setModels] = useState<ModelRow[]>([]);
  const [modelId, setModelId] = useState("");
  const [question, setQuestion] = useState("");
  const [background, setBackground] = useState("");
  const [sprints, setSprints] = useState("30");
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    listProjects().then(
      (rows) => {
        setProjects(rows);
        if (rows.length === 0) setOpen(true);
      },
      (error: unknown) =>
        setFailed(error instanceof Error ? error.message : String(error)),
    );
    readModels().then(
      (settings) => {
        setModels(settings.models);
        setModelId(settings.active_id || settings.models[0]?.id || "");
      },
      () => {
        /* The form says there is no model. */
      },
    );
  }, []);

  const name = (row: ModelRow) => row.name || row.model;
  const current = models.find((row) => row.id === modelId);
  const modelItems: MenuEntry[] = models.map((row) => ({
    id: row.id,
    label: name(row),
    icon: row.id === modelId ? Check : undefined,
    onSelect: () => setModelId(row.id),
  }));
  const limit = Number.parseInt(sprints, 10);
  const valid =
    question.trim().length > 0 &&
    !!modelId &&
    Number.isInteger(limit) &&
    limit >= 1 &&
    limit <= 500;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || creating) return;
    setCreating(true);
    try {
      const project = await createProject({
        question: question.trim(),
        background: background.trim(),
        model_config_id: modelId,
        budget: { max_sprints: limit },
      });
      go(`research/${project.id}`);
    } catch (error) {
      toast.show({
        message: t("research.createFailed", {
          reason: error instanceof Error ? error.message : String(error),
        }),
        tone: "error",
      });
    } finally {
      setCreating(false);
    }
  };

  const time = (stamp: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(stamp));

  return (
    <Card as="main" className={styles.root} aria-labelledby="research-title">
      <div className={styles.frame}>
        <CardHeader>
          <h1 id="research-title" className={styles.heading}>
            {t("research.title")}
          </h1>
          <span className={styles.spacer} />
          {!open && (
            <Button size="sm" icon={Plus} onClick={() => setOpen(true)}>
              {t("research.new")}
            </Button>
          )}
        </CardHeader>
        <div className={styles.body}>
          <p className={styles.intro}>{t("research.intro")}</p>
          {open && (
            <form className={styles.form} onSubmit={submit}>
              <TextArea
                label={t("research.question")}
                description={t("research.question.hint")}
                value={question}
                autoGrow
                maxRows={4}
                autoFocus
                onChange={(event) => setQuestion(event.target.value)}
              />
              <TextArea
                label={t("research.background")}
                description={t("research.background.hint")}
                value={background}
                autoGrow
                maxRows={10}
                onChange={(event) => setBackground(event.target.value)}
              />
              <div className={styles.formRow}>
                <div className={styles.field}>
                  <span className={styles.caption}>{t("research.model")}</span>
                  {models.length ? (
                    <Menu
                      label={t("research.model")}
                      items={modelItems}
                      trigger={(props) => (
                        <Button {...props} size="sm" className={styles.picker}>
                          <span className={styles.pickerInner}>
                            {current ? name(current) : ""}
                            <ChevronDown size={12} aria-hidden="true" />
                          </span>
                        </Button>
                      )}
                    />
                  ) : (
                    <p className={styles.hint}>
                      {t("research.noModel")}{" "}
                      <a href="#settings" onClick={followLink(go, "settings")}>
                        {t("research.toSettings")}
                      </a>
                    </p>
                  )}
                </div>
                <TextField
                  label={t("research.maxSprints")}
                  inputMode="numeric"
                  value={sprints}
                  className={styles.narrow}
                  onChange={(event) =>
                    setSprints(event.target.value.replace(/\D/g, ""))
                  }
                />
              </div>
              <div className={styles.actions}>
                {projects && projects.length > 0 && (
                  <Button variant="ghost" onClick={() => setOpen(false)}>
                    {t("common.cancel")}
                  </Button>
                )}
                <Button
                  type="submit"
                  variant="primary"
                  icon={FlaskConical}
                  loading={creating}
                  disabled={!valid}
                >
                  {t("research.start")}
                </Button>
              </div>
            </form>
          )}
          {failed ? (
            <p className={styles.error} role="alert">
              {t("research.loadFailed", { reason: failed })}
            </p>
          ) : projects === null ? (
            <p className={styles.loading} role="status" aria-busy="true">
              <Spinner size={14} />
              {t("common.loading")}
            </p>
          ) : (
            <ul className={styles.projects}>
              {projects.map((project) => (
                <li key={project.id}>
                  <a
                    className={styles.project}
                    href={`#research/${project.id}`}
                    onClick={followLink(go, `research/${project.id}`)}
                  >
                    <span className={styles.projectQuestion}>
                      {project.question}
                    </span>
                    <span className={styles.projectMeta}>
                      <span
                        className={styles.state}
                        data-status={project.status}
                      >
                        {t(statusKey(project))}
                      </span>
                      <span>
                        {t("research.sprintsUsed", {
                          used: project.spent.sprints,
                          max: project.budget.max_sprints,
                        })}
                      </span>
                      <span>{time(project.updated_at)}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
          {projects && projects.length > 0 && <PlaybookPanel />}
        </div>
      </div>
    </Card>
  );
}
