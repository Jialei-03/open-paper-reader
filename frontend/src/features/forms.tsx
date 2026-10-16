import { ImportProgress } from "../components/ImportProgress";
import type { ImportProgress as ImportState } from "../lib/arxiv-import";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { LinkPicker } from "../components/LinkPicker";
import type { KnowledgeNode } from "../lib/knowledge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldGroup,
  FieldSet,
  FieldLegend,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Choice } from "@/components/Choice";
import { useState, useEffect } from "react";
import { api, kindLabel, Paper, SourceFile, Item, Locator } from "../api";
import { Markdown } from "../components/shared";
import { Modal } from "../components/Modal";
import { PdfDropZone } from "./PdfDropImport";
export function PaperForm({
  nodes = [],
  paper,
  close,
  onSave,
  onArxiv,
  onUpload,
}: {
  nodes?: KnowledgeNode[];
  paper?: Paper;
  close: () => void;
  onSave: (data: any) => Promise<void>;
  onArxiv?: (
    url: string,
    onProgress: (value: ImportState) => void,
  ) => Promise<void>;
  onUpload?: (files: File[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<ImportState | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [importError, setImportError] = useState("");
  useEffect(() => {
    if (!importing) return;
    const start = Date.now();
    setElapsed(0);
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - start) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [importing]);
  const [abstract, setAbstract] = useState(paper?.abstract || "");
  return (
    <Modal title={paper ? "编辑论文资料" : "导入论文"} close={close}>
      {!paper && onUpload && (
        <PdfDropZone
          onFiles={(files) => {
            close();
            onUpload(files);
          }}
        />
      )}
      {!paper && onArxiv && (
        <form
          className="mb-6"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            setImporting(true);
            setProgress(null);
            setImportError("");
            try {
              await onArxiv(
                String(new FormData(e.currentTarget).get("arxiv")),
                setProgress,
              );
            } catch (error) {
              setImportError((error as Error).message);
            } finally {
              setBusy(false);
              setImporting(false);
            }
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="arxiv-import">从 arXiv 导入</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="arxiv-import"
                  name="arxiv"
                  required
                  disabled={busy}
                  placeholder="arXiv 编号或摘要、HTML、PDF 链接"
                />
                <Button disabled={busy} type="submit">
                  {importing && <Spinner data-icon="inline-start" />}
                  {importing ? "正在导入…" : "获取论文"}
                </Button>
              </div>
            </Field>
            {importing && (
              <Alert role="status">
                <AlertDescription>
                  <ImportProgress value={progress} />
                  <span>已等待 {elapsed} 秒。</span>
                  {elapsed >= 20
                    ? "arXiv 响应较慢，仍在等待，请勿重复提交。"
                    : "导入完成后会自动打开论文。"}
                </AlertDescription>
              </Alert>
            )}
            {importError && (
              <Alert variant="destructive">
                <AlertDescription>{importError}</AlertDescription>
              </Alert>
            )}
          </FieldGroup>
        </form>
      )}
      {paper ? (
        <p className="muted">也可以手动填写资料，再上传附件。</p>
      ) : (
        <div className="import-divider">
          <span>或手动填写资料，再上传附件</span>
        </div>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          const f = new FormData(e.currentTarget);
          setBusy(true);
          await onSave({
            title: f.get("title"),
            authors: f.get("authors"),
            external_id: f.get("external_id"),
            abstract: f.get("abstract"),
            tags: String(f.get("tags"))
              .split(/[,，]/)
              .map((x) => x.trim())
              .filter(Boolean),
            ...(!paper
              ? {
                  version_label: f.get("version_label"),
                  provenance: f.get("provenance"),
                }
              : {}),
          });
          setBusy(false);
        }}
      >
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel className="flex flex-col items-start gap-2">
              论文标题
              <Input
                name="title"
                required
                maxLength={500}
                defaultValue={paper?.title}
                placeholder="输入论文完整标题"
              />
            </FieldLabel>
          </Field>
          <Field>
            <FieldLabel className="flex flex-col items-start gap-2">
              作者
              <Input
                name="authors"
                defaultValue={paper?.authors}
                placeholder="多个作者以分号分隔"
              />
            </FieldLabel>
          </Field>
          <div className="form-row">
            <Field>
              <FieldLabel className="flex flex-col items-start gap-2">
                标识 / arXiv ID
                <Input
                  name="external_id"
                  defaultValue={paper?.external_id}
                  placeholder="例如 arxiv:2601.06966"
                />
              </FieldLabel>
            </Field>
            <Field>
              <FieldLabel className="flex flex-col items-start gap-2">
                标签
                <Input
                  name="tags"
                  defaultValue={paper?.tags.join(", ")}
                  placeholder="记忆, 智能体"
                />
              </FieldLabel>
            </Field>
          </div>
          {!paper && (
            <div className="form-row">
              <Field>
                <FieldLabel className="flex flex-col items-start gap-2">
                  版本名称
                  <Input name="version_label" required defaultValue="v1" />
                </FieldLabel>
              </Field>
              <Field>
                <FieldLabel className="flex flex-col items-start gap-2">
                  来源与溯源
                  <Input
                    name="provenance"
                    placeholder="来源 URL、获取日期等（仅记录，不抓取）"
                  />
                </FieldLabel>
              </Field>
            </div>
          )}
          <Field>
            <FieldLabel className="flex flex-col items-start gap-2">
              摘要
              <Textarea
                name="abstract"
                rows={5}
                value={abstract}
                onChange={(e) => setAbstract(e.target.value)}
                placeholder="粘贴原文摘要；不会自动生成论文内容"
              />
            </FieldLabel>
          </Field>
          <LinkPicker
            nodes={nodes}
            insert={(text) => setAbstract((value) => value + "\n" + text)}
          />
          <footer>
            <Button
              variant="outline"
              type="button"
              className="secondary"
              onClick={close}
            >
              取消
            </Button>
            <Button
              variant="default"
              type="submit"
              className="primary"
              disabled={busy}
            >
              {busy && !importing ? "保存中…" : paper ? "保存资料" : "创建论文"}
            </Button>
          </footer>
        </FieldGroup>
      </form>
    </Modal>
  );
}
export function ItemForm({
  nodes = [],
  kind,
  item,
  paper,
  papers,
  evidence,
  defaultLocator,
  close,
  onSave,
}: {
  kind: string;
  item?: Item;
  nodes?: KnowledgeNode[];
  paper?: Paper;
  papers: Paper[];
  evidence: Item[];
  defaultLocator?: Locator;
  close: () => void;
  onSave: (data: any) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [files, setFiles] = useState<SourceFile[]>([]),
    [fileError, setFileError] = useState(""),
    [locOn, setLocOn] = useState(
      kind === "evidence" || !!item?.locator.file_id || !!defaultLocator,
    ),
    [fileId, setFileId] = useState(
      item?.locator.file_id || defaultLocator?.file_id || "",
    ),
    [preview, setPreview] = useState(false),
    [body, setBody] = useState(item?.body || "");
  const loc = item?.locator || defaultLocator;
  useEffect(() => {
    if (paper)
      api<SourceFile[]>("/papers/" + paper.id + "/files")
        .then(setFiles)
        .catch((e) => setFileError(e.message));
  }, [paper?.id]);
  const source = files.find((f) => f.id === fileId);
  return (
    <Modal
      title={(item ? "编辑" : "新建") + kindLabel[kind]}
      close={close}
      wide
    >
      {fileError && (
        <Alert variant="destructive" className="my-3">
          <AlertDescription>
            无法加载原文文件：{fileError}。请重新打开编辑器后保存。
          </AlertDescription>
        </Alert>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          if (locOn && !source) return;
          const f = new FormData(e.currentTarget);
          setBusy(true);
          const val = {
            kind,
            paper_id: item?.paper_id || paper?.id || null,
            title: f.get("title"),
            body,
            status: f.get("status") || "open",
            tags: String(f.get("tags") || "")
              .split(/[,，]/)
              .map((t) => t.trim())
              .filter(Boolean),
            paper_ids: f.getAll("paper_ids"),
            evidence_ids: f.getAll("evidence_ids"),
            locator:
              locOn && source
                ? {
                    version_id: source.version_id,
                    file_id: source.id,
                    quote: f.get("quote") || "",
                    ...(source.mime === "application/pdf"
                      ? { page: Number(f.get("page")) || 1 }
                      : source.mime.startsWith("text/")
                        ? {
                            line_start: Number(f.get("line_start")) || 1,
                            line_end:
                              Number(f.get("line_end")) ||
                              Number(f.get("line_start")) ||
                              1,
                          }
                        : { label: f.get("region") || "图像全图" }),
                  }
                : null,
          };
          await onSave(val);
          setBusy(false);
        }}
      >
        <FieldGroup className="gap-4">
          <div className="form-row">
            <Field>
              <FieldLabel className="flex flex-col items-start gap-2">
                标题
                <Input
                  name="title"
                  defaultValue={item?.title}
                  required={["topic", "link"].includes(kind)}
                  maxLength={500}
                  placeholder={
                    kind === "question"
                      ? "你想进一步弄清什么？"
                      : "为这条积累起个名字"
                  }
                />
              </FieldLabel>
            </Field>
            {kind === "question" && (
              <Field>
                <FieldLabel className="flex flex-col items-start gap-2">
                  问题状态
                  <Choice name="status" defaultValue={item?.status || "open"}>
                    <option value="open">待解答</option>
                    <option value="resolved">已解决</option>
                  </Choice>
                </FieldLabel>
              </Field>
            )}
          </div>
          <div className="editor-label">
            <Field>
              <FieldLabel
                htmlFor="item-body"
                className="flex flex-col items-start gap-2"
              >
                {kind === "evidence"
                  ? "原文摘录与说明"
                  : kind === "analysis"
                    ? "外部 Agent 的解读（手动录入会标记为本人写入）"
                    : "正文"}{" "}
                · Markdown
              </FieldLabel>
            </Field>
            <Button
              variant="ghost"
              type="button"
              onClick={() => setPreview(!preview)}
            >
              {preview ? "继续编辑" : "预览排版"}
            </Button>
          </div>
          {preview ? (
            <div className="editor-preview">
              <Markdown
                body={body}
                contentId={item ? "item/" + item.id : undefined}
              />
            </div>
          ) : (
            <MarkdownEditor value={body} onChange={setBody} />
          )}
          <LinkPicker
            nodes={nodes}
            insert={(text) => setBody((value) => value + "\n" + text)}
          />
          {paper && kind !== "note" && (
            <>
              <Field>
                <FieldLabel className="check">
                  <Checkbox
                    checked={locOn}
                    disabled={kind === "evidence"}
                    onCheckedChange={(checked) => setLocOn(checked === true)}
                  />
                  关联稳定的原文位置
                </FieldLabel>
              </Field>
              {locOn && (
                <div className="locator-form">
                  <Field>
                    <FieldLabel className="flex flex-col items-start gap-2">
                      源文件（保留所属版本）
                      <Choice
                        aria-label="定位文件"
                        value={fileId}
                        onValueChange={(value) => setFileId(value)}
                        required
                      >
                        <option value="">选择源文件</option>
                        {files.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.source_path}
                          </option>
                        ))}
                      </Choice>
                    </FieldLabel>
                  </Field>
                  {source?.mime === "application/pdf" ? (
                    <Field>
                      <FieldLabel
                        key={"pdf-" + fileId}
                        className="flex flex-col items-start gap-2"
                      >
                        PDF 页码
                        <Input
                          name="page"
                          required
                          type="number"
                          min={1}
                          max={source.pages || 1}
                          defaultValue={
                            loc?.file_id === fileId ? loc?.page || 1 : 1
                          }
                        />
                      </FieldLabel>
                    </Field>
                  ) : source?.mime.startsWith("text/") ? (
                    <div className="form-row" key={"text-" + fileId}>
                      <Field>
                        <FieldLabel className="flex flex-col items-start gap-2">
                          起始行
                          <Input
                            name="line_start"
                            type="number"
                            min={1}
                            defaultValue={loc?.line_start || 1}
                          />
                        </FieldLabel>
                      </Field>
                      <Field>
                        <FieldLabel className="flex flex-col items-start gap-2">
                          结束行
                          <Input
                            name="line_end"
                            type="number"
                            min={1}
                            defaultValue={loc?.line_end || loc?.line_start || 1}
                          />
                        </FieldLabel>
                      </Field>
                    </div>
                  ) : (
                    <Field>
                      <FieldLabel className="flex flex-col items-start gap-2">
                        图表 / 区域标识
                        <Input
                          name="region"
                          defaultValue={loc?.label || "图像全图"}
                        />
                      </FieldLabel>
                    </Field>
                  )}
                  <Field>
                    <FieldLabel className="flex flex-col items-start gap-2">
                      原文引句
                      <Textarea
                        name="quote"
                        rows={2}
                        defaultValue={loc?.quote}
                      />
                    </FieldLabel>
                  </Field>
                </div>
              )}
            </>
          )}
          {["topic", "link"].includes(kind) && (
            <>
              <Field>
                <FieldLabel className="flex flex-col items-start gap-2">
                  标签
                  <Input
                    name="tags"
                    defaultValue={item?.tags.join(", ")}
                    placeholder="用逗号分隔；也用于解释推荐关联"
                  />
                </FieldLabel>
              </Field>
              <FieldSet>
                <FieldLegend>
                  关联论文{kind === "link" ? "（至少两篇）" : ""}
                </FieldLegend>
                {papers.length ? (
                  papers.map((p) => (
                    <Field key={p.id}>
                      <FieldLabel className="check">
                        <Checkbox
                          name="paper_ids"
                          value={p.id}
                          defaultChecked={item?.paper_ids.includes(p.id)}
                        />
                        {p.title}
                      </FieldLabel>
                    </Field>
                  ))
                ) : (
                  <p className="muted">先导入论文，再建立关联。</p>
                )}
              </FieldSet>
            </>
          )}
          {kind !== "evidence" && kind !== "note" && (
            <FieldSet>
              <FieldLegend>引用已有原文证据</FieldLegend>
              {evidence.length ? (
                evidence.map((i) => (
                  <Field key={i.id}>
                    <FieldLabel className="check">
                      <Checkbox
                        name="evidence_ids"
                        value={i.id}
                        defaultChecked={item?.evidence_ids.includes(i.id)}
                      />
                      {i.title || i.body.slice(0, 90)}
                    </FieldLabel>
                  </Field>
                ))
              ) : (
                <p className="muted">
                  先在阅读页添加证据，随后可以在这里引用。
                </p>
              )}
            </FieldSet>
          )}
          <footer>
            <Button
              variant="outline"
              type="button"
              className="secondary"
              onClick={close}
            >
              取消
            </Button>
            <Button
              variant="default"
              type="submit"
              className="primary"
              disabled={busy || (locOn && !source)}
            >
              {busy ? "保存中…" : "保存" + kindLabel[kind]}
            </Button>
          </footer>
        </FieldGroup>
      </form>
    </Modal>
  );
}
