// Shared by the service worker and the options page. No dependencies.
const LOCAL_SERVER = "http://127.0.0.1:8765";
const HOSTED_SERVER = "https://papers.dougao.online";

/**
 * The server address as an origin, or "" if it is not one this extension will
 * send addresses to: https anywhere, or plain http to this machine only.
 */
function normalizeServer(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    return "";
  }
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.username || url.password) return "";
  if (url.protocol === "https:" || (url.protocol === "http:" && local))
    return url.origin;
  return "";
}

/** What to open in the app, for a page or link address; "" for anything that is not a web address. */
function openAddress(server, target) {
  let url;
  try {
    url = new URL(target);
  } catch {
    return "";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  url.hash = "";
  return `${server}/#open?url=${encodeURIComponent(url.href)}`;
}
