import { api, type Paper } from "../api";

export type ImportProgress = {
  stage: string;
  received: number;
  total: number | null;
  attempt?: number;
  waiting_seconds?: number;
};

export async function importWithProgress<T = Paper>(
  path: string,
  body: unknown,
  onProgress?: (value: ImportProgress) => void,
): Promise<T> {
  const token = crypto.randomUUID();
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  onProgress?.({ stage: "metadata", received: 0, total: null });
  const poll = async () => {
    try {
      const value = await api<ImportProgress>(
        "/import/arxiv/progress/" + token,
        {
          signal: controller.signal,
        },
      );
      if (active) onProgress?.(value);
    } catch {
      // Progress is advisory; a missed poll must not cancel the import.
    }
    if (active) timer = setTimeout(poll, 700);
  };
  if (onProgress) timer = setTimeout(poll, 350);
  try {
    return await api<T>(path, {
      method: "POST",
      headers: { "X-Import-ID": token, "Idempotency-Key": token },
      body: JSON.stringify(body),
    });
  } finally {
    active = false;
    clearTimeout(timer);
    controller.abort();
  }
}

export const importArxiv = (
  url: string,
  onProgress?: (value: ImportProgress) => void,
) => importWithProgress<Paper>("/import/arxiv", { url }, onProgress);

/** Any other address: a publisher's page or a PDF link (the service reads arXiv and alphaxiv ones as arXiv). */
export const importUrl = (
  url: string,
  onProgress?: (value: ImportProgress) => void,
) => importWithProgress<Paper>("/import/url", { url }, onProgress);
