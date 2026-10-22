import { FileUp, Link } from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import type { Imports } from "../../import/useImports";
import { Button, Dialog, Menu, TextField } from "../../ui";
import styles from "./LibraryScreen.module.css";

export function LibraryImport({
  imports,
  open,
  onOpen,
  onClose,
}: {
  imports: Imports;
  open: boolean;
  onOpen(): void;
  onClose(): void;
}) {
  const { t } = useI18n();
  const formId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!url.trim()) return;
    imports.importUrl(url.trim());
    setUrl("");
    onClose();
  };
  const chooseFiles = () => input.current?.click();
  return (
    <>
      <Menu
        label={t("library.import")}
        placement={{ side: "bottom", align: "end" }}
        trigger={(props) => (
          <Button {...props} variant="primary" icon={FileUp}>
            {t("library.import")}
          </Button>
        )}
        items={[
          {
            id: "pdf",
            icon: FileUp,
            label: t("library.import.pdf"),
            onSelect: chooseFiles,
          },
          {
            id: "arxiv",
            icon: Link,
            label: t("import.arxiv.label"),
            onSelect: onOpen,
          },
        ]}
      />
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        data-testid="import-file-input"
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          event.target.value = "";
          if (files.length) {
            imports.importFiles(files);
            onClose();
          }
        }}
      />
      <Dialog
        open={open}
        onClose={onClose}
        title={t("library.import")}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              form={formId}
              variant="primary"
              icon={FileUp}
              disabled={!url.trim()}
            >
              {t("library.import")}
            </Button>
          </>
        }
      >
        <div className={styles.importOptions}>
          <Button icon={FileUp} onClick={chooseFiles}>
            {t("library.import.pdf")}
          </Button>
          <form id={formId} className={styles.arxiv} onSubmit={submit}>
            <TextField
              label={t("import.arxiv.label")}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              spellCheck={false}
              autoComplete="off"
              data-autofocus
            />
          </form>
        </div>
      </Dialog>
    </>
  );
}
