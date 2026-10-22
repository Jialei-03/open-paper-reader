import { MoreHorizontal, Users } from "lucide-react";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "../../i18n/I18nProvider";
import { Button, Dialog, IconButton, Menu } from "../../ui";
import { CustomizeHeader } from "./CustomizeHeader";
import {
  listRoles,
  readRole,
  ROLE_NAMES,
  type ResearchRole,
} from "./roles-api";
import styles from "./CustomizeScreen.module.css";

export function RolesSection() {
  const { t } = useI18n();
  const [roles, setRoles] = useState<ResearchRole[] | null>(null);
  const [selected, setSelected] = useState<ResearchRole | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [reads, setReads] = useState(0);
  const name = (role: ResearchRole) =>
    ROLE_NAMES[role.id] ? t(ROLE_NAMES[role.id]) : role.title;

  useEffect(() => {
    let cancelled = false;
    setError("");
    listRoles().then(
      (value) => {
        if (!cancelled) setRoles(value);
      },
      () => {
        if (!cancelled) setError(t("settings.loadError"));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [reads, t]);

  useEffect(() => {
    let cancelled = false;
    setBody(null);
    setDetailError("");
    if (selected)
      readRole(selected.id).then(
        (value) => {
          if (!cancelled) setBody(value.body);
        },
        () => {
          if (!cancelled) setDetailError(t("settings.loadError"));
        },
      );
    return () => {
      cancelled = true;
    };
  }, [selected, reads, t]);

  const rows = roles?.filter((role) =>
    `${name(role)} ${role.id}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <>
      <CustomizeHeader
        title={t("customize.roles")}
        query={query}
        onQuery={setQuery}
      />
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <Button onClick={() => setReads((n) => n + 1)}>
            {t("common.retry")}
          </Button>
        </div>
      ) : !roles ? (
        <p className={styles.status}>{t("common.loading")}</p>
      ) : (
        <ul className={styles.list}>
          {rows?.map((role) => (
            <li key={role.id} className={styles.row}>
              <Users className={styles.icon} size={22} aria-hidden />
              <button
                className={styles.rowButton}
                onClick={() => setSelected(role)}
              >
                <span className={styles.name}>{name(role)}</span>
                <span className={styles.status}>{t("customize.readOnly")}</span>
              </button>
              <Menu
                label={t("customize.more", { name: name(role) })}
                placement={{ side: "bottom", align: "end" }}
                items={[
                  {
                    id: "view",
                    label: t("customize.view"),
                    onSelect: () => setSelected(role),
                  },
                ]}
                trigger={(props) => (
                  <IconButton
                    {...props}
                    icon={MoreHorizontal}
                    label={t("customize.more", { name: name(role) })}
                  />
                )}
              />
            </li>
          ))}
          {!rows?.length && (
            <li className={styles.empty}>{t("customize.empty")}</li>
          )}
        </ul>
      )}
      <Dialog
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? name(selected) : t("customize.roles")}
        size="lg"
      >
        {detailError ? (
          <div role="alert">
            <p>{detailError}</p>
            <Button onClick={() => setReads((n) => n + 1)}>
              {t("common.retry")}
            </Button>
          </div>
        ) : body === null ? (
          <p className={styles.status}>{t("common.loading")}</p>
        ) : (
          <article className={styles.markdown}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
          </article>
        )}
      </Dialog>
    </>
  );
}
