import { useEffect, useState } from "react";
import { api } from "../../../api";
import { Spinner } from "../../../ui";
import { isLive, type ResearchRun } from "../process/model";
import { Trail, Words } from "../process/Process";

export const getResearchRun = (id: string) =>
  api<ResearchRun>(`/research/runs/${id}`);

const POLL = 1200;

/**
 * One agent run in a window of its own (preparing an environment): every
 * step open, the words flowing while it works, its last words at the end.
 */
export function AgentRunView({ runId }: { runId: string }) {
  const [run, setRun] = useState<ResearchRun | null>(null);
  const [failed, setFailed] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    getResearchRun(runId).then(
      (value) => live && setRun(value),
      (error: unknown) =>
        live &&
        setFailed(error instanceof Error ? error.message : String(error)),
    );
    return () => {
      live = false;
    };
  }, [runId, tick]);

  const active = !run || isLive(run);
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => setTick((n) => n + 1), POLL);
    return () => window.clearTimeout(timer);
  }, [active, tick]);

  if (failed) return <p>{failed}</p>;
  if (!run) return <Spinner size={14} />;
  const lastSaid = [...run.steps].reverse().find((s) => s.said)?.said ?? "";
  const words =
    run.response && run.response.trim() !== lastSaid.trim() ? run.response : "";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Trail steps={run.steps} live={active} />
      {words && <Words text={words} live={active} />}
      {run.status === "failed" && run.error && <p>{run.error}</p>}
    </div>
  );
}
