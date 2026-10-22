import { FolderPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider";
import { followLink } from "../../../reader/route";
import {
  Button,
  Dialog,
  Spinner,
  TextArea,
  TextField,
  toast,
} from "../../../ui";
import {
  createWorkspace,
  listWorkspaces,
  type WorkspaceRow,
} from "../research-api";
import styles from "./Projects.module.css";

/**
 * The research projects, as cards: what each is about, how many researches
 * it holds, and what in it needs the researcher. A project opens on its board.
 */
export function ProjectsHome({ go }: { go(hash: string): void }) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<WorkspaceRow[] | null>(null);
  const [making, setMaking] = useState(false);
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [failed, setFailed] = useState("");
  const [reads, setReads] = useState(0);
  const [search, setSearch] = useState("");

  useEffect(() => {
    listWorkspaces().then(
      (items) => {
        setRows(items);
        setFailed("");
      },
      (error: unknown) =>
        setFailed(error instanceof Error ? error.message : String(error)),
    );
  }, [reads]);

  const when = (stamp: string) =>
    new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(
      new Date(stamp),
    );
  const visible = (rows ?? []).filter((w) =>
    `${w.name} ${w.description}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );
  const main = visible.filter((w) => !w.archived && w.kind === "research");
  const rest = visible.filter((w) => w.archived || w.kind !== "research");

  const make = async () => {
    setBusy(true);
    try {
      const w = await createWorkspace(name.trim(), about.trim());
      go(`projects/${w.id}`);
    } catch (error) {
      toast.show({
        message: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
      setBusy(false);
    }
  };

  const card = (w: WorkspaceRow) => (
    <a
      key={w.id}
      href={`#projects/${w.id}`}
      className={styles.project}
      onClick={followLink(go, `projects/${w.id}`)}
    >
      <span className={styles.projectName}>{w.name}</span>
      <span className={styles.projectAbout}>
        {w.description || t("projects.noDescription")}
      </span>
      <span className={styles.projectFoot}>
        {w.waiting > 0 && (
          <span className={styles.badge} data-tone="you">
            {t("projects.waiting", { n: w.waiting })}
          </span>
        )}
        {w.running > 0 && (
          <span className={styles.badge} data-tone="live">
            {t("projects.running", { n: w.running })}
          </span>
        )}
        <span>{t("projects.researches", { n: w.researches })}</span>
        <span className={styles.spacer} />
        <span>{when(w.active_at)}</span>
      </span>
    </a>
  );

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <header className={styles.head}>
          <h1 className={styles.title}>{t("projects.title")}</h1>
          <Button
            variant="primary"
            icon={FolderPlus}
            onClick={() => setMaking(true)}
          >
            {t("projects.new")}
          </Button>
        </header>
        {rows && rows.length > 0 && (
          <TextField
            type="search"
            label={t("projects.search")}
            hideLabel
            placeholder={t("projects.search")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        )}
        {failed && (
          <p className={styles.empty}>
            {failed}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setReads((n) => n + 1)}
            >
              {t("common.retry")}
            </Button>
          </p>
        )}
        {!rows && !failed && <Spinner />}
        {rows && main.length === 0 && !failed && !search && (
          <p className={styles.empty}>{t("projects.empty")}</p>
        )}
        <div className={styles.grid}>{main.map(card)}</div>
        {rest.length > 0 && (
          <section className={styles.rest}>
            <button
              type="button"
              className={styles.restToggle}
              aria-expanded={more}
              onClick={() => setMore(!more)}
            >
              {t("projects.other", { n: rest.length })}
            </button>
            {more && <div className={styles.grid}>{rest.map(card)}</div>}
          </section>
        )}
      </div>
      <Dialog
        open={making}
        onClose={() => setMaking(false)}
        title={t("projects.new")}
        description={t("projects.newLead")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setMaking(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!name.trim()}
              onClick={make}
            >
              {t("projects.create")}
            </Button>
          </>
        }
      >
        <div className={styles.form}>
          <TextField
            label={t("projects.name")}
            value={name}
            placeholder={t("projects.namePlaceholder")}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
          <TextArea
            label={t("projects.about")}
            value={about}
            rows={3}
            placeholder={t("projects.aboutPlaceholder")}
            onChange={(e) => setAbout(e.target.value)}
          />
        </div>
      </Dialog>
    </div>
  );
}
