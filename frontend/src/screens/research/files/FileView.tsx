import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../../../i18n/I18nProvider";
import { usePdfDocument } from "../../../reader/engine/usePdfDocument";
import { IconButton, SegmentedControl, Spinner } from "../../../ui";
import { Prose } from "../talk/ThreadView";
import {
  fileUrl,
  formatSize,
  parseDelimited,
  readWorkspaceFile,
  type FileContent,
} from "./files-api";
import styles from "./Files.module.css";

/** One file of the workspace, shown as what it is. */
export function FileView({
  projectId,
  path,
  settled,
  onBack,
  actions,
}: {
  projectId: string;
  path: string;
  settled: string;
  onBack(): void;
  actions: ReactNode;
}) {
  const { t } = useI18n();
  const [file, setFile] = useState<FileContent | null>(null);
  const [failed, setFailed] = useState("");
  const [source, setSource] = useState(false);

  useEffect(() => {
    setFile(null);
    setFailed("");
    setSource(false);
  }, [projectId, path]);

  useEffect(() => {
    let cancelled = false;
    readWorkspaceFile(projectId, path).then(
      (value) => {
        if (!cancelled) setFile(value);
      },
      (error: unknown) => {
        if (!cancelled)
          setFailed(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, path, settled]);

  const rendered = file?.kind === "markdown" || file?.kind === "csv";
  return (
    <div className={styles.viewer}>
      <div className={styles.viewerHead}>
        <IconButton
          size="sm"
          icon={ArrowLeft}
          label={t("research.files.back")}
          onClick={onBack}
        />
        <span className={styles.path} title={path}>
          {path}
        </span>
        {actions}
      </div>
      {file && (
        <div className={styles.meta}>
          <span>
            {formatSize(file.size)} ·{" "}
            {new Date(file.modified * 1000).toLocaleString()}
          </span>
          {rendered && (
            <SegmentedControl
              kind="radio"
              size="sm"
              label={t("research.files.view")}
              value={source ? "source" : "preview"}
              onChange={(v) => setSource(v === "source")}
              options={[
                { value: "preview", label: t("research.files.preview") },
                { value: "source", label: t("research.files.source") },
              ]}
            />
          )}
        </div>
      )}
      {failed ? (
        <p className={styles.empty}>{failed}</p>
      ) : !file ? (
        <div className={styles.empty}>
          <Spinner />
        </div>
      ) : (
        <>
          {file.truncated && (
            <p className={styles.note}>{t("research.files.truncated")}</p>
          )}
          <Body projectId={projectId} file={file} source={source} />
        </>
      )}
    </div>
  );
}

function Body({
  projectId,
  file,
  source,
}: {
  projectId: string;
  file: FileContent;
  source: boolean;
}) {
  const { t } = useI18n();
  const text = file.content ?? "";
  if (file.kind === "image")
    return (
      <div className={styles.image}>
        <img src={fileUrl(projectId, file.path)} alt={file.name} />
      </div>
    );
  if (file.kind === "pdf")
    return <PdfPreview url={fileUrl(projectId, file.path)} />;
  if (file.kind === "binary")
    return <p className={styles.empty}>{t("research.files.binary")}</p>;
  if (file.kind === "markdown" && !source)
    return (
      <div className={styles.markdown}>
        <Prose text={text} />
      </div>
    );
  if (file.kind === "csv" && !source)
    return <Table text={text} tsv={file.name.toLowerCase().endsWith(".tsv")} />;
  return <Code text={text} />;
}

/** Text with its line numbers, the numbers out of the selection. */
function Code({ text }: { text: string }) {
  const lines = useMemo(() => {
    const out = text.split("\n");
    if (out.length > 1 && out[out.length - 1] === "") out.pop();
    return out;
  }, [text]);
  return (
    <div className={styles.code}>
      <pre className={styles.gutter} aria-hidden>
        {lines.map((_, i) => i + 1).join("\n")}
      </pre>
      <pre className={styles.lines}>{lines.join("\n")}</pre>
    </div>
  );
}

function Table({ text, tsv }: { text: string; tsv: boolean }) {
  const { t } = useI18n();
  const { rows, more } = useMemo(
    () => parseDelimited(text, tsv ? "\t" : ","),
    [text, tsv],
  );
  if (!rows.length)
    return <p className={styles.empty}>{t("research.files.emptyFile")}</p>;
  const [head, ...body] = rows;
  return (
    <div className={styles.table}>
      <table>
        <thead>
          <tr>
            {head.map((cell, i) => (
              <th key={i}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={r}>
              {row.map((cell, i) => (
                <td key={i}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {more && (
        <p className={styles.note}>
          {t("research.files.moreRows", { n: rows.length })}
        </p>
      )}
    </div>
  );
}

function PdfPreview({ url }: { url: string }) {
  const { doc, error } = usePdfDocument(url, url);
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(200, entry.contentRect.width)),
    );
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={host} className={styles.pdf}>
      {error ? (
        <p className={styles.empty}>{error}</p>
      ) : doc ? (
        Array.from({ length: doc.numPages }, (_, i) => (
          <PdfPage key={i} doc={doc} number={i + 1} width={width} />
        ))
      ) : (
        <div className={styles.empty}>
          <Spinner />
        </div>
      )}
    </div>
  );
}

/** A page, drawn once it comes near the view. */
function PdfPage({
  doc,
  number,
  width,
}: {
  doc: PDFDocumentProxy;
  number: number;
  width: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [aspect, setAspect] = useState(1.414);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setVisible(true),
      { rootMargin: "600px" },
    );
    if (canvas.current) observer.observe(canvas.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !canvas.current) return;
    const target = canvas.current;
    let cancelled = false;
    let render: RenderTask | undefined;
    void doc.getPage(number).then((page) => {
      if (cancelled) return;
      const natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: width / natural.width });
      setAspect(viewport.height / viewport.width);
      const ratio = Math.min(devicePixelRatio || 1, 2);
      target.width = Math.floor(viewport.width * ratio);
      target.height = Math.floor(viewport.height * ratio);
      render = page.render({
        canvas: target,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      render.promise.catch(() => undefined);
    });
    return () => {
      cancelled = true;
      render?.cancel();
    };
  }, [doc, number, width, visible]);
  return (
    <canvas
      ref={canvas}
      className={styles.page}
      style={{ width, height: width * aspect }}
    />
  );
}
