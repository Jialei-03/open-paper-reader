import { useEffect, useState } from "react";
import { api } from "../api";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";

type Budget = {
  scope: "shared" | "private";
  limit_tokens: number;
  charged_tokens: number;
  request_reserve_tokens: number;
  over_reservation_requests: number;
};
type Usage = {
  budgets: Budget[];
  requests: number;
  total_tokens: number;
  unknown_requests: number;
};
export function ModelUsage({ tick }: { tick: number }) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    api<Usage>("/model-usage")
      .then((value) => {
        if (active) {
          setUsage(value);
          setError(false);
        }
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [tick]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>模型用量</CardTitle>
        <CardDescription>今日 · UTC 每日重置</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {error ? (
          <p role="status">暂时无法读取模型用量，请稍后刷新。</p>
        ) : !usage ? (
          <p role="status">读取中…</p>
        ) : (
          <>
            <p>
              {usage.requests.toLocaleString()} 次请求 · 已知用量{" "}
              {usage.total_tokens.toLocaleString()} tokens
            </p>
            {usage.unknown_requests > 0 && (
              <p className="text-muted-foreground">
                {usage.unknown_requests} 次请求未取得完整用量，未计入 token
                合计。
              </p>
            )}
            {usage.budgets
              ?.filter((budget) => budget.limit_tokens > 0)
              .map((budget) => (
                <div key={budget.scope} className="space-y-1 border-t pt-2">
                  <p>
                    {budget.scope === "shared" ? "平台模型" : "自带模型"}预算：
                    {budget.charged_tokens.toLocaleString()} /{" "}
                    {budget.limit_tokens.toLocaleString()} tokens
                  </p>
                  <p className="text-muted-foreground">
                    占用包含实际用量和未结算预留；每次请求需预留{" "}
                    {budget.request_reserve_tokens.toLocaleString()}
                    。预留不是实际消耗。
                  </p>
                  {budget.over_reservation_requests > 0 && (
                    <p role="status">
                      {budget.over_reservation_requests}{" "}
                      次请求的实际用量超过预留，已按实际用量结算。
                    </p>
                  )}
                </div>
              ))}
            <p className="text-muted-foreground">
              统计助手、论文翻译及模型测试的上游返回值，包含重试。不包含启用统计前的请求；不代表计费金额。
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
