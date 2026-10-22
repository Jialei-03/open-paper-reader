import { Ban, MoreHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type Paper } from "../../api";
import { useI18n } from "../../i18n/I18nProvider";
import { readerHash } from "../../reader/route";
import { IconButton, Menu, toast } from "../../ui";
import { failure } from "../setup/model-api";
import { ConfirmDialog, Section, formatDate } from "./Section";
import styles from "./Settings.module.css";

type Share = {
  id: string;
  file_name: string;
  note_title: string;
  expires_at: string;
  revoked_at: string | null;
};
type PaperShares = { paper: Paper; share: Share };
type Token = {
  id: string;
  name: string;
  scopes: string[];
  expires: string;
  revoked: boolean;
};

const live = (expires: string) => new Date(expires) > new Date();

/** How many papers are asked for their links at a time. */
const AT_ONCE = 4;

/** Every link to a paper that still works: the service lists them paper by paper. */
async function readShares(signal: AbortSignal): Promise<PaperShares[]> {
  const [active, archived] = await Promise.all([
    api<Paper[]>("/papers", { signal }),
    api<Paper[]>("/papers?archived=true", { signal }),
  ]);
  const papers = [...active, ...archived];
  const found: PaperShares[] = [];
  for (let at = 0; at < papers.length; at += AT_ONCE) {
    const batch = papers.slice(at, at + AT_ONCE);
    const lists = await Promise.all(
      batch.map((paper) =>
        api<Share[]>(`/papers/${paper.id}/shares`, { signal }).catch(
          () => [] as Share[],
        ),
      ),
    );
    batch.forEach((paper, index) => {
      for (const share of lists[index])
        if (!share.revoked_at && live(share.expires_at))
          found.push({ paper, share });
    });
  }
  return found;
}

type Pending =
  | { kind: "share"; item: PaperShares }
  | { kind: "token"; item: Token };

/** The ways in that were handed out (share links, agent credentials): they can only be revoked here. */
export function AccessSection({ go }: { go(hash: string): void }) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const [shares, setShares] = useState<PaperShares[] | null>(null);
  const [tokens, setTokens] = useState<Token[] | null>(null);
  const [shareError, setShareError] = useState("");
  const [tokenError, setTokenError] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    readShares(signal).then(setShares, (reason) => {
      if (!signal.aborted)
        setShareError(failure(reason, i18n, "settings.loadError"));
    });
    api<Token[]>("/tokens", { signal }).then(
      (rows) =>
        setTokens(rows.filter((row) => !row.revoked && live(row.expires))),
      (reason) => {
        if (!signal.aborted)
          setTokenError(failure(reason, i18n, "settings.loadError"));
      },
    );
    return () => controller.abort();
    // Read once per visit.
  }, []);

  const revoke = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.kind === "share") {
        const { paper, share } = pending.item;
        await api(`/papers/${paper.id}/shares/${share.id}`, {
          method: "DELETE",
        });
        setShares(
          (old) => old?.filter((row) => row.share.id !== share.id) ?? old,
        );
        toast.show({ tone: "success", message: t("settings.shares.revoked") });
      } else {
        const token = pending.item;
        await api(`/tokens/${token.id}`, { method: "DELETE" });
        setTokens((old) => old?.filter((row) => row.id !== token.id) ?? old);
        toast.show({ tone: "success", message: t("settings.tokens.revoked") });
      }
      setPending(null);
    } catch (reason) {
      toast.show({
        tone: "error",
        message: failure(reason, i18n, "settings.revokeError"),
      });
    } finally {
      setBusy(false);
    }
  };

  const title = (paper: Paper) => paper.title || t("reader.untitled");
  return (
    <Section hideHeading title={t("settings.access.title")}>
      <h3 className={styles.subTitle}>{t("settings.shares.title")}</h3>
      {shareError ? (
        <p role="alert" className={styles.error}>
          {shareError}
        </p>
      ) : !shares ? (
        <div
          className={styles.skeleton}
          role="status"
          aria-label={t("common.loading")}
        />
      ) : shares.length === 0 ? (
        <div className={styles.empty}>{t("settings.shares.empty")}</div>
      ) : (
        <ul className={styles.list} aria-label={t("settings.shares.title")}>
          {shares.map((row) => (
            <li key={row.share.id} className={styles.row}>
              <div className={styles.rowText}>
                <button
                  type="button"
                  className={`${styles.rowTitle} ${styles.link}`}
                  onClick={() => go(readerHash({ paperId: row.paper.id }))}
                >
                  {title(row.paper)}
                </button>
                <span className={styles.rowMeta}>
                  {t("settings.shares.meta", {
                    file: row.share.file_name,
                    date: formatDate(row.share.expires_at, locale),
                  })}
                </span>
              </div>
              <div className={styles.rowActions}>
                <Menu
                  label={t("customize.more", { name: title(row.paper) })}
                  items={[
                    {
                      id: "revoke",
                      icon: Ban,
                      label: t("settings.revoke"),
                      danger: true,
                      onSelect: () => setPending({ kind: "share", item: row }),
                    },
                  ]}
                  trigger={(props) => (
                    <IconButton
                      {...props}
                      icon={MoreHorizontal}
                      label={t("customize.more", { name: title(row.paper) })}
                    />
                  )}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      <h3 className={styles.subTitle}>{t("settings.tokens.title")}</h3>
      {tokenError ? (
        <p role="alert" className={styles.error}>
          {tokenError}
        </p>
      ) : !tokens ? (
        <div
          className={styles.skeleton}
          role="status"
          aria-label={t("common.loading")}
        />
      ) : tokens.length === 0 ? (
        <div className={styles.empty}>{t("settings.tokens.empty")}</div>
      ) : (
        <ul className={styles.list} aria-label={t("settings.tokens.title")}>
          {tokens.map((token) => (
            <li key={token.id} className={styles.row}>
              <div className={styles.rowText}>
                <span className={styles.rowTitle}>{token.name}</span>
                <span className={styles.rowMeta}>
                  {t("settings.tokens.meta", {
                    scope: t(
                      token.scopes.includes("write")
                        ? "settings.tokens.readWrite"
                        : "settings.tokens.read",
                    ),
                    date: formatDate(token.expires, locale),
                  })}
                </span>
              </div>
              <div className={styles.rowActions}>
                <Menu
                  label={t("customize.more", { name: token.name })}
                  items={[
                    {
                      id: "revoke",
                      icon: Ban,
                      label: t("settings.revoke"),
                      danger: true,
                      onSelect: () =>
                        setPending({ kind: "token", item: token }),
                    },
                  ]}
                  trigger={(props) => (
                    <IconButton
                      {...props}
                      icon={MoreHorizontal}
                      label={t("customize.more", { name: token.name })}
                    />
                  )}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!pending}
        title={t(
          pending?.kind === "token"
            ? "settings.tokens.revokeTitle"
            : "settings.shares.revokeTitle",
        )}
        confirm={t("settings.revoke")}
        busy={busy}
        onClose={() => setPending(null)}
        onConfirm={() => void revoke()}
      />
    </Section>
  );
}
