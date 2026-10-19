import { api } from "../../api";

/** At most this many pictures go with one question (backend agents.py RunInput). */
export const MAX_IMAGES = 5;
/** The service's limit for one attachment (backend agent_attachments.py). */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];

/** A picture put in the question box: shown at once, uploaded meanwhile. */
export interface ComposerImage {
  key: string;
  name: string;
  /** What the box shows: the file itself until the service has it. */
  preview: string;
  /** The service's id once uploaded. */
  id?: string;
  status: "uploading" | "ready" | "failed";
}

/** An attachment as the service lists it with a run (backend agent_attachments.py `metadata`). */
export interface RunAttachment {
  id: string;
  name: string;
  mime: string;
  url: string;
}

export const isImage = (file: Pick<File, "type">) =>
  IMAGE_TYPES.includes(file.type);

/** The picture as the browser may show it (served inline, not as a download). */
export const attachmentPreview = (attachment: RunAttachment) =>
  `${attachment.url}?preview=true`;

/** Sends a picture to the service; its attachment's id. */
export async function uploadImage(file: File): Promise<string> {
  const body = new FormData();
  // A pasted screenshot has no useful name; the service wants an extension it knows.
  const extension = file.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
  const name = /\.[a-z0-9]+$/i.test(file.name)
    ? file.name
    : `image.${extension}`;
  body.append("file", file, name);
  const value = await api<RunAttachment>("/agent/attachments", {
    method: "POST",
    body,
  });
  return value.id;
}

/** The image files among what was pasted or dropped. */
export function imageFiles(list: DataTransfer | null): File[] {
  if (!list) return [];
  const files = Array.from(list.files ?? []);
  if (files.length) return files.filter(isImage);
  return Array.from(list.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => !!file && isImage(file));
}
