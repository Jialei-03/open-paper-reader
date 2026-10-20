import { Pause, Play, SkipBack, SkipForward, Smile } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useI18n } from "../../../i18n/I18nProvider";
import type { MessageKey } from "../../../i18n/i18n";
import { Button, IconButton, SegmentedControl } from "../../../ui";
import type { Turn } from "../conversation";
import { describeStep, type Described } from "../describe";
import type { ResearchNode } from "../research-api";
import { buildFrames, type Agent, type Frame } from "./frames";
import { Mascot } from "./Mascot";
import { poseFor } from "./pose";
import { AREA, areaStyle, figure, IsoRoomArt, pct, SPOT } from "./IsoRoom";
import { MascotDialog } from "./MascotDialog";
import { loadLooks, type Look } from "./mascots";
import styles from "./scene.module.css";

const AGENTS: Agent[] = ["executor", "system", "advisor", "distiller"];
const ROLE: Record<Agent, MessageKey> = {
  executor: "research.role.executor",
  advisor: "research.role.advisor",
  system: "research.role.system",
  distiller: "research.role.distiller",
};
const SPEEDS = ["1", "2", "4"] as const;
const BEAT = 1800;

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

interface Beat {
  frame: Frame;
  said: Described;
}

/**
 * The project as a scene: each agent at its place, acting out the record one step
 * at a time. The executor works at the bench, the advisor at the desk, the system
 * keeps the gate between them; what each does travels to where it lands.
 */
