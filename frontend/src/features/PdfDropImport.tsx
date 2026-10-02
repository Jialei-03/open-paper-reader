import { useEffect, useRef, useState } from "react";
import { FileUp } from "lucide-react";

/** Drop target and file picker for the import dialog. */
export function PdfDropZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className="pdf-drop-zone"
      data-over={over}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onFiles(files);
      }}
    >
      <button
        type="button"
        aria-label="选择 PDF 文件上传"
        onClick={() => input.current?.click()}
      >
        <span className="pdf-drop-icon" aria-hidden="true">
          <FileUp />
        </span>
        <strong>上传 PDF</strong>
        <span>拖到这里，或点击选择文件。可一次选多篇，单个 ≤ 50 MB</span>
      </button>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        data-testid="pdf-file-input"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
    </div>
  );
}

/**
 * Accept files dropped anywhere in the workspace. Anything already handled by
 * a more specific target (chat attachments, note images) has called
 * preventDefault by the time the event bubbles here, and is left alone.
 */
export function useGlobalFileDrop(
  enabled: boolean,
  onFiles: (files: File[]) => void,
) {
  const [active, setActive] = useState(false);
  const depth = useRef(0);
  const handler = useRef(onFiles);
  handler.current = onFiles;
  useEffect(() => {
    if (!enabled) return;
    const hasFiles = (e: DragEvent) =>
      !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current += 1;
      setActive(true);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setActive(false);
    };
    const drop = (e: DragEvent) => {
      depth.current = 0;
      setActive(false);
      if (!hasFiles(e) || e.defaultPrevented) return;
      e.preventDefault();
      const files = Array.from(e.dataTransfer!.files);
      if (files.length) handler.current(files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
      depth.current = 0;
      setActive(false);
    };
  }, [enabled]);
  return active;
}

export function DropOverlay({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="pdf-drop-overlay" aria-hidden="true">
      <div>
        <span className="pdf-drop-icon">
          <FileUp />
        </span>
        <strong>松开即可导入 PDF</strong>
        <span>论文会自动创建并打开阅读</span>
      </div>
    </div>
  );
}
