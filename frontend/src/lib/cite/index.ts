import { formatApa } from "./apa";
import { formatBibtex, formatBibtexFile } from "./bibtex";
import { formatGbt } from "./gbt";
import type { CiteFormat, CiteRecord } from "./types";

export * from "./types";
export {
  loadMetadata,
  refreshMetadata,
  useMetadataFill,
  useMetadataMap,
  usePaperMetadata,
  type MetadataState,
} from "./metadata";
export { formatApa, formatBibtex, formatBibtexFile, formatGbt };

export const CITE_FORMATS: readonly CiteFormat[] = ["bibtex", "apa", "gbt"];

export function formatCitation(
  record: CiteRecord,
  format: CiteFormat,
  today = new Date(),
) {
  if (format === "bibtex") return formatBibtex(record);
  if (format === "apa") return formatApa(record);
  return formatGbt(record, today);
}
