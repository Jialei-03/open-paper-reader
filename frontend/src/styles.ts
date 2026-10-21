/**
 * Every stylesheet, in the order the app has always evaluated them. They are
 * imported here, from the entry, so the whole cascade ships as one file in a
 * fixed order: the workspace itself loads on demand, and a stylesheet pulled in
 * by a lazily loaded module would land after design-system.css, which must
 * stay last.
 */
import "katex/dist/katex.min.css";
import "./features/paper-cover.css";
import "./features/parallel-translation.css";
import "./features/pdf-suggested-highlights.css";
import "./features/paper-reading-tools.css";
import "./features/paper-figures.css";
import "./features/reading-insights.css";
import "./features/pdf-annotations.css";
import "./features/pdf-selection-menu.css";
import "./features/pdf-rotation.css";
import "./features/pdf-region-adjustment.css";
import "./features/pdf-navigation.css";
import "./features/library.css";
import "./features/settings.css";
import "@fontsource-variable/noto-sans-sc";
import "@fontsource-variable/inter";
import "./theme.css";
import "./app.css";
import "./reader-shell.css";
import "./components/reader-controls.css";
import "./notes.css";
import "./workspace-design.css";
import "./components/streaming.css";
import "./desktop.css";
import "./design-system.css";
