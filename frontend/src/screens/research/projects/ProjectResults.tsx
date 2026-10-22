import { useEffect, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider";
import { followLink } from "../../../reader/route";
import { Button, Spinner } from "../../../ui";
import {
  projectMemories,
  projectMerges,
  type ProjectMemory,
  type ResearchMerge,
} from "../research-api";
import { Prose } from "../talk/ThreadView";
import styles from "../ResearchChanges.module.css";

export function ProjectResults({
  workspaceId,
  refreshKey,
  go,
}: {
  workspaceId: string;
  refreshKey: number;
  go(hash: string): void;
}) {
  const { t, locale } = useI18n();
  const [memories, setMemories] = useState<ProjectMemory[] | null>(null);
  const [merges, setMerges] = useState<ResearchMerge[] | null>(null);
  const [error, setError] = useState("");
  const [reads, setReads] = useState(0);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      projectMemories(workspaceId),
      projectMerges(workspaceId),
    ]).then(
      ([memory, records]) => {
        if (!cancelled) {
          setMemories(memory);
          setMerges(records.filter((item) => item.status === "applied"));
          setError("");
        }
      },
      (reason: unknown) =>
        !cancelled &&
        setError(reason instanceof Error ? reason.message : String(reason)),
    );
    return () => {
      cancelled = true;
    };
  }, [workspaceId, refreshKey, reads]);
  const when = (stamp: string) =>
    Number.isFinite(Date.parse(stamp))
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(stamp))
      : "—";
  return (
    <div className={styles.results}>
      {error && (
        <p className={styles.error} role="alert">
          {error}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setReads((n) => n + 1)}
          >
            {t("common.retry")}
          </Button>
        </p>
      )}
      {!memories && !error && <Spinner />}
      <section>
        <h2>{t("research.merge.memory")}</h2>
        {memories?.length === 0 && (
          <p className={styles.empty}>{t("projects.results.noMemory")}</p>
        )}
        {memories?.map((memory) => {
          const hash = `research/${memory.research_id}`;
          return (
            <details key={memory.path} className={styles.memory}>
              <summary>
                <span>{memory.title}</span>
                <code>{memory.commit_sha.slice(0, 10)}</code>
                <time dateTime={memory.updated_at}>
                  {when(memory.updated_at)}
                </time>
              </summary>
              <div>
                {memory.research_id && (
                  <a href={`#${hash}`} onClick={followLink(go, hash)}>
                    {t("projects.kind.research")} · {memory.title}
                  </a>
                )}
                <p>
                  <code>{memory.path}</code>
                </p>
                {memory.merge_commit_sha &&
                  memory.merge_commit_sha !== memory.commit_sha && (
                    <p>
                      {t("research.merge.applied")}{" "}
                      <code>{memory.merge_commit_sha.slice(0, 12)}</code>
                    </p>
                  )}
                <Prose text={memory.text} />
              </div>
            </details>
          );
        })}
      </section>
      <section>
        <h2>{t("research.merge.history")}</h2>
        {merges?.length === 0 && (
          <p className={styles.empty}>{t("projects.results.noMerges")}</p>
        )}
        {merges?.map((merge) => {
          const id = merge.research_id || merge.project_id;
          const hash = `research/${id}`;
          return (
            <details key={merge.id} className={styles.memory}>
              <summary>
                <span>{merge.question}</span>
                <span>
                  {t(
                    merge.kind === "memory"
                      ? "research.merge.memory"
                      : "research.merge.code",
                  )}
                </span>
                <code>{merge.commit_sha.slice(0, 10)}</code>
                <time dateTime={merge.created_at}>
                  {when(merge.created_at)}
                </time>
              </summary>
              <div>
                {id && (
                  <a href={`#${hash}`} onClick={followLink(go, hash)}>
                    {t("projects.kind.research")} · {merge.question}
                  </a>
                )}
                <div className={styles.resultPaths}>
                  {merge.paths.map((path) => (
                    <code key={path}>{path}</code>
                  ))}
                </div>
                {merge.files.map((file) => (
                  <details key={file.path} className={styles.diff}>
                    <summary>{file.path}</summary>
                    {file.truncated && (
                      <p className={styles.warning}>
                        {t("research.merge.truncated")}
                      </p>
                    )}
                    <pre>{file.diff}</pre>
                  </details>
                ))}
              </div>
            </details>
          );
        })}
      </section>
    </div>
  );
}
