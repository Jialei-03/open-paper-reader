import { api } from "../../../api";

/** A research's workspace as files (backend research_files.py). */
export interface FileEntry {
  name: string;
  /** Relative to the workspace, with "/" between folders. */
  path: string;
  type: "dir" | "file" | "link";
  size: number;
  /** Seconds since the epoch. */
  modified: number;
  /** Written by the latest round: its write and edit steps, or its jobs. */
  changed: boolean;
  /** A link that points outside the workspace: listed, never opened. */
  outside?: boolean;
  link?: boolean;
}

export interface FolderListing {
  path: string;
  entries: FileEntry[];
  truncated: boolean;
  /** The latest executor round, or null before the first. */
  round: number | null;
  changed: string[];
  /** The kind of compute: "ssh" shows the copy synced back to this machine. */
  compute: string;
}

export type FileKind = "text" | "markdown" | "csv" | "image" | "pdf" | "binary";

export interface FileContent {
  path: string;
  name: string;
  size: number;
  modified: number;
  kind: FileKind;
  content?: string;
  truncated?: boolean;
}

export type Conflict = "error" | "rename" | "replace";

const base = (projectId: string) => `/research/projects/${projectId}/workspace`;

export const listFolder = (projectId: string, path = "") =>
  api<FolderListing>(
    `${base(projectId)}/list?path=${encodeURIComponent(path)}`,
  );

export const readWorkspaceFile = (projectId: string, path: string) =>
  api<FileContent>(`${base(projectId)}/file?path=${encodeURIComponent(path)}`);

/** The file's bytes: shown in place (images, PDFs) or saved. */
export const fileUrl = (projectId: string, path: string, download = false) =>
  `/api/v1${base(projectId)}/file?path=${encodeURIComponent(path)}&${download ? "download" : "raw"}=true`;

export function uploadToWorkspace(
  projectId: string,
  folder: string,
  file: File,
  conflict: Conflict = "error",
) {
  const body = new FormData();
  body.append("file", file);
  body.append("path", folder);
  body.append("conflict", conflict);
  return api<{ path: string; name: string; size: number; replaced: boolean }>(
    `${base(projectId)}/upload`,
    { method: "POST", body },
  );
}

/**
 * Asks the composer to take `@path` into what is being written. The files
 * panel only sends it; whichever composer is on the page decides to listen.
 */
export const INSERT_EVENT = "ora:composer-insert";
/** Asks the research page to show its files panel (the /files command). */
export const OPEN_FILES_EVENT = "ora:open-files";

export interface InsertDetail {
  text: string;
}

export function insertIntoComposer(path: string) {
  window.dispatchEvent(
    new CustomEvent<InsertDetail>(INSERT_EVENT, {
      detail: { text: mention(path) },
    }),
  );
}

/** How a path is named in a message: `@path`, quoted when it has spaces. */
export function mention(path: string) {
  return /\s/.test(path) ? `@"${path}" ` : `@${path} `;
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

export const parentOf = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

/** Rows of a CSV or TSV: quoted fields, doubled quotes and newlines in quotes. */
export function parseDelimited(text: string, delimiter = ",", limit = 500) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (rows.length >= limit) return { rows, more: i < text.length - 1 };
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return { rows, more: false };
}

/** Changes when a round or a job of the research ends: the files to read again. */
export function settledKey(
  sprints: { id: string; status: string }[],
  jobs: { id: string; status: string }[],
) {
  const ended = sprints.filter((s) => s.status !== "running").length;
  const done = jobs.filter((j) => j.status !== "running").length;
  return `${ended}:${done}`;
}
