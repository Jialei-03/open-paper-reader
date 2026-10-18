import { Copy, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import type { Paper } from "../../api";
import { useI18n } from "../../i18n/I18nProvider";
import {
  CITE_FORMATS,
  citeRecord,
  formatCitation,
  usePaperMetadata,
  type CiteFormat,
} from "../../lib/cite";
import { Button, SegmentedControl, toast } from "../../ui";
import styles from "./PaperRecord.module.css";

const FORMAT_LABEL: Record<CiteFormat, string> = {
  bibtex: "BibTeX",
  apa: "APA",
  gbt: "GB/T 7714",
};

/**
 * What the public sources say about a paper (where it appeared, when, how often
 * it is cited), looked up when first asked for and again on request; and the
 * paper as a reference in three formats, one click to copy.
 */
export function PaperRecord({ paper }: { paper: Paper }) {
  const { t, locale } = useI18n();
  const { meta, loading, error, refresh } = usePaperMetadata(paper.id);
  const [format, setFormat] = useState<CiteFormat>("bibtex");
  const numbers = useMemo(
    () => new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en"),
    [locale],
  );
  const known = meta?.status === "ok" ? meta : null;
  const text = useMemo(
    () => formatCitation(citeRecord(paper, meta), format),
    [paper, meta, format],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.show({ message: t("details.cite.copied"), tone: "success" });
    } catch {
      toast.show({ message: t("details.cite.copyFailed"), tone: "error" });
    }
  };

  const status = loading
    ? t("details.record.loading")
    : error
      ? t(
          error === "slow"
            ? "details.record.slow"
            : error === "noId"
              ? "details.record.noId"
              : "details.record.failed",
        )
      : meta?.status === "missing"
        ? t("details.record.missing")
        : "";
  const rows: [string, string][] = known
    ? (
        [
          [t("details.record.venue"), known.venue ?? ""],
          [t("details.record.year"), known.year ? String(known.year) : ""],
          [
            t("details.record.citations"),
            known.citation_count != null
              ? numbers.format(known.citation_count)
              : "",
          ],
          [
            t("details.record.references"),
            known.reference_count != null
              ? numbers.format(known.reference_count)
              : "",
          ],
        ] as [string, string][]
      ).filter(([, value]) => value)
    : [];

  return (
    <>
      <section className={styles.block} aria-labelledby="record-title">
        <div className={styles.head}>
          <h4 id="record-title">{t("details.record")}</h4>
          <Button
            size="sm"
            variant="ghost"
            icon={RefreshCw}
            loading={loading}
            aria-label={t("details.record.refreshLabel")}
            onClick={refresh}
          >
            {t("details.record.refresh")}
          </Button>
        </div>
        {rows.length > 0 && (
          <dl className={styles.facts} data-testid="paper-record">
            {rows.map(([label, value]) => (
              <div key={label} className={styles.fact}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {status && (
          <p
            className={error && !loading ? styles.error : styles.status}
            role={error && !loading ? "alert" : "status"}
          >
            {status}
          </p>
        )}
        {known && meta?.fetched_at && !loading && !error && (
          <p className={styles.status}>
            {t("details.record.source", {
              source: known.source || "—",
              date: new Date(meta.fetched_at).toLocaleDateString(
                locale === "zh" ? "zh-CN" : "en",
              ),
            })}
          </p>
        )}
      </section>
      <section className={styles.block} aria-labelledby="cite-title">
        <div className={styles.head}>
          <h4 id="cite-title">{t("details.cite")}</h4>
          <Button size="sm" variant="ghost" icon={Copy} onClick={copy}>
            {t("details.cite.copy")}
          </Button>
        </div>
        <SegmentedControl
          kind="radio"
          size="sm"
          label={t("details.cite.format")}
          value={format}
          onChange={setFormat}
          options={CITE_FORMATS.map((value) => ({
            value,
            label: FORMAT_LABEL[value],
          }))}
        />
        <pre className={styles.cite} tabIndex={0} data-testid="citation-text">
          {text}
        </pre>
        {!known && <p className={styles.status}>{t("details.cite.note")}</p>}
      </section>
    </>
  );
}
