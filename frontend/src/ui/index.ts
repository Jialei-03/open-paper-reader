// The entry of the new interface's kit: fonts, tokens, then the components.
// It deliberately does not import reset.css; the entry that owns the page does.
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/noto-sans-sc";
import "./tokens.css";

export * from "./theme";
