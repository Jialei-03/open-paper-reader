import {
  Background,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeProps,
} from "@xyflow/react";
import {
  Clock3,
  Hash,
  MessageSquare,
  Plus,
  Scan,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider";
import { Button, Dialog, IconButton } from "../../../ui";
import { MemberAvatar } from "../MemberEditor";
import {
  connectionToRule,
  edgeToRule,
  layoutFromNodes,
  newRule,
  nodeId,
  recentFired,
  ruleSummary,
  updateCanvasNodes,
  workflowToFlow,
  type WorkflowDataProps,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowNodeTarget,
  type WorkflowRule,
  type WorkflowRuntime,
} from "./workflow-model";
import "@xyflow/react/dist/style.css";
import styles from "./Workflow.module.css";

export interface WorkflowCanvasProps extends WorkflowDataProps {
  runtime?: WorkflowRuntime;
  onEdit(rule: WorkflowRule): void;
  onCreate(rule: WorkflowRule): void;
  onOpenNode?(target: WorkflowNodeTarget): void;
}
const DRAG_TYPE = "application/x-ora-workflow-node";

function CanvasNode({ data }: NodeProps<WorkflowNode>) {
  const { t } = useI18n();
  const name =
    data.kind === "owner" || data.human
      ? t("teamWorkflow.me")
      : data.kind === "trigger"
        ? data.name || t(`teamWorkflow.event.${data.event ?? "message"}`)
        : data.name;
  return (
    <div
      className={`${styles.node} ${data.kind === "channel" ? styles.channelNode : ""} ${data.kind === "trigger" ? styles.triggerNode : ""}`}
    >
      <Handle type="target" position={Position.Left} id="in" />
      {data.kind === "trigger" ? (
        data.event === "schedule" ? (
          <Clock3 size={16} aria-hidden />
        ) : (
          <MessageSquare size={16} aria-hidden />
        )
      ) : data.kind === "channel" ? (
        <Hash size={16} aria-hidden />
      ) : (
        <MemberAvatar
          member={data.member}
          seed={data.member?.avatar_seed ?? data.ref}
        />
      )}
      <span className={styles.nodeName}>{name}</span>
      {data.status && (
        <span className={styles.nodeStatus} data-status={data.status}>
          <i aria-hidden />
          {t(`teamWorkflow.status.${data.status}`)}
        </span>
      )}
      <Handle type="source" position={Position.Right} id="out" />
      <Handle
        type="source"
        position={Position.Bottom}
        id="return-out"
        isConnectable={false}
        className={styles.returnOut}
      />
      <Handle
        type="target"
        position={Position.Bottom}
        id="return-in"
        isConnectable={false}
        className={styles.returnIn}
      />
    </div>
  );
}
const nodeTypes = { workflow: CanvasNode };

function Canvas({
  workflow,
  readOnly = false,
  members,
  channels,
  runtime,
  onChange,
  onEdit,
  onCreate,
  onOpenNode,
}: WorkflowCanvasProps) {
  const { t } = useI18n();
  const flow = useReactFlow<WorkflowNode>();
  const graph = useMemo(
    () => workflowToFlow(workflow, members, channels),
    [workflow, members, channels],
  );
  const [nodes, setNodes] = useState(graph.nodes);
  const [selected, setSelected] = useState<WorkflowNode | null>(null);
  const [fired, setFired] = useState<Set<string>>(new Set());
  useEffect(() => setNodes(graph.nodes), [graph.nodes]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      const now = Date.now();
      setFired(recentFired(runtime, now));
      const remaining = (runtime?.fired ?? [])
        .map((item) => Date.parse(item.at) + 1600 - now)
        .filter((ms) => ms > 0);
      if (remaining.length)
        timer = setTimeout(update, Math.min(...remaining) + 1);
    };
    update();
    return () => clearTimeout(timer);
  }, [runtime?.fired]);
  const edges = graph.edges.map((edge) => {
    const rule = edgeToRule(edge, workflow)!;
    const kind = edge.data!.kind;
    const active = rule.enabled && fired.has(rule.id);
    const label = t(
      kind === "return"
        ? "teamWorkflow.return"
        : kind === "subscription"
          ? "teamWorkflow.subscription"
          : kind === "schedule"
            ? "teamWorkflow.event.schedule"
            : `teamWorkflow.action.${kind}`,
    );
    return {
      ...edge,
      label,
      ariaLabel: `${label}: ${ruleSummary(rule, members, channels, t)}`,
      animated: active,
      className: `${active ? styles.fired : ""} ${!rule.enabled ? styles.paused : ""} ${kind === "return" ? styles.returnEdge : ""}`,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: active ? "var(--ui-success-text)" : "var(--ui-fg-2)",
      },
      domAttributes: {
        onKeyDown: (event: React.KeyboardEvent<SVGGElement>) => {
          if (
            (event.key === "Enter" || event.key === " ") &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            event.stopPropagation();
            onEdit(rule);
          }
        },
      },
    };
  });
  const addNode = (
    target: WorkflowNodeTarget,
    position = flow.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    }),
  ) => {
    const exists =
      target.kind === "member"
        ? members.some((member) => member.id === target.id)
        : channels.some((channel) => channel.id === target.id);
    if (!exists || !Number.isFinite(position.x) || !Number.isFinite(position.y))
      return;
    const layout = {
      ...workflow.layout,
      [target.kind === "member" ? "members" : "channels"]: {
        ...workflow.layout[target.kind === "member" ? "members" : "channels"],
        [target.id]: position,
      },
    };
    onChange({ ...workflow, layout });
  };
  const openNode = (node: WorkflowNode) => {
    if (node.data.kind === "trigger") {
      const rule = workflow.rules.find((rule) => rule.id === node.data.ref);
      if (rule) onEdit(rule);
    } else if (
      onOpenNode &&
      (node.data.kind === "member" || node.data.kind === "channel")
    ) {
      onOpenNode({ kind: node.data.kind, id: node.data.ref });
    } else setSelected(node);
  };
  const entityName =
    selected?.data.kind === "owner"
      ? t("teamWorkflow.me")
      : (selected?.data.name ?? "");
  return (
    <div className={styles.canvasLayout}>
      <aside
        className={styles.palette}
        aria-label={t("teamWorkflow.nodeActions")}
      >
        {(["member", "channel"] as const).map((kind) => (
          <div key={kind} className={styles.paletteGroup}>
            <h2>
              {t(
                kind === "member"
                  ? "teamWorkflow.members"
                  : "teamWorkflow.channels",
              )}
            </h2>
            {(kind === "member"
              ? members
              : channels.filter((c) => c.kind !== "dm")
            ).map((entity) => (
              <Button
                key={entity.id}
                variant="ghost"
                icon={kind === "channel" ? Hash : Plus}
                draggable={!readOnly}
                aria-label={t("teamWorkflow.addNode", { name: entity.name })}
                disabled={
                  readOnly ||
                  nodes.some((node) => node.id === nodeId(kind, entity.id))
                }
                onClick={() => addNode({ kind, id: entity.id })}
                onDragStart={(event) => {
                  event.dataTransfer.setData(
                    DRAG_TYPE,
                    JSON.stringify({ kind, id: entity.id }),
                  );
                  event.dataTransfer.effectAllowed = "copy";
                }}
              >
                {entity.name}
              </Button>
            ))}
          </div>
        ))}
      </aside>
      <div
        className={styles.canvas}
        data-testid="workflow-canvas"
        onKeyDownCapture={(event) => {
          if (
            event.nativeEvent.isComposing ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.target !==
              (event.target as Element).closest(".react-flow__node")
          )
            return;
          const node = nodes.find(
            (node) => node.id === (event.target as HTMLElement).dataset.id,
          );
          if (node && ["Enter", " "].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            openNode(node);
          } else if (
            !readOnly &&
            node?.draggable !== false &&
            node &&
            ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
              event.key,
            )
          ) {
            event.preventDefault();
            event.stopPropagation();
            const step = event.shiftKey ? 40 : 10;
            const next = nodes.map((item) =>
              item.id === node.id
                ? {
                    ...item,
                    position: {
                      x:
                        item.position.x +
                        (event.key === "ArrowLeft"
                          ? -step
                          : event.key === "ArrowRight"
                            ? step
                            : 0),
                      y:
                        item.position.y +
                        (event.key === "ArrowUp"
                          ? -step
                          : event.key === "ArrowDown"
                            ? step
                            : 0),
                    },
                  }
                : item,
            );
            setNodes(next);
            onChange(layoutFromNodes(workflow, next));
          }
        }}
      >
        <ReactFlow<WorkflowNode, WorkflowEdge>
          nodes={nodes.map((node) => ({
            ...node,
            draggable: readOnly ? false : node.draggable,
            connectable: !readOnly,
            ariaLabel:
              node.data.kind === "trigger"
                ? `${t(`teamWorkflow.event.${node.data.event ?? "message"}`)} ${node.data.name}`
                : node.data.kind === "owner" || node.data.human
                  ? t("teamWorkflow.me")
                  : node.data.name,
            data: {
              ...node.data,
              status:
                node.data.kind === "member"
                  ? (runtime?.members[node.data.ref] ?? "idle")
                  : undefined,
            },
          }))}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.25}
          maxZoom={2}
          nodesFocusable
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          edgesFocusable
          connectOnClick
          deleteKeyCode={null}
          colorMode="system"
          onNodesChange={(changes) => {
            setNodes(
              updateCanvasNodes(
                workflow,
                nodes,
                changes,
                readOnly ? () => undefined : onChange,
              ),
            );
          }}
          onConnect={(connection) => {
            if (readOnly) return;
            const rule = connectionToRule(
              connection,
              nodes,
              `r-${crypto.randomUUID()}`,
            );
            if (rule) onCreate(rule);
          }}
          isValidConnection={(connection) =>
            !!connectionToRule(
              {
                ...connection,
                sourceHandle: connection.sourceHandle ?? null,
                targetHandle: connection.targetHandle ?? null,
              },
              nodes,
              "draft",
            )
          }
          onNodeClick={(_, node) => openNode(node)}
          onEdgeClick={(_, edge) => {
            const rule = edgeToRule(edge, workflow);
            if (rule) onEdit(rule);
          }}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes(DRAG_TYPE)) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (readOnly) return;
            try {
              const value: unknown = JSON.parse(
                event.dataTransfer.getData(DRAG_TYPE),
              );
              if (
                value &&
                typeof value === "object" &&
                "kind" in value &&
                "id" in value &&
                (value.kind === "member" || value.kind === "channel") &&
                typeof value.id === "string"
              )
                addNode(
                  { kind: value.kind, id: value.id },
                  flow.screenToFlowPosition({
                    x: event.clientX,
                    y: event.clientY,
                  }),
                );
            } catch {
              /* Ignore unrelated or malformed drag payloads. */
            }
          }}
          aria-label={t("teamWorkflow.canvas")}
          ariaLabelConfig={{
            "node.a11yDescription.default": t("teamWorkflow.nodeKeyboard"),
            "node.a11yDescription.keyboardDisabled": t(
              "teamWorkflow.nodeKeyboard",
            ),
            "edge.a11yDescription.default": t("teamWorkflow.edgeKeyboard"),
          }}
        >
          <Background color="var(--ui-edge)" />
        </ReactFlow>
        <div className={styles.canvasControls}>
          <IconButton
            icon={ZoomIn}
            label={t("teamWorkflow.zoomIn")}
            onClick={() => void flow.zoomIn()}
          />
          <IconButton
            icon={ZoomOut}
            label={t("teamWorkflow.zoomOut")}
            onClick={() => void flow.zoomOut()}
          />
          <IconButton
            icon={Scan}
            label={t("teamWorkflow.fit")}
            onClick={() => void flow.fitView()}
          />
        </div>
      </div>
      <Dialog
        open={selected !== null}
        title={entityName}
        onClose={() => setSelected(null)}
        size="sm"
        footer={
          <>
            {onOpenNode &&
              selected &&
              (selected.data.kind === "member" ||
                selected.data.kind === "channel") && (
                <Button
                  onClick={() => {
                    onOpenNode({
                      kind: selected.data.kind as WorkflowNodeTarget["kind"],
                      id: selected.data.ref,
                    });
                    setSelected(null);
                  }}
                >
                  {t("teamWorkflow.messages")}
                </Button>
              )}
            <Button
              variant="primary"
              disabled={readOnly}
              onClick={() => {
                if (!selected) return;
                const rule = newRule(`r-${crypto.randomUUID()}`);
                if (selected.data.kind === "member")
                  rule.when.from_member = selected.data.ref;
                if (selected.data.kind === "channel")
                  rule.when.channel = selected.data.ref;
                setSelected(null);
                onCreate(rule);
              }}
            >
              {t("teamWorkflow.new")}
            </Button>
          </>
        }
      />
    </div>
  );
}

export function WorkflowCanvas(props: WorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
