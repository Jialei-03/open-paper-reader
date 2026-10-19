// Opens the page or the PDF link in open-paper-reader. Only the address is
// passed on, as part of the address of the app's tab: no cookies, no page text.
importScripts("shared.js");

const MENU = "open-in-reader";

async function server() {
  const { server: saved } = await chrome.storage.sync.get("server");
  return normalizeServer(saved) || LOCAL_SERVER;
}

async function open(target) {
  const address = openAddress(await server(), target || "");
  if (!address) {
    // chrome://, the new tab page, a file: ... nothing to import.
    await chrome.action.setBadgeText({ text: "!" });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2500);
    return;
  }
  await chrome.tabs.create({ url: address });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU,
    title: "在 Open Paper Reader 中打开",
    contexts: ["page", "link"],
  });
});

chrome.action.onClicked.addListener((tab) => open(tab.url));

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU) open(info.linkUrl || info.pageUrl || tab?.url);
});
