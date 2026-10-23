import {
  AtSign,
  ChevronRight,
  Download,
  File as FileIcon,
  Folder,
  FolderOpen,
  Link2,
  RefreshCw,
  Upload,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { errorStatus } from "../../../api";
import { useI18n } from "../../../i18n/I18nProvider";
import { Button, Dialog, IconButton, Spinner, toast } from "../../../ui";
import {
  fileUrl,
  formatSize,
  insertIntoComposer,
  listFolder,
  parentOf,
  uploadToWorkspace,
  type FileEntry,
  type FolderListing,
} from "./files-api";
import { FileView } from "./FileView";
import styles from "./Files.module.css";

const remembered = new Map<string, { open: string[]; selected: string }>();

/**
 * The research's workspace: a tree of its folders, a file opened in place,
 * files dropped in to upload. `settled` changes when a round or a job ends,
 * and the open folders and file are read again then.
 */
export function FilesPanel({
  projectId,
  settled,
}: {
  projectId: string;
  settled: string;
}) {
  const { t } = useI18n();
  const [folders, setFolders] = useState<Map<string, FolderListing>>(
    () => new Map(),
  );
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(remembered.get(projectId)?.open ?? [""]),
  );
  const [selected, setSelected] = useState(
    () => remembered.get(projectId)?.selected ?? "",
  );
  const [failed, setFailed] = useState("");
  const [reads, setReads] = useState(0);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [clash, setClash] = useState<{ folder: string; files: File[] } | null>(
    null,
  );
  const picker = useRef<HTMLInputElement>(null);
  const openRef = useRef(open);
  openRef.current = open;

  const load = useCallback(
    (path: string) =>
      listFolder(projectId, path).then(
        (listing) => {
          setFolders((m) => new Map(m).set(path, listing));
          setFailed("");
        },
        (error: unknown) => {
          if (path === "")
            setFailed(error instanceof Error ? error.message : String(error));
          // A folder that went away closes.
          else
            setOpen((s) => {
              const next = new Set(s);
              next.delete(path);
              return next;
            });
        },
      ),
    [projectId],
  );

  // Switching tabs unmounts the panel: what was open is kept per research.
  useEffect(() => {
    remembered.set(projectId, { open: [...open], selected });
  }, [projectId, open, selected]);

  // Every open folder, again when a round or a job has ended.
  useEffect(() => {
    for (const path of openRef.current) void load(path);
  }, [load, settled, reads]);

  const toggle = (path: string) => {
    const next = new Set(open);
    if (next.has(path)) next.delete(path);
    else {
      next.add(path);
      if (!folders.has(path)) void load(path);
    }
    setOpen(next);
  };

  const upload = async (
    folder: string,
    files: File[],
    how?: "rename" | "replace",
  ) => {
    setUploading(true);
    const clashing: File[] = [];
    for (const file of files) {
      try {
        await uploadToWorkspace(projectId, folder, file, how ?? "error");
      } catch (error) {
        if (!how && errorStatus(error) === 409) clashing.push(file);
        else
          toast.show({
            message: error instanceof Error ? error.message : String(error),
            tone: "error",
          });
      }
    }
    setUploading(false);
    setOpen((s) => new Set(s).add(folder));
    void load(folder);
    if (clashing.length) setClash({ folder, files: clashing });
    else
      toast.show({
        message: t("research.files.uploaded", { n: files.length }),
        tone: "success",
      });
  };

  const drop = (folder: string) => ({
    onDragOver(e: DragEvent) {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
      setDropOn(folder);
    },
    onDragLeave(e: DragEvent) {
      e.stopPropagation();
      setDropOn((f) => (f === folder ? null : f));
    },
    onDrop(e: DragEvent) {
      e.preventDefault();
      e.stopPropagation();
      setDropOn(null);
      const files = [...e.dataTransfer.files];
      if (files.length) void upload(folder, files);
    },
  });

  const root = folders.get("");
  const target = selected ? parentOf(selected) : "";

  return (
    <div
      className={styles.panel}
      data-drop={dropOn === target || undefined}
      {...drop(target)}
    >
      <div className={styles.toolbar}>
        <span className={styles.title}>
          {root?.round
            ? t("research.files.round", { n: root.round })
            : t("research.files.title")}
          {root?.round ? <span className={styles.dot} aria-hidden /> : null}
        </span>
        <IconButton
          size="sm"
          icon={Upload}
          label={t("research.files.upload")}
          loading={uploading}
          onClick={() => picker.current?.click()}
        />
        <IconButton
          size="sm"
          icon={RefreshCw}
          label={t("research.files.refresh")}
          onClick={() => setReads((n) => n + 1)}
        />
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length) void upload(target, files);
          }}
        />
      </div>

      {selected ? (
        <FileView
          projectId={projectId}
          path={selected}
          settled={`${settled}:${reads}`}
          onBack={() => setSelected("")}
          actions={
            <>
              <IconButton
                size="sm"
                icon={AtSign}
                label={t("research.files.insert")}
                onClick={() => insertIntoComposer(selected)}
              />
              <IconButton
                size="sm"
                icon={Download}
                label={t("research.files.download")}
                onClick={() =>
                  window.open(fileUrl(projectId, selected, true), "_self")
                }
              />
            </>
          }
        />
      ) : failed ? (
        <p className={styles.empty}>{failed}</p>
      ) : !root ? (
        <div className={styles.empty}>
          <Spinner />
        </div>
      ) : root.entries.length === 0 ? (
        <p className={styles.empty}>{t("research.files.empty")}</p>
      ) : (
        <ul
          className={styles.tree}
          role="tree"
          aria-label={t("research.files.title")}
        >
          <Entries
            listing={root}
            depth={0}
            folders={folders}
            open={open}
            dropOn={dropOn}
            onToggle={toggle}
            onOpen={setSelected}
            drop={drop}
          />
        </ul>
      )}

      <Dialog
        open={!!clash}
        onClose={() => setClash(null)}
        size="sm"
        title={t("research.files.clashTitle")}
        description={t("research.files.clashLead", {
          names: clash?.files.map((f) => f.name).join(", ") ?? "",
        })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setClash(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                if (clash) void upload(clash.folder, clash.files, "rename");
                setClash(null);
              }}
            >
              {t("research.files.keepBoth")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (clash) void upload(clash.folder, clash.files, "replace");
                setClash(null);
              }}
            >
              {t("research.files.replace")}
            </Button>
          </>
        }
      />
    </div>
  );
}

