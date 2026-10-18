// The single source of the message keys: `zh` is typed against this table, so a
// key missing from, or extra in, the Chinese catalog does not compile.
// A count-dependent message is two keys, `name#one` and `name#other`, read with `tn`.
export const en = {
  "common.close": "Close",
  "common.cancel": "Cancel",
  "common.confirm": "OK",
  "common.retry": "Retry",
  "common.loading": "Loading",
  "common.dismiss": "Dismiss",
  "toast.region": "Notifications",
  "sidebar.collapse": "Collapse sidebar",
  "sidebar.expand": "Expand sidebar",
  "kit.sample.pages#one": "Read {count} page",
  "kit.sample.pages#other": "Read {count} pages",
} as const;
