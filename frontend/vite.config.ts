import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  build: {
    // Keep fonts as same-origin files: the app CSP intentionally disallows data: fonts.
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        // Heavy libraries that rarely change get their own files: a release then
        // re-downloads only the app's own code, and none of them is fetched to
        // show the public site or the sign-in page.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          // Stylesheets stay with the entry (see src/styles.ts): a stylesheet inside
          // a JS group would make the entry import that whole group to get it.
          if (/\.css(\?|$)/.test(id)) return undefined;
          // React and its runtime helpers are needed by every page. They must not
          // be left to land inside a heavy group the sign-in page then has to fetch.
          if (
            /node_modules\/(react|react-dom|scheduler|use-sync-external-store)\//.test(
              id,
            )
          )
            return "vendor-react";
          if (
            /node_modules\/(katex|react-markdown|remark-[^/]+|rehype-[^/]+|micromark[^/]*|mdast-[^/]+|hast-[^/]+|hastscript|unified|vfile[^/]*|unist-[^/]+|devlop|trough|bail|zwitch|ccount|longest-streak|markdown-table|trim-lines|property-information|comma-separated-tokens|space-separated-tokens|decode-named-character-reference|character-entities[^/]*|html-url-attributes|is-plain-obj|estree-util-[^/]+|parse5|web-namespaces)\//.test(
              id,
            )
          )
            return "vendor-markdown";
          if (
            /node_modules\/(@tiptap|prosemirror-[^/]+|linkifyjs|marked|orderedmap|rope-sequence|w3c-keyname|crelt|@remirror)\//.test(
              id,
            )
          )
            return "vendor-editor";
          if (
            /node_modules\/(motion|motion-dom|motion-utils|framer-motion)\//.test(
              id,
            )
          )
            return "vendor-motion";
          return undefined;
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": process.env.DEV_API || "http://127.0.0.1:8765",
      "/assets/pdfjs": process.env.DEV_API || "http://127.0.0.1:8765",
    },
  },
});
