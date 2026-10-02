import { ArrowDownLeft, ArrowUpRight, Network } from "lucide-react";
import { KnowledgeGraph } from "../lib/knowledge";
import { Button } from "./ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";
export function Connections({
  graph,
  id,
  go,
}: {
  graph: KnowledgeGraph;
  id: string;
  go: (route: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          双向链接
          <Button
            variant="ghost"
            size="sm"
            onClick={() => go("graph?focus=" + encodeURIComponent(id))}
          >
            <Network data-icon="inline-start" />
            局部图谱
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {([true, false] as const).map((incoming) => {
          const edges = graph.edges.filter((e) =>
            incoming ? e.target === id : e.source === id,
          );
          return (
            <section
              key={String(incoming)}
              aria-label={incoming ? "反向链接" : "出站链接"}
              className="flex flex-col gap-2"
            >
              <h3 className="flex items-center gap-2 text-sm font-medium">
                {incoming ? (
                  <ArrowDownLeft size={16} />
                ) : (
                  <ArrowUpRight size={16} />
                )}
                {incoming ? "反向链接" : "出站链接"}
                <Badge variant="secondary">{edges.length}</Badge>
              </h3>
              {!edges.length && (
                <p className="text-sm text-muted-foreground">
                  {incoming ? "暂无内容链接到这里" : "暂无出站链接"}
                </p>
              )}
              {edges.map((e) => {
                const node = graph.nodes.find(
                  (n) => n.id === (incoming ? e.source : e.target),
                )!;
                return (
                  <Button
                    key={e.source + e.target + e.label}
                    variant="ghost"
                    className="h-auto justify-start whitespace-normal text-left"
                    onClick={() => go(node.route)}
                  >
                    <span className="min-w-0 flex-1 break-words">
                      {node.title}
                    </span>
                    <Badge variant="semantic" data-kind={node.kind}>
                      {e.label}
                    </Badge>
                  </Button>
                );
              })}
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}