function Entries({
  listing,
  depth,
  folders,
  open,
  dropOn,
  onToggle,
  onOpen,
  drop,
}: {
  listing: FolderListing;
  depth: number;
  folders: Map<string, FolderListing>;
  open: Set<string>;
  dropOn: string | null;
  onToggle(path: string): void;
  onOpen(path: string): void;
  drop(folder: string): Record<string, (e: DragEvent) => void>;
}) {
  const { t } = useI18n();
  return (
    <>
      {listing.entries.map((entry) => {
        const isOpen = entry.type === "dir" && open.has(entry.path);
        const inner = isOpen ? folders.get(entry.path) : undefined;
        return (
          <li
            key={entry.path}
            role="treeitem"
            aria-expanded={entry.type === "dir" ? isOpen : undefined}
            aria-selected={false}
          >
            <button
              type="button"
              className={styles.row}
              style={{ paddingLeft: `calc(${depth} * 14px + 6px)` }}
              disabled={entry.type === "link"}
              data-drop={dropOn === entry.path || undefined}
              title={
                entry.outside
                  ? t("research.files.outside")
                  : `${entry.path}\n${new Date(entry.modified * 1000).toLocaleString()}`
              }
              onClick={() =>
                entry.type === "dir" ? onToggle(entry.path) : onOpen(entry.path)
              }
              {...(entry.type === "dir" ? drop(entry.path) : {})}
            >
              <span className={styles.chevron} data-open={isOpen || undefined}>
                {entry.type === "dir" && <ChevronRight size={12} />}
              </span>
              <Icon entry={entry} open={isOpen} />
              <span className={styles.name}>{entry.name}</span>
              {entry.changed && (
                <span
                  className={styles.dot}
                  role="img"
                  aria-label={t("research.files.changed")}
                  title={t("research.files.changed")}
                />
              )}
              <span className={styles.size}>
                {entry.type === "file" ? formatSize(entry.size) : ""}
              </span>
            </button>
            {isOpen && (
              <ul role="group" className={styles.tree}>
                {inner ? (
                  inner.entries.length ? (
                    <Entries
                      listing={inner}
                      depth={depth + 1}
                      folders={folders}
                      open={open}
                      dropOn={dropOn}
                      onToggle={onToggle}
                      onOpen={onOpen}
                      drop={drop}
                    />
                  ) : (
                    <li
                      className={styles.emptyFolder}
                      style={{
                        paddingLeft: `calc(${depth + 1} * 14px + 24px)`,
                      }}
                    >
                      {t("research.files.emptyFolder")}
                    </li>
                  )
                ) : (
                  <li
                    className={styles.emptyFolder}
                    style={{ paddingLeft: `calc(${depth + 1} * 14px + 24px)` }}
                  >
                    <Spinner size={14} />
                  </li>
                )}
              </ul>
            )}
          </li>
        );
      })}
    </>
  );
}

function Icon({ entry, open }: { entry: FileEntry; open: boolean }) {
  const Glyph =
    entry.type === "link"
      ? Link2
      : entry.type === "dir"
        ? open
          ? FolderOpen
          : Folder
        : FileIcon;
  return <Glyph size={14} className={styles.icon} aria-hidden />;
}
