import type { en } from "./en";

// An empty string falls back to the English text; the catalog test keeps it from shipping.
export const zh: { [K in keyof typeof en]: string } = {
  "common.close": "关闭",
  "common.cancel": "取消",
  "common.confirm": "确定",
  "common.retry": "重试",
  "common.loading": "正在加载",
  "common.dismiss": "关掉提示",
  "toast.region": "通知",
  "sidebar.collapse": "收起侧栏",
  "sidebar.expand": "展开侧栏",
  "kit.sample.pages#one": "读了 {count} 页",
  "kit.sample.pages#other": "读了 {count} 页",
};
