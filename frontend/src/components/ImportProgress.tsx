import type { ImportProgress as Progress } from "../lib/arxiv-import";

const labels: Record<string, string> = {
  waiting: "正在连接导入服务",
  metadata: "正在获取论文资料",
  checking: "正在检查论文是否已导入",
  pdf: "正在下载原版 PDF",
  saving: "正在校验并保存论文",
  done: "导入完成",
  failed: "导入未完成",
};
const bytes = (value: number) =>
  value < 1024 * 1024
    ? `${Math.ceil(value / 1024)} KB`
    : `${(value / 1024 / 1024).toFixed(1)} MB`;

export function ImportProgress({ value }: { value: Progress | null }) {
  const total = value?.total;
  const received = value?.received || 0;
  return (
    <div className="w-full space-y-2" role="status" aria-live="polite">
      <div>
        {labels[value?.stage || "metadata"] || "正在导入论文"}
        {value?.attempt && value.attempt > 1
          ? ` · 第 ${value.attempt} 次尝试`
          : ""}
        {received > 0
          ? ` · ${bytes(received)}${total ? ` / ${bytes(total)}` : ""}`
          : ""}
      </div>
      <progress
        className="h-2 w-full accent-primary"
        aria-label="当前导入阶段的下载进度"
        {...(total && total >= received ? { value: received, max: total } : {})}
      />
    </div>
  );
}
