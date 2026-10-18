const form = document.getElementById("form");
const custom = document.getElementById("custom");
const status = document.getElementById("status");
const radios = [...form.querySelectorAll('input[name="kind"]')];

const kindOf = (server) =>
  server === LOCAL_SERVER ? "local" : server === HOSTED_SERVER ? "hosted" : "custom";

function sync() {
  const kind = radios.find((r) => r.checked)?.value;
  custom.disabled = kind !== "custom";
}

function say(text, error) {
  status.textContent = text;
  if (error) status.setAttribute("data-error", "");
  else status.removeAttribute("data-error");
}

async function load() {
  const { server } = await chrome.storage.sync.get("server");
  const current = normalizeServer(server) || LOCAL_SERVER;
  const kind = kindOf(current);
  radios.find((r) => r.value === kind).checked = true;
  if (kind === "custom") custom.value = current;
  sync();
}

radios.forEach((r) => r.addEventListener("change", sync));

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const kind = radios.find((r) => r.checked)?.value;
  const server =
    kind === "local"
      ? LOCAL_SERVER
      : kind === "hosted"
        ? HOSTED_SERVER
        : normalizeServer(custom.value);
  if (!server) {
    say("地址需要以 https:// 开头（本机地址可以用 http://127.0.0.1）。", true);
    return;
  }
  await chrome.storage.sync.set({ server });
  say("已保存。");
});

load();
