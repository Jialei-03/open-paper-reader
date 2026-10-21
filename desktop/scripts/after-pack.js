// Puts the assistant runtime, its node_modules included, into the packed app.
// electron-builder leaves any node_modules out of extraResources, so it is
// copied here, after packing and before signing (so a signed build signs it).
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const app = fs
    .readdirSync(context.appOutDir)
    .find((name) => name.endsWith(".app"));
  const target = path.join(
    context.appOutDir,
    app,
    "Contents",
    "Resources",
    "agent-runtime",
  );
  const source = path.join(__dirname, "..", "bundle", "agent-runtime");
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true });
  if (!fs.existsSync(path.join(target, "node_modules", "@earendil-works")))
    throw new Error("the runtime's node_modules did not make it into the app");
};
