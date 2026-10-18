export type Paper = {
  id: string;
  title: string;
  authors: string;
  abstract: string;
  external_id: string;
  tags: string[];
  current_version: string;
  agent_status: string;
  reading_status: string;
  favorite: boolean;
  archived: boolean;
  revision: number;
  updated_at: string;
};
export type SourceFile = {
  id: string;
  paper_id: string;
  version_id: string;
  name: string;
  source_path: string;
  mime: string;
  size: number;
  sha256: string;
  pages: number | null;
};
export type Locator = {
  version_id: string;
  file_id: string;
  page?: number;
  line_start?: number;
  line_end?: number;
  quote?: string;
  label?: string;
};
export type Item = {
  id: string;
  kind: string;
  paper_id: string | null;
  title: string;
  body: string;
  status: string;
  tags: string[];
  paper_ids: string[];
  evidence_ids: string[];
  locator: Locator | Record<string, never>;
  attribution: string;
  revision: number;
  updated_at: string;
};
export type Version = { id: string; label: string; provenance: string };
export type ReadingEvent = {
  id: string;
  kind: string;
  body: string;
  confirmed: boolean;
  locator: Locator;
  created_at: string;
  actor: string;
};
/** A failed API call. `message` is the user-facing reason; `status` is for code. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}
const fieldNames: Record<string, string> = {
  username: "用户名",
  password: "密码",
  title: "标题",
  authors: "作者",
  abstract: "摘要",
  tags: "标签",
  email: "邮箱",
  url: "链接",
  name: "名称",
  body: "内容",
};
// The service answers in English for a few technical cases; say them plainly.
const knownMessages: [RegExp, string][] = [
  [/username is reserved/i, "这个用户名不能使用，请换一个"],
  [
    /valid username and 8.256 character password/i,
    "请填写 3–32 位用户名和至少 8 位的密码",
  ],
  [/too many authentication attempts/i, "尝试次数过多，请 15 分钟后再试"],
  [/login required|invalid authorization/i, "请先登录"],
  [
    /revision conflict/i,
    "保存冲突：内容已在别处更新，请重新打开编辑器，合并最新内容后再保存",
  ],
  [/upload too large/i, "文件太大，超过上传上限"],
  [/^empty file$/i, "文件是空的"],
  [
    /invalid, encrypted, oversized, or unsupported media/i,
    "文件无法读取：可能已加密、损坏或格式不受支持",
  ],
  [/^encrypted pdf$/i, "文件已加密，需要密码才能打开；请去掉密码后再导入"],
  [/^unreadable pdf$/i, "文件已损坏或不完整，无法读取"],
  [/^not a pdf$/i, "这个文件不是 PDF，请确认后重新导入"],
  [/^too many pages$/i, "PDF 超过 3000 页，无法导入"],
  [/preview unsupported/i, "这种文件暂不支持预览，请下载后查看"],
  [/file missing or unsafe/i, "文件已丢失，请联系管理员从备份恢复"],
  [/^not found$/i, "内容不存在或已被删除"],
  [/csrf token required/i, "登录状态已过期，请刷新页面后重试"],
  [/administrator required/i, "需要管理员权限"],
];
/** Turn whatever the service returned into one plain sentence. */
export function describeError(detail: unknown): string {
  if (Array.isArray(detail)) {
    const parts = detail
      .map((d) => {
        const loc = Array.isArray(d?.loc) ? d.loc : [];
        const label = fieldNames[String(loc[loc.length - 1])] || "";
        const msg = describeError(
          String(d?.msg || "").replace(/^Value error,\s*/i, ""),
        );
        return label ? `${label}：${msg}` : msg;
      })
      .filter(Boolean);
    if (parts.length) return parts.join("；");
  }
  if (typeof detail === "string") {
    const hit = knownMessages.find(([pattern]) => pattern.test(detail));
    return hit ? hit[1] : detail;
  }
  if (detail && typeof detail === "object") return JSON.stringify(detail);
  return "请求没有成功，请稍后重试";
}
export const errorStatus = (e: unknown) =>
  e instanceof ApiError ? e.status : 0;
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  if (options.method && !["GET", "HEAD"].includes(options.method)) {
    headers.set(
      "X-CSRF-Token",
      decodeURIComponent(
        document.cookie
          .split("; ")
          .find((x) => x.startsWith("paper_csrf="))
          ?.split("=")[1] || "",
      ),
    );
    if (!headers.has("Idempotency-Key"))
      headers.set("Idempotency-Key", crypto.randomUUID());
  }
  const res = await fetch("/api/v1" + path, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(res.status, describeError(data.detail));
  }
  return res.json();
}
export const send = (
  path: string,
  body: unknown,
  method = "POST",
  revision?: number,
) =>
  api(path, {
    method,
    body: JSON.stringify(body),
    headers: revision ? { "If-Match": String(revision) } : {},
  });
export const date = (s: string) =>
  new Date(s).toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
export const statusLabel: Record<string, string> = {
  unread: "未读",
  reading: "阅读中",
  read: "已读",
  pending: "待处理",
  processing: "处理中",
  ready: "处理完成",
  failed: "处理失败",
};
export const kindLabel: Record<string, string> = {
  note: "个人笔记",
  evidence: "原文证据",
  analysis: "Agent 解读",
  question: "开放问题",
  topic: "主题笔记",
  link: "跨论文比较",
};
