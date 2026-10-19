import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/i18n";
import { readerHash } from "../../reader/route";
import { buildTree, type TreeNode } from "./map-tree";
import type {
  Evidence,
  ResearchJob,
  ResearchNode,
  ResultEntry,
} from "./research-api";
import styles from "./Research.module.css";

export interface ResearchMapProps {
  nodes: ResearchNode[];
  jobs: ResearchJob[];
  /** The node the current sprint is working on. */
  focusId: string | null;
  onLog(jobId: string): void;
}

const tokens = (value: number) =>
  value >= 1000 ? `${Math.round(value / 1000)}k` : String(value);

/**
 * The research map as an indented tree: what each node is, how far it got,
 * how sure the agent is; open one to see what it must not be (its kill
 * condition), the evidence for and against it, its doubts and its cost.
 */
export function ResearchMap({ nodes, jobs, focusId, onLog }: ResearchMapProps) {
  const { t } = useI18n();
  const tree = useMemo(() => buildTree(nodes), [nodes]);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpened((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const evidence = (item: Evidence, key: number) =>
    item.kind === "log" ? (
      <li key={key} className={styles.evidence}>
        <button
          type="button"
          className={styles.linkButton}
          onClick={() => onLog(item.job_id)}
        >
          {t("research.evidence.log", {
            from: item.from_line,
            to: item.to_line,
          })}
        </button>
        <pre className={styles.lines}>{item.lines.join("\n")}</pre>
      </li>
    ) : (
      <li key={key} className={styles.evidence}>
        {item.paper_id ? (
          <a
            href={readerHash({
              paperId: item.paper_id,
              fileId: item.file_id,
              page: item.page,
              quote: item.quote,
            })}
          >
            {t("research.evidence.cite", { page: item.page })}
          </a>
        ) : (
          <span>{t("research.evidence.cite", { page: item.page })}</span>
        )}
        <blockquote className={styles.quote}>{item.quote}</blockquote>
      </li>
    );

  const results = (title: MessageKey, entries: ResultEntry[]) =>
    entries.length > 0 && (
      <section className={styles.results}>
        <h4 className={styles.detailTitle}>{t(title)}</h4>
        {entries.map((entry, index) => (
          <div key={index} className={styles.result}>
            <p>{entry.summary}</p>
            <ul className={styles.evidenceList}>
              {entry.evidence.map(evidence)}
            </ul>
          </div>
        ))}
      </section>
    );

  const row = (node: TreeNode, depth: number) => {
    const open = opened.has(node.id);
    const nodeJobs = jobs.filter((job) => job.node_id === node.id);
    return (
      <li key={node.id}>
        <button
          type="button"
          className={styles.node}
          style={{ paddingInlineStart: `calc(${depth} * 20px + 8px)` }}
          aria-expanded={open}
          data-status={node.status}
          data-focus={node.id === focusId || undefined}
          onClick={() => toggle(node.id)}
        >
          <ChevronRight
            size={14}
            aria-hidden="true"
            className={styles.chevron}
            data-open={open || undefined}
          />
          <span className={styles.dot} aria-hidden="true" />
          <span className={styles.nodeText}>
            <span className={styles.nodeTitle}>{node.title}</span>
            <span className={styles.nodeInfo}>
              <span className={styles.kind}>
                {t(`research.kind.${node.kind}` as MessageKey)}
              </span>
              {(node.value || node.cost) && (
                <span className={styles.estimate}>
                  {t("research.estimate", {
                    value: node.value
                      ? t(`research.level.${node.value}` as MessageKey)
                      : "?",
                    cost: node.cost
                      ? t(`research.level.${node.cost}` as MessageKey)
                      : "?",
                  })}
                </span>
              )}
              <span className={styles.nodeMeta}>
                {t(`research.node.${node.status}` as MessageKey)}
                {" · "}
                {Math.round(node.confidence * 100)}%
              </span>
            </span>
          </span>
        </button>
        {open && (
          <div
            className={styles.detail}
            style={{ marginInlineStart: `calc(${depth} * 20px + 30px)` }}
          >
            {node.kill_if && (
              <p>
                <strong>{t("research.killIf")}</strong> {node.kill_if}
              </p>
            )}
            {node.doubts.length > 0 && (
              <section>
                <h4 className={styles.detailTitle}>{t("research.doubts")}</h4>
                <ul>
                  {node.doubts.map((doubt, index) => (
                    <li key={index}>{doubt}</li>
                  ))}
                </ul>
              </section>
            )}
            {results("research.evidenceFor", node.evidence_for)}
            {results("research.evidenceAgainst", node.evidence_against)}
            {nodeJobs.length > 0 && (
              <section>
                <h4 className={styles.detailTitle}>{t("research.jobs")}</h4>
                <ul className={styles.jobList}>
                  {nodeJobs.map((job) => (
                    <li key={job.id}>
                      <button
                        type="button"
                        className={styles.linkButton}
                        onClick={() => onLog(job.id)}
                      >
                        <code>{job.command.slice(0, 80)}</code>
                      </button>{" "}
                      {t(`research.job.${job.status}` as MessageKey)}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <p className={styles.cost}>
              {t("research.cost", {
                tokens: tokens(node.spent_tokens),
                seconds: node.spent_job_seconds,
              })}
            </p>
          </div>
        )}
        {node.children.length > 0 && (
          <ul className={styles.tree}>
            {node.children.map((child) => row(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <ul className={styles.tree} aria-label={t("research.map")}>
      {tree.map((node) => row(node, 0))}
    </ul>
  );
}
