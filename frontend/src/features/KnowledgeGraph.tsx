import { ContentBadge } from "../components/ContentBadge";
import { useIsMobile } from "../hooks/use-mobile";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  forceX,
  forceY,
  Simulation,
  forceCollide,
  SimulationNodeDatum,
} from "d3-force";
import { Minus, Plus, Scan, ArrowUpRight } from "lucide-react";
import { KnowledgeGraph as Graph, KnowledgeNode } from "../lib/knowledge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "../components/ui/card";
import { Choice } from "../components/Choice";
import { Empty, PageHead } from "../components/shared";
import { Connections } from "../components/Connections";
import { kindLabel } from "../api";
type Positioned = KnowledgeNode & SimulationNodeDatum;
const group = (n: KnowledgeNode) =>
  n.kind === "paper"
    ? "paper"
    : ["topic", "link"].includes(n.kind)
      ? "topic"
      : "note";
const colors: Record<string, string> = {
  paper: "var(--type-paper)",
  topic: "var(--type-topic)",
  note: "var(--type-note)",
  evidence: "var(--type-evidence)",
  analysis: "var(--type-analysis)",
  question: "var(--type-question)",
};
export function KnowledgeGraph({
  graph,
  route,
  go,
}: {
  graph: Graph;
  route: string;
  go: (route: string) => void;
}) {
  const mobile = useIsMobile();
  const focus = new URLSearchParams(route.split("?")[1]).get("focus") || "";
  const [selected, setSelected] = useState(focus),
    [query, setQuery] = useState(""),
    [kind, setKind] = useState("all");
  const [camera, setCamera] = useState({ x: 0, y: 0, scale: 1 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(
    null,
  );
  const svg = useRef<SVGSVGElement>(null);
  const world = useRef<SVGGElement>(null);
  const simulation = useRef<Simulation<Positioned, undefined> | null>(null);
  const nodeDrag = useRef<{
    node: Positioned;
    pointer: number;
    x: number;
    y: number;
    dx: number;
    dy: number;
  } | null>(null);
  const suppressClick = useRef(false);
  const graphPoint = (x: number, y: number) => {
    const matrix = world.current?.getScreenCTM();
    return matrix ? new DOMPoint(x, y).matrixTransform(matrix.inverse()) : null;
  };
  const endDrag = () => {
    if (nodeDrag.current) {
      nodeDrag.current.node.fx = null;
      nodeDrag.current.node.fy = null;
      nodeDrag.current = null;
      simulation.current?.alphaTarget(0);
    }
    drag.current = null;
    svg.current?.removeAttribute("data-dragging");
  };
  const neighbors = useMemo(
    () =>
      new Set([
        focus,
        ...graph.edges
          .filter((e) => e.source === focus || e.target === focus)
          .flatMap((e) => [e.source, e.target]),
      ]),
    [graph, focus],
  );
  const matches = useMemo(
    () =>
      graph.nodes.filter(
        (n) =>
          (focus ? neighbors.has(n.id) : !n.parent) &&
          (kind === "all" || group(n) === kind) &&
          n.title
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase()),
      ),
    [graph, focus, neighbors, kind, query],
  );
  const layout = useMemo(() => {
    // Bound rendering work; the complete backlink index remains available below.
    const nodes: Positioned[] = matches.slice(0, 350).map((n) => ({ ...n }));
    const ids = new Set(nodes.map((n) => n.id));
    const parent = new Map(graph.nodes.map((n) => [n.id, n.parent || n.id]));
    const seen = new Set<string>();
    const edges = graph.edges
      .map((e) =>
        focus
          ? e
          : {
              ...e,
              source: parent.get(e.source) || e.source,
              target: parent.get(e.target) || e.target,
            },
      )
      .filter((e) => {
        const key = [e.source, e.target].sort().join(":");
        if (
          e.source === e.target ||
          !ids.has(e.source) ||
          !ids.has(e.target) ||
          (!focus && seen.has(key))
        )
          return false;
        seen.add(key);
        return true;
      });
    const links = edges.map((e) => ({ ...e }));
    forceSimulation(nodes)
      .force("charge", forceManyBody().strength(-450))
      .force(
        "link",
        forceLink<Positioned, any>(links)
          .id((n) => n.id)
          .distance(115),
      )
      .force("center", forceCenter(0, 0))
      .force("collide", forceCollide(38))
      .stop()
      .tick(100);
    const radius = Math.max(
      140,
      ...nodes.map((n) => Math.max(Math.abs(n.x!), Math.abs(n.y!)) + 55),
    );
    const factor = (mobile ? 160 : 235) / radius;
    nodes.forEach((n) => {
      n.x = 400 + n.x! * factor;
      n.y = 270 + n.y! * factor;
    });
    return { nodes, edges, factor, byId: new Map(nodes.map((n) => [n.id, n])) };
  }, [matches, graph, mobile, focus]);
  useEffect(() => {
    if (!svg.current || !layout.nodes.length) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const nodeElements = [
      ...svg.current.querySelectorAll<SVGGElement>("[data-node]"),
    ];
    const edgeElements = [
      ...svg.current.querySelectorAll<SVGLineElement>("line"),
    ];
    const paint = () => {
      nodeElements.forEach((el, i) => {
        const node = layout.nodes[i];
        el.setAttribute("transform", `translate(${node.x} ${node.y})`);
      });
      edgeElements.forEach((el, i) => {
        const edge = layout.edges[i];
        const a = layout.byId.get(edge.source)!,
          b = layout.byId.get(edge.target)!;
        el.setAttribute("x1", String(a.x));
        el.setAttribute("y1", String(a.y));
        el.setAttribute("x2", String(b.x));
        el.setAttribute("y2", String(b.y));
      });
    };
    const sim = forceSimulation(layout.nodes)
      .force("charge", forceManyBody().strength(-450 * layout.factor ** 2))
      .force(
        "link",
        forceLink<Positioned, any>(layout.edges.map((e) => ({ ...e })))
          .id((n) => n.id)
          .distance(115 * layout.factor)
          .strength(0.35),
      )
      .force("x", forceX<Positioned>(400).strength(0.015))
      .force("y", forceY<Positioned>(270).strength(0.015))
      .force(
        "collide",
        forceCollide(Math.max(12, 25 * layout.factor)).strength(0.7),
      )
      .velocityDecay(reduced ? 0.65 : 0.22)
      .alphaDecay(reduced ? 0.12 : 0.035)
      .alpha(0.3)
      .on("tick", paint);
    simulation.current = sim;
    if (reduced) {
      sim.stop().tick(100);
      paint();
    }
    return () => {
      sim.stop();
      endDrag();
      simulation.current = null;
    };
  }, [layout]);
  const current = graph.nodes.find((n) => n.id === selected);
  const connected = new Set(
    graph.edges
      .filter((e) => e.source === selected || e.target === selected)
      .flatMap((e) => [e.source, e.target]),
  );
  const zoom = (multiplier: number) =>
    setCamera((c) => ({
      ...c,
      scale: Math.min(4, Math.max(0.5, c.scale * multiplier)),
    }));
  return (
    <div className="page graph-page flex flex-col gap-5">
      <PageHead
        eyebrow=""
        subtitle=""
        title="知识图谱"
        action={
          focus ? (
            <Button variant="outline" onClick={() => go("graph")}>
              全部关系
            </Button>
          ) : undefined
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <Input
          className="w-full sm:w-72"
          aria-label="搜索图谱"
          placeholder="搜索节点…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Choice aria-label="节点类型" value={kind} onValueChange={setKind}>
          <option value="all">全部类型</option>
          <option value="paper">论文</option>
          <option value="topic">主题</option>
          <option value="note">笔记与证据</option>
        </Choice>
        <span className="text-sm text-muted-foreground">
          {matches.length} 个节点 · {layout.edges.length} 条关系
        </span>
      </div>
      {matches.length > 350 && (
        <p className="text-sm text-muted-foreground">
          当前显示前 350 个节点，请搜索或打开局部图谱缩小范围。
        </p>
      )}
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="min-w-0 gap-0 overflow-hidden">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-4">
              {focus ? "局部关系" : "全部关系"}
              <span className="ml-auto flex flex-wrap gap-3 text-xs font-normal">
                {[
                  ["paper", "论文"],
                  ["topic", "主题"],
                  ["note", "笔记"],
                  ["evidence", "证据"],
                  ["analysis", "解读"],
                  ["question", "问题"],
                ].map(([key, label]) => (
                  <span key={key} className="flex items-center gap-1">
                    <span
                      className="size-2 rounded-full"
                      style={{ background: colors[key] }}
                    />
                    {label}
                  </span>
                ))}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="relative p-0">
            {!layout.nodes.length ? (
              <div className="py-24">
                <Empty
                  text={
                    graph.nodes.length
                      ? "没有匹配的节点"
                      : "添加论文和笔记后，关联会出现在这里。"
                  }
                />
              </div>
            ) : (
              <svg
                ref={svg}
                role="group"
                aria-label="知识关系图"
                viewBox={mobile ? "200 70 400 400" : "0 0 800 540"}
                className="knowledge-canvas w-full"
                style={{ touchAction: "none" }}
                onPointerDown={(e) => {
                  if (e.button !== 0 || !e.isPrimary) return;
                  suppressClick.current = false;
                  const id = (e.target as Element)
                    .closest("[data-node]")
                    ?.getAttribute("data-node");
                  const node = id ? layout.byId.get(id) : undefined;
                  if (node) {
                    const point = graphPoint(e.clientX, e.clientY);
                    if (!point) return;
                    nodeDrag.current = {
                      node,
                      pointer: e.pointerId,
                      x: e.clientX,
                      y: e.clientY,
                      dx: node.x! - point.x,
                      dy: node.y! - point.y,
                    };
                    node.fx = node.x;
                    node.fy = node.y;
                    simulation.current?.alpha(0.45).alphaTarget(0.22).restart();
                    e.currentTarget.setAttribute("data-dragging", "node");
                    e.currentTarget.setPointerCapture(e.pointerId);
                    return;
                  }
                  drag.current = {
                    x: e.clientX,
                    y: e.clientY,
                    ox: camera.x,
                    oy: camera.y,
                  };
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  const active = nodeDrag.current;
                  if (active && active.pointer === e.pointerId) {
                    const point = graphPoint(e.clientX, e.clientY);
                    if (point) {
                      active.node.fx = point.x + active.dx;
                      active.node.fy = point.y + active.dy;
                    }
                    if (
                      Math.hypot(e.clientX - active.x, e.clientY - active.y) > 4
                    )
                      suppressClick.current = true;
                    return;
                  }
                  if (!drag.current) return;
                  const factor =
                    (mobile ? 400 : 800) /
                    e.currentTarget.getBoundingClientRect().width;
                  setCamera((c) => ({
                    ...c,
                    x:
                      drag.current!.ox + (e.clientX - drag.current!.x) * factor,
                    y:
                      drag.current!.oy + (e.clientY - drag.current!.y) * factor,
                  }));
                }}
                onPointerUp={(e) => {
                  const active = nodeDrag.current;
                  if (active && !suppressClick.current)
                    setSelected(active.node.id);
                  endDrag();
                  if (e.currentTarget.hasPointerCapture(e.pointerId))
                    e.currentTarget.releasePointerCapture(e.pointerId);
                }}
                onPointerCancel={endDrag}
                onLostPointerCapture={endDrag}
              >
                <g
                  ref={world}
                  transform={`translate(${camera.x + 400} ${camera.y + 270}) scale(${camera.scale}) translate(-400 -270)`}
                >
                  {layout.edges.map((e) => {
                    const a = layout.byId.get(e.source)!,
                      b = layout.byId.get(e.target)!;
                    return (
                      <line
                        key={e.source + e.target + e.label}
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        stroke={
                          e.source === selected || e.target === selected
                            ? "var(--primary)"
                            : "var(--border)"
                        }
                        strokeWidth={
                          e.source === selected || e.target === selected
                            ? 2
                            : 1.3
                        }
                      />
                    );
                  })}
                  {layout.nodes.map((n) => (
                    <g
                      key={n.id}
                      data-node={n.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`选择 ${n.title}`}
                      aria-pressed={selected === n.id}
                      transform={`translate(${n.x} ${n.y})`}
                      className="knowledge-node"
                      opacity={
                        selected && !connected.has(n.id) && selected !== n.id
                          ? 0.4
                          : 1
                      }
                      onClick={() => {
                        if (!suppressClick.current) setSelected(n.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelected(n.id);
                        }
                      }}
                    >
                      <title>{n.title}</title>
                      <circle
                        r={20}
                        fill="transparent"
                        stroke={
                          selected === n.id
                            ? "var(--foreground)"
                            : "transparent"
                        }
                        strokeWidth={1.5}
                      />
                      <circle
                        r={group(n) === "paper" ? 8 : 6}
                        fill={`var(--type-${n.kind}, var(--type-note))`}
                      />
                      <text
                        y={27}
                        textAnchor="middle"
                        fill="var(--foreground)"
                        fontSize={mobile ? 14 : 12}
                      >
                        {n.title.length > 20
                          ? n.title.slice(0, 20) + "…"
                          : n.title}
                      </text>
                    </g>
                  ))}
                </g>
              </svg>
            )}
            <div className="absolute bottom-3 left-3 flex gap-1">
              <Button
                variant="outline"
                size="icon"
                aria-label="缩小图谱"
                onClick={() => zoom(1 / 1.25)}
              >
                <Minus />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="放大图谱"
                onClick={() => zoom(1.25)}
              >
                <Plus />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="重置图谱视图"
                onClick={() => setCamera({ x: 0, y: 0, scale: 1 })}
              >
                <Scan />
              </Button>
            </div>
          </CardContent>
        </Card>
        <aside className="flex min-w-0 flex-col gap-4">
          {current ? (
            <>
              <Card>
                <CardHeader>
                  <ContentBadge kind={current.kind} />
                  <CardTitle className="break-words">{current.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <Button onClick={() => go(current.route)}>
                    打开内容
                    <ArrowUpRight data-icon="inline-end" />
                  </Button>
                </CardContent>
              </Card>
              <Connections graph={graph} id={current.id} go={go} />
            </>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>沿着线索继续阅读</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                拖动节点牵动关联，松手后自然回弹。点击查看双向链接，拖动空白处平移。
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
