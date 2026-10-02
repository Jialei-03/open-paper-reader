import { useAgentLayout } from "../lib/agent-layout";
import { Brand } from "./Brand";
import { NavPill } from "./NavPill";
import { Avatar, AvatarFallback } from "./ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "./ui/dropdown-menu";
import { ChevronsUpDown, Settings, Bot } from "lucide-react";
import { BookOpen, Search, Clock, Star, Hash, LogOut } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Paper } from "../api";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarTrigger,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuBadge,
  useSidebar,
} from "./ui/sidebar";
import { Button } from "./ui/button";

export function WorkspaceSidebar({
  directions,
  papers,
  section,
  navs,
  username,
  go,
  logout,
  onSearch,
}: {
  directions: string[];
  papers: Paper[];
  section: string;
  navs: readonly (readonly [string, string, LucideIcon])[];
  username: string;
  go: (route: string) => void;
  logout: () => void;
  onSearch: () => void;
}) {
  const { setOpenMobile } = useSidebar();
  const agentLayout = useAgentLayout();
  const navigate = (route: string) => {
    go(route);
    setOpenMobile(false);
  };
  return (
    <Sidebar
      className="workspace-sidebar"
      role="navigation"
      aria-label="主导航"
    >
      <SidebarHeader>
        <div className="workspace-brand-row">
          {/* The toggle is the first thing in the corner, so it is in the same
              place whether the navigation is open or closed. */}
          <SidebarTrigger aria-label="收起导航" />
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <a href="#dashboard" onClick={() => setOpenMobile(false)}>
                  <Brand />
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              data-nav="dashboard"
              isActive={section === "dashboard"}
              aria-current={section === "dashboard" ? "page" : undefined}
              onClick={() => navigate("dashboard")}
            >
              <Clock />
              <span>最近</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="workspace-search-button"
              onClick={() => {
                setOpenMobile(false);
                onSearch();
              }}
            >
              <Search />
              <span>搜索文库</span>
              <kbd className="ml-auto">⌘ K</kbd>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                data-nav="agent"
                aria-label="打开研究助手"
                isActive={agentLayout.open}
                onClick={() => {
                  agentLayout.setOpen((v) => !v);
                  setOpenMobile(false);
                }}
              >
                <Bot />
                <span>研究助手</span>
                <span className="nav-ai-label">AI</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarMenu>
            {navs
              .filter(([key]) => key !== "settings" && key !== "dashboard")
              .map(([key, label, Icon]) => {
                const active =
                  section === key || (section === "paper" && key === "library");
                return (
                  <SidebarMenuItem key={key} data-nav-item={key}>
                    {active && <NavPill />}
                    <SidebarMenuButton
                      data-nav={key}
                      data-pill={active ? "true" : undefined}
                      isActive={active}
                      aria-current={active ? "page" : undefined}
                      onClick={() => navigate(key)}
                    >
                      <Icon />
                      <span>{label}</span>
                    </SidebarMenuButton>
                    {key === "library" && (
                      <SidebarMenuBadge>{papers.length}</SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                );
              })}
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>文库</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => navigate("library?status=unread")}
              >
                <Clock />
                <span>未读论文</span>
              </SidebarMenuButton>
              <SidebarMenuBadge>
                {papers.filter((p) => p.reading_status === "unread").length}
              </SidebarMenuBadge>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                data-nav="favorites"
                onClick={() => navigate("library?favorite=true")}
              >
                <Star />
                <span>已收藏</span>
              </SidebarMenuButton>
              <SidebarMenuBadge>
                {papers.filter((p) => p.favorite).length}
              </SidebarMenuBadge>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <details className="workspace-direction-group">
            <summary>研究方向</summary>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={() => navigate("directions")}>
                  <Settings />
                  <span>管理研究方向</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            <SidebarMenu>
              {directions.slice(0, 5).map((tag) => (
                <SidebarMenuItem key={tag}>
                  <SidebarMenuButton
                    onClick={() =>
                      navigate("library?tag=" + encodeURIComponent(tag))
                    }
                  >
                    <Hash />
                    <span>{tag}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </details>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => navigate("offline")}>
              本机论文 · 离线使用
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarMenu className="workspace-footer-settings">
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <a href="#docs/start" target="_blank" rel="noopener noreferrer">
                <BookOpen />
                <span>使用文档</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              aria-label="空间设置"
              title="空间设置"
              isActive={section === "settings"}
              onClick={() => navigate("settings")}
            >
              <Settings />
              <span>空间设置</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" aria-label={username}>
                  <Avatar>
                    <AvatarFallback>
                      {username.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate">{username}</span>
                  <ChevronsUpDown className="ml-auto" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuItem onSelect={logout}>
                    <LogOut />
                    退出登录
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
