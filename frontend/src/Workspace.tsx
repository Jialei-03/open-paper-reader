import { importArxiv } from "./lib/arxiv-import";
import { AgentLayoutProvider } from "./lib/agent-layout";
import { rememberPaper } from "./lib/recent-papers";
import { LiveNote } from "./components/LiveNote";
import { AgentPanel } from "./features/AgentPanel";
import { isIndependent, owningPaper } from "./lib/organization";
import { ContentBadge, ContentTypesContext } from "./components/ContentBadge";
import { Directions } from "./features/Directions";
import { KnowledgeGraph } from "./features/KnowledgeGraph";
import { buildKnowledge } from "./lib/knowledge";
import { Connections } from "./components/Connections";
import { Network } from "lucide-react";
import { QuickSearch } from "./components/QuickSearch";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from "./components/ui/breadcrumb";
import { Separator } from "./components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SidebarProvider, SidebarTrigger } from "./components/ui/sidebar";
import { WorkspaceSidebar } from "./components/WorkspaceSidebar";
import { Toaster } from "./components/ui/sonner";
import { toast as notify } from "sonner";
import { Button } from "@/components/ui/button";
import { useAppearance } from "./components/Appearance";
import React, { useState, useEffect, useRef } from "react";
import {
  BookOpen,
  Plus,
  ArrowUpRight,
  FileText,
  X,
  Check,
  Quote,
  Link as LinkIcon,
  LogOut,
  Trash2,
  History,
  Edit3,
  Menu,
  ShieldCheck,
} from "lucide-react";
import { api, send, date, kindLabel, Paper, Item, Locator } from "./api";
import { Modal, FeedbackContext } from "./components/Modal";
import { Markdown, Empty, PageHead } from "./components/shared";
import { PaperForm, ItemForm } from "./features/forms";
import { DropOverlay, useGlobalFileDrop } from "./features/PdfDropImport";
import { clearPaperCovers } from "./features/PaperCover";
import { importPdf, isPdf } from "./lib/pdf-import";
import { Reader } from "./features/Reader";
import { Dashboard } from "./features/Dashboard";
import { Recommendations } from "./features/Recommendations";
import { SettingsView } from "./features/SettingsView";
import { LibraryView } from "./features/LibraryView";
import {
  Clock,
  Star,
  Hash,
  Library,
  Layers,
  Compass,
  Settings,
  Search,
} from "lucide-react";
const navs = [
  ["dashboard", "最近", Clock],
  ["library", "我的文库", Library],
  ["recommendations", "发现论文", Compass],
  ["graph", "知识图谱", Network],
  ["settings", "空间设置", Settings],
] as const;
export function Workspace({
  user,
  setUser,
  error,
  setError,
}: {
  user: any;
  setUser: (user: any) => void;
  error: string;
  setError: (message: string) => void;
}) {
  const appearance = useAppearance();
  useEffect(() => {
    // The workspace loaded, so a stale-release reload (see main.tsx) worked.
    try {
      sessionStorage.removeItem("paper-stale-reload");
    } catch {
      /* Storage may be unavailable. */
    }
  }, []);
  const [searchOpen, setSearchOpen] = useState(false);
  const [route, setRoute] = useState(location.hash.slice(1) || "dashboard"),
    [tick, setTick] = useState(0),
    [modal, setModal] = useState<React.ReactNode>(null);
  const [directionNames, setDirectionNames] = useState<string[]>([]);
  const [archivedPapers, setArchivedPapers] = useState<Paper[]>([]);
  const [papers, setPapers] = useState<Paper[]>([]),
    [allItems, setAllItems] = useState<Item[]>([]);
  const routePath = route.split("?")[0];
  useEffect(() => {
    if (routePath === "notebook") {
      location.replace("#library");
      return;
    }
  }, [routePath]);

  const graph = React.useMemo(
    () => buildKnowledge([...papers, ...archivedPapers], allItems),
    [papers, archivedPapers, allItems],
  );
  const lastLibrary = useRef("library");
  const refresh = () => setTick((t) => t + 1);
  const go = (r: string) => {
    location.hash = r === "library" ? lastLibrary.current : r;
  };
  const close = () => {
    setModal(null);
    setError("");
  };
  const run = async (fn: () => Promise<any>, message = "已保存") => {
    try {
      setError("");
      await fn();
      if (message) notify.success(message);
      refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      refresh();
      return false;
    }
  };
  useEffect(() => {
    const f = () => setRoute(location.hash.slice(1) || "dashboard");
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    Promise.all([
      api<Paper[]>("/papers", { signal: controller.signal }),
      api<Item[]>("/items", { signal: controller.signal }),
      api<Paper[]>("/papers?archived=true", { signal: controller.signal }),
      api<{ items: { name: string }[] }>("/research-directions", {
        signal: controller.signal,
      }),
    ])
      .then(([p, i, archived, directions]) => {
        setDirectionNames(directions.items.map((d) => d.name));
        setArchivedPapers(archived);
        setPapers(p);
        setAllItems(i);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [user, tick, routePath]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 30000);
    const focus = () => refresh();
    window.addEventListener("focus", focus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, []);
  const recordedVisit = useRef("");
  useEffect(() => {
    if (!routePath.startsWith("paper/")) recordedVisit.current = "";
    if (user?.id && routePath.startsWith("paper/")) {
      const paperId = routePath.slice(6);
      if (recordedVisit.current === `${user.id}:${paperId}`) return;
      if (
        papers.some((paper) => paper.id === paperId) ||
        archivedPapers.some((paper) => paper.id === paperId)
      ) {
        rememberPaper(user.id, paperId);
        recordedVisit.current = `${user.id}:${paperId}`;
      }
    }
  }, [user?.id, routePath, papers, archivedPapers]);
  useEffect(() => {
    setModal(null);
  }, [route]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k" &&
        user &&
        !modal
      ) {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [user, modal]);
  const importing = useRef(false);
  const importPdfs = async (files: File[]) => {
    if (importing.current) {
      notify.info("正在导入论文，请稍候再试");
      return;
    }
    const pdfs = files.filter(isPdf);
    if (!pdfs.length) {
      notify.error("目前只能导入 PDF 文件");
      return;
    }
    if (pdfs.length < files.length)
      notify.warning(`已忽略 ${files.length - pdfs.length} 个非 PDF 文件`);
    importing.current = true;
    const toast = notify.loading(
      pdfs.length > 1 ? `正在导入 ${pdfs.length} 篇论文…` : "正在导入论文…",
    );
    const done: Paper[] = [];
    const failed: string[] = [];
    for (const [i, file] of pdfs.entries()) {
      notify.loading(
        pdfs.length > 1
          ? `正在导入 ${i + 1}/${pdfs.length}：${file.name}`
          : `正在导入「${file.name}」`,
        { id: toast },
      );
      try {
        done.push(await importPdf(file));
      } catch (e) {
        failed.push((e as Error).message);
      }
    }
    importing.current = false;
    if (done.length) {
      refresh();
      notify.success(
        done.length === 1
          ? "论文已导入，正在打开"
          : `已导入 ${done.length} 篇论文`,
        { id: toast },
      );
      go(done.length === 1 ? "paper/" + done[0].id : "library");
    } else notify.dismiss(toast);
    failed.forEach((message) => notify.error(message));
  };
  const dropping = useGlobalFileDrop(!!user, (files) => void importPdfs(files));
  const paperForm = (paper?: Paper) =>
    setModal(
      <PaperForm
        onUpload={(files) => void importPdfs(files)}
        onArxiv={async (url, onProgress) => {
          const p = await importArxiv(url, onProgress);
          go("paper/" + p.id);
          refresh();
          notify.success("论文与原版 PDF 已导入");
          close();
        }}
        nodes={graph.nodes.filter((n) => n.id !== "paper/" + paper?.id)}
        paper={paper}
        close={close}
        onSave={async (values) => {
          if (
            await run(async () => {
              const p = await send(
                "/papers" + (paper ? "/" + paper.id : ""),
                values,
                paper ? "PATCH" : "POST",
                paper?.revision,
              );
              go("paper/" + p.id);
            })
          ) {
            close();
          }
        }}
      />,
    );
  useEffect(() => {
    const saved = (event: Event) => {
      const item = (event as CustomEvent<Item>).detail;
      setAllItems((old) => old.map((i) => (i.id === item.id ? item : i)));
    };
    window.addEventListener("note-saved", saved);
    return () => window.removeEventListener("note-saved", saved);
  }, []);
  const history = (id: string) => {
    api<any[]>("/history/" + id)
      .then((rows) =>
        setModal(
          <Modal title="修订历史" close={close} wide>
            <p className="muted">
              每次修改保留内容与修改者。发生版本冲突时，重新打开编辑器后再保存。
            </p>
            {rows.map((r) => (
              <article className="history-entry" key={r.id}>
                <div className="eyebrow">
                  修订 {r.number} · {date(r.created_at)} ·{" "}
                  {r.actor.startsWith("agent:") ? "Agent" : "本人"}
                </div>
                <h3>{r.snapshot.title}</h3>
                <Markdown body={r.snapshot.body || r.snapshot.abstract || ""} />
                <details>
                  <summary>完整快照</summary>
                  <pre>{JSON.stringify(r.snapshot, null, 2)}</pre>
                </details>
              </article>
            ))}
          </Modal>,
        ),
      )
      .catch((e) => setError(e.message));
  };
  const editItem = (kind: string, paper?: Paper, item?: Item, loc?: Locator) =>
    setModal(
      <ItemForm
        nodes={graph.nodes.filter((n) => n.id !== "item/" + item?.id)}
        kind={kind}
        item={item}
        paper={paper}
        papers={papers}
        evidence={allItems.filter((i) => i.kind === "evidence")}
        defaultLocator={loc}
        close={close}
        onSave={async (values) => {
          if (
            await run(() =>
              send(
                "/items" + (item ? "/" + item.id : ""),
                values,
                item ? "PUT" : "POST",
                item?.revision,
              ),
            )
          )
            close();
        }}
      />,
    );
  const deleteItem = (i: Item) => {
    if (confirm("删除这条记录及其修订历史？此操作无法撤销。"))
      run(
        () =>
          api("/items/" + i.id, {
            method: "DELETE",
            headers: { "If-Match": String(i.revision) },
          }),
        "已删除",
      );
  };
  const jump = (i: Item) => {
    const parent = owningPaper(i);
    if (parent) {
      go(
        "paper/" +
          parent +
          (i.kind === "note"
            ? "?note=" + i.id
            : i.locator.file_id
              ? "?file=" +
                i.locator.file_id +
                "&page=" +
                (i.locator.page || 1) +
                (i.locator.line_start ? "&line=" + i.locator.line_start : "")
              : ""),
      );
    } else go("item/" + i.id);
  };
  if (routePath === "library") lastLibrary.current = route;
  const section = route.split(/[/?]/)[0],
    paperId = route.startsWith("paper/") ? route.slice(6).split("?")[0] : "";
  return (
    <ContentTypesContext.Provider
      value={Object.fromEntries(graph.nodes.map((n) => [n.route, n.kind]))}
    >
      <FeedbackContext.Provider value={error}>
        <AgentLayoutProvider key={user.id} userId={user.id}>
          <SidebarProvider
            className="app"
            style={
              {
                "--sidebar-width": "clamp(184px, 16.8vw, 250px)",
              } as React.CSSProperties
            }
          >
            <a
              className="skip-link"
              href="#main-content"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById("main-content")?.focus();
              }}
            >
              跳到主要内容
            </a>
            <WorkspaceSidebar
              directions={directionNames}
              papers={papers}
              section={section}
              navs={navs}
              onSearch={() => setSearchOpen(true)}
              username={user.username}
              go={go}
              logout={() =>
                run(async () => {
                  await send("/auth/logout", {});
                  void clearPaperCovers();
                  setUser(null);
                  setPapers([]);
                  setArchivedPapers([]);
                  setDirectionNames([]);
                  setAllItems([]);
                  setModal(null);
                }, "已退出")
              }
            />
            <main
              className={paperId ? "main paper-browser-main" : "main"}
              id="main-content"
              tabIndex={-1}
            >
              {!paperId && (
                <header className="workspace-mobile-nav">
                  <SidebarTrigger aria-label="打开导航" />
                  <span>
                    {navs.find((n) => n[0] === section)?.[1] || "纸间"}
                  </span>
                </header>
              )}
              <QuickSearch
                open={searchOpen}
                onOpenChange={setSearchOpen}
                papers={papers}
                items={allItems}
                go={go}
                add={() => paperForm()}
              />
              {error && !modal && (
                <Alert variant="destructive" className="my-3">
                  <AlertDescription className="flex items-center justify-between w-full">
                    <span>{error}</span>
                    <Button
                      variant="ghost"
                      type="button"
                      size="icon"
                      aria-label="关闭错误"
                      className="icon"
                      onClick={() => setError("")}
                    >
                      <X size={16} />
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
              {section === "dashboard" && (
                <Dashboard
                  notes={allItems}
                  route={route}
                  ownerId={user.id}
                  allPapers={papers}
                  onUpdated={refresh}
                  toggleFavorite={(p) =>
                    run(
                      () =>
                        send(
                          "/papers/" + p.id,
                          { favorite: !p.favorite },
                          "PATCH",
                          p.revision,
                        ),
                      p.favorite ? "已取消收藏" : "已收藏",
                    )
                  }
                  tick={tick}
                  go={go}
                  add={() => paperForm()}
                  onError={setError}
                />
              )}
              {section === "library" && (
                <LibraryView
                  notes={allItems}
                  ownerId={user.id}
                  onUpdated={refresh}
                  route={route}
                  allPapers={papers}
                  toggleFavorite={(p) =>
                    run(
                      () =>
                        send(
                          "/papers/" + p.id,
                          { favorite: !p.favorite },
                          "PATCH",
                          p.revision,
                        ),
                      p.favorite ? "已取消收藏" : "已收藏",
                    )
                  }
                  tick={tick}
                  go={go}
                  add={() => paperForm()}
                  onError={setError}
                />
              )}
              {section === "paper" && (
                <Reader
                  key={paperId}
                  id={paperId}
                  route={route}
                  tick={tick}
                  run={run}
                  go={go}
                  setModal={setModal}
                  close={close}
                  editPaper={paperForm}
                  editItem={editItem}
                  history={history}
                  deleteItem={deleteItem}
                  allItems={allItems}
                  nodes={graph.nodes}
                  onError={setError}
                />
              )}
              {section === "graph" && (
                <KnowledgeGraph
                  key={route}
                  graph={graph}
                  route={route}
                  go={go}
                />
              )}
              {section === "item" &&
                (() => {
                  const item = allItems.find(
                    (i) => "item/" + i.id === routePath,
                  );
                  return (
                    <div className="page flex flex-col gap-5">
                      {item ? (
                        <>
                          <section
                            className="content-document"
                            data-kind={item.kind}
                          >
                            <ContentBadge kind={item.kind} />
                            {item.kind === "note" ? (
                              <LiveNote
                                key={item.id}
                                note={item}
                                nodes={graph.nodes}
                              />
                            ) : (
                              <>
                                <PageHead
                                  eyebrow=""
                                  subtitle=""
                                  title={item.title || "未命名记录"}
                                  action={
                                    <Button
                                      variant="outline"
                                      onClick={() =>
                                        editItem(
                                          item.kind,
                                          papers.find(
                                            (p) => p.id === item.paper_id,
                                          ),
                                          item,
                                        )
                                      }
                                    >
                                      编辑
                                    </Button>
                                  }
                                />
                                <Markdown
                                  body={item.body}
                                  contentId={"item/" + item.id}
                                  reference={
                                    new URLSearchParams(
                                      route.split("?")[1],
                                    ).get("quote") || ""
                                  }
                                  prefix={
                                    new URLSearchParams(
                                      route.split("?")[1],
                                    ).get("prefix") || ""
                                  }
                                />
                              </>
                            )}
                          </section>
                          {item.locator.file_id && (
                            <Button
                              variant="outline"
                              onClick={() => jump(item)}
                            >
                              查看原文位置
                            </Button>
                          )}
                        </>
                      ) : (
                        <Empty text="内容不存在或已删除" />
                      )}
                    </div>
                  );
                })()}
              {section === "topics" && (
                <div className="page">
                  <PageHead
                    eyebrow="CONNECTED KNOWLEDGE"
                    title="主题积累"
                    subtitle="把跨论文的证据、问题与判断，整理成可以继续生长的笔记。"
                    action={
                      <Button
                        variant="default"
                        type="button"
                        className="primary"
                        onClick={() => editItem("topic")}
                      >
                        <Plus size={17} />
                        新建主题
                      </Button>
                    }
                  />
                  <div className="section-title">
                    <h2>
                      主题与比较{" "}
                      <span>
                        {
                          allItems.filter(
                            (i) =>
                              ["topic", "link"].includes(i.kind) &&
                              isIndependent(i),
                          ).length
                        }
                      </span>
                    </h2>
                    <Button
                      variant="outline"
                      type="button"
                      className="secondary"
                      onClick={() => editItem("link")}
                    >
                      <LinkIcon size={16} />
                      跨论文比较
                    </Button>
                  </div>
                  <div className="topic-grid">
                    {allItems
                      .filter(
                        (i) =>
                          ["topic", "link"].includes(i.kind) &&
                          isIndependent(i),
                      )
                      .map((i) => (
                        <article
                          className="topic-card"
                          data-kind={i.kind}
                          key={i.id}
                        >
                          <div className="eyebrow">
                            <ContentBadge kind={i.kind} /> ·{" "}
                            {i.paper_ids.length} 篇论文
                          </div>
                          <h2>
                            <a href={"#item/" + i.id}>
                              {i.title || "未命名主题"}
                            </a>
                          </h2>
                          <Markdown body={i.body} />
                          <div className="tags">
                            {i.tags.map((t) => (
                              <span key={t}>{t}</span>
                            ))}
                          </div>
                          <div className="linked-papers">
                            {i.paper_ids.map((id) => (
                              <Button
                                variant="ghost"
                                type="button"
                                key={id}
                                onClick={() => go("paper/" + id)}
                              >
                                <FileText size={15} />
                                {papers.find((p) => p.id === id)?.title ||
                                  "已归档论文"}
                                <ArrowUpRight size={14} />
                              </Button>
                            ))}
                          </div>
                          {i.evidence_ids.map((id) => {
                            const e = allItems.find((x) => x.id === id);
                            return e ? (
                              <Button
                                variant="ghost"
                                type="button"
                                className="evidence-link"
                                key={id}
                                onClick={() => jump(e)}
                              >
                                <Quote size={15} />
                                {e.title || e.body.slice(0, 100)} · 查看原文
                              </Button>
                            ) : null;
                          })}
                          <div className="actions">
                            <Button
                              variant="ghost"
                              type="button"
                              onClick={() => editItem(i.kind, undefined, i)}
                            >
                              <Edit3 size={14} />
                              编辑
                            </Button>
                            <Button
                              variant="ghost"
                              type="button"
                              onClick={() => history(i.id)}
                            >
                              <History size={14} />
                              历史
                            </Button>
                            <Button
                              variant="ghost"
                              type="button"
                              onClick={() => deleteItem(i)}
                            >
                              <Trash2 size={14} />
                              删除
                            </Button>
                          </div>
                        </article>
                      ))}
                  </div>
                  {!allItems.some(
                    (i) =>
                      ["topic", "link"].includes(i.kind) && isIndependent(i),
                  ) && (
                    <Empty text="新建一个研究主题，关联论文与证据，并写下你的综合判断。" />
                  )}
                </div>
              )}
              {section === "directions" && (
                <Directions tick={tick} run={run} onError={setError} />
              )}
              {section === "recommendations" && (
                <Recommendations
                  tick={tick}
                  go={go}
                  run={run}
                  onError={setError}
                />
              )}
              {![
                "dashboard",
                "library",
                "paper",
                "notebook",
                "topics",
                "directions",
                "recommendations",
                "graph",
                "item",
                "settings",
              ].includes(section) && (
                <div className="page">
                  <Empty text="这个页面不存在。" />
                  <Button
                    variant="default"
                    type="button"
                    className="primary"
                    onClick={() => go("library")}
                  >
                    回到文库
                  </Button>
                </div>
              )}
              {section === "settings" && (
                <SettingsView
                  user={user}
                  tick={tick}
                  run={run}
                  setModal={setModal}
                  close={close}
                />
              )}
            </main>
            <AgentPanel userId={user.id} route={route} refresh={refresh} />
            {modal}
            <DropOverlay active={dropping} />
            <Toaster theme={appearance.mode} position="bottom-center" />
          </SidebarProvider>
        </AgentLayoutProvider>
      </FeedbackContext.Provider>
    </ContentTypesContext.Provider>
  );
}
