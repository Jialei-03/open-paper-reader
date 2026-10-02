/**
 * Name a downloaded file after the paper, not after whatever the PDF happened
 * to be called when it was uploaded ("scan_0042.pdf", "2504.19413v1.pdf").
 */
export function paperFileName(title: string, suffix = "", ext = "pdf") {
  const clean =
    title
      // eslint-disable-next-line no-control-regex
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120)
      .trim() || "论文";
  return `${clean}${suffix}.${ext}`;
}