export function ResearchScene({
  turns,
  nodes,
  live,
  onLog,
}: {
  turns: Turn[];
  nodes: ResearchNode[];
  /** The project is still running: new steps play as they arrive. */
  live: boolean;
  onLog(jobId: string): void;
}) {
  const { t } = useI18n();
  const beats = useMemo<Beat[]>(
    () =>
      buildFrames(turns).flatMap((frame) => {
        const said = frame.step
          ? describeStep(t, frame.step)
          : {
              label: t("research.talk.handoff"),
              note: frame.handoff,
              meta: "",
              tone: "" as const,
              jobId: "",
            };
        return said ? [{ frame, said }] : [];
      }),
    [turns, t],
  );
  const still = reducedMotion();
  const [index, setIndex] = useState(() =>
    still ? Math.max(beats.length - 1, 0) : 0,
  );
  const [playing, setPlaying] = useState(!still);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>("1");
  const [looks, setLooks] = useState(loadLooks);
  const [dressing, setDressing] = useState(false);

  const last = beats.length - 1;
  const at = Math.min(index, Math.max(last, 0));
  const beat = beats[at];

  // Advance on a timer; at the end of a live project, wait for the next step.
  useEffect(() => {
    if (!playing || at >= last) {
      if (playing && !live && at >= last && last >= 0) setPlaying(false);
      return;
    }
    const pause = (beat?.frame.handoff ? BEAT * 1.4 : BEAT) / Number(speed);
    const timer = window.setTimeout(() => setIndex(at + 1), pause);
    return () => window.clearTimeout(timer);
  }, [playing, at, last, live, speed, beat]);

  if (!beat) return <p className={styles.empty}>{t("research.scene.empty")}</p>;

  const { frame, said } = beat;
  const name = (agent: Agent) => looks[agent]?.name || t(ROLE[agent]);
  const lastCommand = [...beats.slice(0, at + 1)]
    .reverse()
    .find((b) => b.frame.step?.action === "run_job")?.said.note;
  const lastVerdict = [...beats.slice(0, at + 1)]
    .reverse()
    .find((b) => b.frame.who === "advisor" && b.frame.step?.action === "advice")
    ?.said.label;
  const distillerSeen = beats
    .slice(0, at + 1)
    .some((b) => b.frame.who === "distiller");
  // Everyone sits; the shiba gets up and steps in front of the gate while on duty.
  const where = (agent: Agent) => {
    const pose = poseFor(agent, frame);
    const spot = figure(agent, agent === "system" && pose !== "idle");
    // A figure is 24 room pixels tall; a perched one shows its top 81%.
    return { pose, spot, head: spot.y - (spot.perched ? 19.5 : 24) };
  };
  // What the actor did travels from above its head to where it lands.
  const flight =
    frame.to && !still
      ? {
          from: { x: where(frame.who).spot.x, y: where(frame.who).head },
          to: SPOT[frame.to],
        }
      : null;

  return (
    <div className={styles.scene}>
      <div className={styles.stage} aria-hidden="true">
        <IsoRoomArt />
        <span
          className={styles.doorSign}
          style={areaStyle(AREA.door)}
          data-lit={frame.to === "person" || undefined}
        >
          {t("research.scene.place.person")}
        </span>
        <code className={styles.screen} style={areaStyle(AREA.screen)}>
          {lastCommand ? `$ ${lastCommand}` : "$ _"}
        </code>
        {lastVerdict && (
          <span className={styles.deskNote} style={areaStyle(AREA.note)}>
            {lastVerdict}
          </span>
        )}
        <Board
          nodes={nodes}
          current={frame.step?.node ?? ""}
          lit={frame.to === "board"}
        />

        {AGENTS.map((agent) => {
          if (agent === "distiller" && !distillerSeen) return null;
          const { pose, spot } = where(agent);
          return (
            <div
              key={agent}
              className={styles.agent}
              data-agent={agent}
              data-active={frame.who === agent || undefined}
              data-pose={pose}
              data-perched={spot.perched || undefined}
              style={
                {
                  ...pct(spot.x, spot.y),
                  // Nearer the viewer stands in front; furniture nearer still hides it.
                  zIndex: 2 + Math.round(spot.depth),
                } as CSSProperties
              }
            >
              <div className={styles.figure}>
                <Mascot
                  agent={agent}
                  look={looks[agent]}
                  pose={pose}
                  size={80}
                />
              </div>
            </div>
          );
        })}

        {/* Names and words float above the room, so no desk hides them. */}
        {AGENTS.map((agent) => {
          if (agent === "distiller" && !distillerSeen) return null;
          const { spot, head } = where(agent);
          const active = frame.who === agent;
          return (
            <div
              key={`label-${agent}`}
              className={styles.label}
              data-agent={agent}
              data-active={active || undefined}
              style={pct(spot.x, head) as CSSProperties}
            >
              {active && (
                <div
                  className={styles.bubble}
                  data-tone={said.tone || undefined}
                  key={frame.key}
                >
                  <strong>{said.label}</strong>
                  {frame.step?.node && (
                    <span className={styles.bubbleNode}>{frame.step.node}</span>
                  )}
                </div>
              )}
              <span className={styles.name}>{name(agent)}</span>
            </div>
          );
        })}

        {flight && (
          <span
            key={frame.key}
            className={styles.token}
            data-kind={
              frame.handoff
                ? "paper"
                : frame.step?.action === "advice"
                  ? "stamp"
                  : "dot"
            }
            style={
              {
                "--x0": pct(flight.from.x, flight.from.y).left,
                "--y0": pct(flight.from.x, flight.from.y).top,
                "--x1": pct(flight.to.x, flight.to.y).left,
                "--y1": pct(flight.to.x, flight.to.y).top,
                "--fly": `${Math.round(900 / Number(speed))}ms`,
              } as CSSProperties
            }
          />
        )}
      </div>

      <div className={styles.controls}>
        <IconButton
          icon={SkipBack}
          label={t("research.scene.prev")}
          size="sm"
          disabled={at === 0}
          onClick={() => {
            setPlaying(false);
            setIndex(at - 1);
          }}
        />
        <IconButton
          icon={playing ? Pause : Play}
          label={t(playing ? "research.scene.pause" : "research.scene.play")}
          size="sm"
          onClick={() => {
            if (!playing && at >= last && !live) setIndex(0);
            setPlaying(!playing);
          }}
        />
        <IconButton
          icon={SkipForward}
          label={t("research.scene.next")}
          size="sm"
          disabled={at >= last}
          onClick={() => {
            setPlaying(false);
            setIndex(at + 1);
          }}
        />
        <input
          className={styles.scrub}
          type="range"
          min={0}
          max={Math.max(last, 0)}
          value={at}
          aria-label={t("research.scene.progress")}
          onChange={(event) => {
            setPlaying(false);
            setIndex(Number(event.target.value));
          }}
        />
        <span className={styles.counter}>
          {t("research.scene.step", { index: at + 1, total: beats.length })}
        </span>
        <SegmentedControl
          kind="radio"
          size="sm"
          label={t("research.scene.speed")}
          value={speed}
          onChange={setSpeed}
          options={SPEEDS.map((value) => ({ value, label: `${value}×` }))}
        />
        <Button
          size="sm"
          variant="ghost"
          icon={Smile}
          onClick={() => setDressing(true)}
        >
          {t("research.scene.looks")}
        </Button>
      </div>

      <div
        className={styles.caption}
        aria-live="polite"
        data-tone={said.tone || undefined}
      >
        <div className={styles.captionHead}>
          <Mascot agent={frame.who} look={looks[frame.who]} size={24} />
          <span className={styles.captionWho}>{name(frame.who)}</span>
          {frame.sprint !== null && (
            <span className={styles.captionSprint}>
              {t("research.sprint", { number: frame.sprint })}
            </span>
          )}
        </div>
        <p className={styles.captionLabel}>
          <strong>{said.label}</strong>
          {frame.step?.node && (
            <span className={styles.bubbleNode}>{frame.step.node}</span>
          )}
          {said.meta && <span className={styles.captionMeta}>{said.meta}</span>}
          {said.jobId && (
            <button
              type="button"
              className={styles.captionLink}
              onClick={() => onLog(said.jobId)}
            >
              {t("research.talk.log")}
            </button>
          )}
        </p>
        {said.note && <p className={styles.captionNote}>{said.note}</p>}
      </div>

      <MascotDialog
        open={dressing}
        looks={looks}
        onChange={setLooks}
        onClose={() => setDressing(false)}
      />
    </div>
  );
}

/** The research map on the whiteboard, the node in play marked. */
function Board({
  nodes,
  current,
  lit,
}: {
  nodes: ResearchNode[];
  current: string;
  lit: boolean;
}) {
  return (
    <ul
      className={styles.board}
      style={areaStyle(AREA.board)}
      data-lit={lit || undefined}
    >
      {nodes.slice(0, 7).map((node) => (
        <li
          key={node.id}
          data-status={node.status}
          data-current={node.title === current || undefined}
          style={{ paddingInlineStart: node.parent_id ? 10 : 0 }}
        >
          <span className={styles.boardDot} />
          {node.title}
        </li>
      ))}
    </ul>
  );
}
