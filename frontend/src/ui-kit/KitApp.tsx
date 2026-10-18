import {
  Archive,
  Bookmark,
  BookOpen,
  Copy,
  Download,
  FileText,
  Info,
  Languages,
  Library,
  NotebookPen,
  Pencil,
  Plus,
  Search,
  Settings,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { I18nProvider, useI18n } from "../i18n/I18nProvider";
import { isLocale } from "../i18n/i18n";
import {
  Button,
  Card,
  CardHeader,
  Dialog,
  ErrorBoundary,
  IconButton,
  Kbd,
  Menu,
  MenuList,
  SegmentedControl,
  Shell,
  Sidebar,
  SidebarItem,
  SidebarSection,
  TextArea,
  TextField,
  Toaster,
  Tooltip,
  parseAppearance,
  toast,
  useAppearance,
  type ButtonVariant,
  type MenuEntry,
} from "../ui";
import styles from "./KitApp.module.css";

// The kit's own chrome (headings, labels) is not localized: it is a developer
// page, not the product. Only the demos of localized components are.

/** One component's demo. Each task adds its own <Section> to KitApp. */
function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  const headingId = `kit-${id}`;
  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId} className={styles.sectionTitle}>
        {title}
      </h2>
      {children}
    </section>
  );
}

const surfaces = [
  "--ui-bg",
  "--ui-bg-1",
  "--ui-bg-2",
  "--ui-bg-3",
  "--ui-elev",
  "--ui-desk",
  "--ui-paper",
];
const fills = [
  "--ui-accent",
  "--ui-accent-soft",
  "--ui-primary",
  "--ui-danger",
  "--ui-danger-soft",
  "--ui-highlight",
  "--ui-selection",
];
const texts = [
  "--ui-fg",
  "--ui-fg-1",
  "--ui-fg-2",
  "--ui-fg-3",
  "--ui-accent-text",
  "--ui-danger-text",
  "--ui-success-text",
  "--ui-warning-text",
];
const sizes = [11, 12, 13, 14, 15, 16, 18, 20, 24, 30];
const radii = [4, 6, 8, 10, 12, 16, 20, 24];
const shadows = ["--ui-elev-1", "--ui-elev-2", "--ui-elev-composer"];

function Swatches({ names }: { names: string[] }) {
  return (
    <div className={styles.grid}>
      {names.map((name) => (
        <figure key={name} className={styles.swatch}>
          <div
            className={styles.swatchColor}
            style={{ background: `var(${name})` }}
          />
          <figcaption>{name}</figcaption>
        </figure>
      ))}
    </div>
  );
}

function Tokens() {
  return (
    <Section id="tokens" title="Tokens">
      <h3 className={styles.groupTitle}>Surfaces</h3>
      <Swatches names={surfaces} />
      <h3 className={styles.groupTitle}>Fills</h3>
      <Swatches names={fills} />
      <h3 className={styles.groupTitle}>Text</h3>
      <div className={styles.texts}>
        {texts.map((name) => (
          <p key={name} style={{ color: `var(${name})` }}>
            纸间 Zhijian <code>{name}</code>
          </p>
        ))}
      </div>
      <h3 className={styles.groupTitle}>Type scale</h3>
      <div className={styles.texts}>
        {sizes.map((size) => (
          <p key={size} style={{ fontSize: `var(--ui-text-${size})` }}>
            纸间 Zhijian {size}
          </p>
        ))}
      </div>
      <h3 className={styles.groupTitle}>Radius</h3>
      <div className={styles.grid}>
        {radii.map((radius) => (
          <figure key={radius} className={styles.swatch}>
            <div
              className={styles.swatchColor}
              style={{ borderRadius: `var(--ui-r-${radius})` }}
            />
            <figcaption>--ui-r-{radius}</figcaption>
          </figure>
        ))}
      </div>
      <h3 className={styles.groupTitle}>Elevation</h3>
      <div className={styles.grid}>
        {shadows.map((name) => (
          <figure key={name} className={styles.swatch}>
            <div
              className={styles.elevation}
              style={{ boxShadow: `var(${name})` }}
            />
            <figcaption>{name}</figcaption>
          </figure>
        ))}
      </div>
    </Section>
  );
}

function I18nDemo() {
  const { tn } = useI18n();
  return (
    <Section id="i18n" title="I18n">
      <p>{tn("kit.sample.pages", 1)}</p>
      <p>{tn("kit.sample.pages", 3)}</p>
    </Section>
  );
}

const buttonVariants: [ButtonVariant, string][] = [
  ["primary", "Primary"],
  ["secondary", "Secondary"],
  ["ghost", "Ghost"],
  ["danger", "Danger"],
];

function ButtonDemo() {
  const [clicks, setClicks] = useState(0);
  const count = () => setClicks((n) => n + 1);
  return (
    <Section id="button" title="Button">
      <h3 className={styles.groupTitle}>Variants and sizes</h3>
      {(["md", "sm"] as const).map((size) => (
        <div key={size} role="group" aria-label={size} className={styles.row}>
          {buttonVariants.map(([variant, label]) => (
            <Button key={variant} variant={variant} size={size} onClick={count}>
              {label}
            </Button>
          ))}
        </div>
      ))}
      <h3 className={styles.groupTitle}>With an icon</h3>
      <div role="group" aria-label="With an icon" className={styles.row}>
        <Button variant="primary" icon={Plus} onClick={count}>
          New note
        </Button>
        <Button icon={Download} onClick={count}>
          Export
        </Button>
        <Button variant="danger" icon={Trash2} onClick={count}>
          Remove
        </Button>
        <Button size="sm" icon={Plus} onClick={count}>
          Add
        </Button>
      </div>
      <h3 className={styles.groupTitle}>Loading and disabled</h3>
      <div role="group" aria-label="States" className={styles.row}>
        <Button variant="primary" loading onClick={count}>
          Saving
        </Button>
        <Button loading icon={Download} onClick={count}>
          Loading
        </Button>
        <Button size="sm" loading onClick={count}>
          Small
        </Button>
        <Button disabled onClick={count}>
          Disabled
        </Button>
        <Button variant="primary" disabled onClick={count}>
          Primary disabled
        </Button>
      </div>
      <h3 className={styles.groupTitle}>Long label</h3>
      <div className={styles.narrow}>
        <Button icon={Download} onClick={count}>
          A remarkably long label that will not fit in this box
        </Button>
      </div>
      <h3 className={styles.groupTitle}>Icon button</h3>
      <div role="group" aria-label="Icon buttons" className={styles.row}>
        <IconButton icon={Search} label="Search" onClick={count} />
        <IconButton
          icon={SlidersHorizontal}
          label="Adjust"
          size="sm"
          onClick={count}
        />
        <IconButton
          icon={Bookmark}
          label="Bookmark"
          variant="secondary"
          onClick={count}
        />
        <IconButton icon={Download} label="Fetching" loading />
      </div>
      <h3 className={styles.groupTitle}>Shortcut labels</h3>
      <div className={styles.row}>
        <Kbd shortcut="mod+k" />
        <Kbd shortcut="shift+enter" />
        <Kbd shortcut={"mod+\\"} />
      </div>
      <p className={styles.groupTitle}>
        Clicks: <output>{clicks}</output>
      </p>
    </Section>
  );
}

function FieldDemo() {
  return (
    <Section id="field" title="Field">
      <div className={styles.fields}>
        <TextField
          label="Base URL"
          description="The address of an OpenAI-compatible API"
          placeholder="https://api.example.com/v1"
        />
        <TextField
          label="API key"
          error="This address is not reachable"
          placeholder="Paste a key"
        />
        <TextField
          label="Search papers"
          hideLabel
          placeholder="Search papers"
        />
        <TextField label="Disabled" disabled defaultValue="Not editable" />
        <TextArea
          label="Question"
          autoGrow
          placeholder="Ask about this paper"
        />
        <TextArea
          label="Notes"
          autoGrow
          defaultValue={"First line\nSecond line\nThird line"}
        />
      </div>
    </Section>
  );
}

function TooltipDemo() {
  const [marked, setMarked] = useState(false);
  return (
    <Section id="tooltip" title="Tooltip">
      <div role="group" aria-label="Tooltips" className={styles.row}>
        <IconButton icon={Bookmark} label="Add bookmark" shortcut="mod+d" />
        <IconButton icon={Search} label="Find" />
      </div>
      {/* Hard against the corner: the tooltip has to flip up and slide in. */}
      <IconButton className={styles.corner} icon={Info} label="Corner" />
      {/* After the corner button, which the keyboard reaches from Find. Shown by its owner (as the reader does for a highlight under the page's text), not by hovering the mark. */}
      <div role="group" aria-label="Tooltip on command" className={styles.row}>
        <Button aria-pressed={marked} onClick={() => setMarked(!marked)}>
          Show the note
        </Button>
        <Tooltip content="A note on this passage" open={marked}>
          <span
            className={styles.mark}
            role="img"
            aria-label="Marked passage"
          />
        </Tooltip>
      </div>
    </Section>
  );
}

/** The menu of one item's actions; the Menu section and the Dialog section both show it. */
function itemActions(pick: (label: string) => () => void): MenuEntry[] {
  return [
    {
      id: "rename",
      label: "Rename",
      icon: Pencil,
      shortcut: "r",
      onSelect: pick("Rename"),
    },
    {
      id: "duplicate",
      label: "Duplicate",
      icon: Copy,
      onSelect: pick("Duplicate"),
    },
    {
      id: "archive",
      label: "Archive",
      icon: Archive,
      disabled: true,
      onSelect: pick("Archive"),
    },
    { kind: "separator", id: "separator" },
    {
      id: "delete",
      label: "Delete",
      icon: Trash2,
      danger: true,
      onSelect: pick("Delete"),
    },
  ];
}

function MenuDemo() {
  const [selected, setSelected] = useState<string | null>(null);
  const pick = (label: string) => () => setSelected(label);
  const actions = itemActions(pick);
  // The row of actions a later phase puts over a selection of text; here it just sits on the page.
  const onSelection: MenuEntry[] = [
    {
      id: "explain",
      label: "Explain",
      icon: Sparkles,
      onSelect: pick("Explain"),
    },
    {
      id: "translate",
      label: "Translate",
      icon: Languages,
      disabled: true,
      onSelect: pick("Translate"),
    },
    { id: "copy", label: "Copy", icon: Copy, onSelect: pick("Copy") },
  ];
  return (
    <Section id="menu" title="Menu">
      <div className={styles.row}>
        <Menu
          label="Item actions"
          items={actions}
          trigger={(props) => <Button {...props}>More</Button>}
        />
        <Button onClick={() => setSelected(null)}>Clear</Button>
        <p>Selected: {selected ?? "none"}</p>
      </div>
      <h3 className={styles.groupTitle}>Horizontal list</h3>
      <div className={styles.fit}>
        <MenuList
          label="Selection actions"
          items={onSelection}
          orientation="horizontal"
          autoFocus="none"
          onClose={() => undefined}
        />
      </div>
    </Section>
  );
}

function DialogDemo() {
  const [renaming, setRenaming] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const actions = itemActions((label) => () => setSelected(label));
  return (
    <Section id="dialog" title="Dialog">
      <div className={styles.row}>
        <Button onClick={() => setRenaming(true)}>Open dialog</Button>
        <Button onClick={() => setDiscarding(true)}>Open locked dialog</Button>
        <Button onClick={() => setEditing(true)}>Open wide dialog</Button>
      </div>

      <Dialog
        open={renaming}
        onClose={() => setRenaming(false)}
        title="Rename paper"
        description="The new name appears in your library."
        footer={
          <>
            <Button onClick={() => setRenaming(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => setRenaming(false)}>
              Save
            </Button>
          </>
        }
      >
        <div className={styles.stack}>
          <TextField
            label="Name"
            data-autofocus
            defaultValue="Attention is all you need"
          />
          <div className={styles.row}>
            <Menu
              label="Item actions"
              items={actions}
              trigger={(props) => <Button {...props}>More</Button>}
            />
            <p>Selected: {selected ?? "none"}</p>
          </div>
        </div>
      </Dialog>

      {/* Not dismissible, and the focus starts on the safe choice. */}
      <Dialog
        open={discarding}
        onClose={() => setDiscarding(false)}
        title="Discard changes?"
        description="Your edits to this paper will be lost."
        size="sm"
        dismissible={false}
        initialFocus={keep}
        footer={
          <>
            <Button ref={keep} onClick={() => setDiscarding(false)}>
              Keep editing
            </Button>
            <Button variant="danger" onClick={() => setDiscarding(false)}>
              Discard
            </Button>
          </>
        }
      >
        <p>
          Closing this dialog is a choice: Escape and the backdrop do nothing.
        </p>
      </Dialog>

      {/* No description and nothing marked for the focus; and a dialog opens another on top. */}
      <Dialog
        open={editing}
        onClose={() => setEditing(false)}
        title="Paper details"
        size="lg"
        footer={
          <>
            <Button onClick={() => setEditing(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => setEditing(false)}>
              Save
            </Button>
          </>
        }
      >
        <div className={styles.stack}>
          <TextArea label="Summary" autoGrow placeholder="What is it about" />
          <div className={styles.row}>
            <Button variant="danger" onClick={() => setDiscarding(true)}>
              Discard changes
            </Button>
          </div>
        </div>
      </Dialog>
    </Section>
  );
}

type Panel = "guide" | "assistant" | "translation" | "notes";

const panels: {
  value: Panel;
  label: string;
  icon: LucideIcon;
  text: string;
}[] = [
  {
    value: "guide",
    label: "Guide",
    icon: BookOpen,
    text: "A short guide to the paper.",
  },
  {
    value: "assistant",
    label: "Assistant",
    icon: Sparkles,
    text: "Ask a question about the paper.",
  },
  {
    value: "translation",
    label: "Translation",
    icon: Languages,
    text: "The paper in your language.",
  },
  {
    value: "notes",
    label: "Notes",
    icon: NotebookPen,
    text: "Your notes on the paper.",
  },
];

function SegmentedDemo() {
  const [panel, setPanel] = useState<Panel>("guide");
  const [theme, setTheme] = useState<"dark" | "light" | "system">("dark");
  const [fit, setFit] = useState<"width" | "page" | "actual">("width");
  const [narrow, setNarrow] = useState<"first" | "second" | "third">("first");
  return (
    <Section id="segmented" title="Segmented">
      <h3 className={styles.groupTitle}>Tabs</h3>
      <div className={styles.row}>
        <SegmentedControl
          kind="tabs"
          label="Reading panels"
          options={panels.map(({ value, label, icon }) => ({
            value,
            label,
            icon,
            panelId: `kit-panel-${value}`,
          }))}
          value={panel}
          onChange={setPanel}
        />
        <Button onClick={() => setPanel("guide")}>Show Guide</Button>
      </div>
      {panels.map(({ value, label, text }) => (
        <div
          key={value}
          role="tabpanel"
          id={`kit-panel-${value}`}
          aria-labelledby={`kit-panel-${value}-tab`}
          hidden={panel !== value}
        >
          <p>
            {label}: {text}
          </p>
        </div>
      ))}
      <h3 className={styles.groupTitle}>Radio</h3>
      <div className={styles.row}>
        <SegmentedControl
          kind="radio"
          label="Theme"
          options={[
            { value: "dark", label: "Dark" },
            { value: "light", label: "Light" },
            { value: "system", label: "System" },
          ]}
          value={theme}
          onChange={setTheme}
        />
        <p>
          Chosen: <output>{theme}</output>
        </p>
      </div>
      <h3 className={styles.groupTitle}>Small</h3>
      <SegmentedControl
        kind="radio"
        size="sm"
        label="Page fit"
        options={[
          { value: "width", label: "Fit width" },
          { value: "page", label: "Fit page" },
          { value: "actual", label: "Actual size" },
        ]}
        value={fit}
        onChange={setFit}
      />
      <h3 className={styles.groupTitle}>Long labels</h3>
      <div className={styles.narrow}>
        <SegmentedControl
          kind="radio"
          label="Narrow"
          options={[
            { value: "first", label: "A remarkably long label" },
            { value: "second", label: "Another one that is long" },
            { value: "third", label: "And a third" },
          ]}
          value={narrow}
          onChange={setNarrow}
        />
      </div>
    </Section>
  );
}

function ToastDemo() {
  const [retry, setRetry] = useState("idle");
  const [behind, setBehind] = useState(false);
  // The toast comes once the dialog is open, so that it is the newer of the two in the top layer.
  useEffect(() => {
    if (behind) toast.show({ message: "Over the dialog", tone: "success" });
  }, [behind]);
  return (
    <Section id="toast" title="Toast">
      <div className={styles.row}>
        <Button onClick={() => toast.show({ message: "Copied" })}>
          Show info
        </Button>
        <Button
          onClick={() =>
            toast.show({
              message: "Import failed",
              tone: "error",
              description: "The file is not a PDF.",
              action: { label: "Retry", onClick: () => setRetry("Retried") },
            })
          }
        >
          Show error
        </Button>
        <Button onClick={() => setBehind(true)}>Show over dialog</Button>
      </div>
      <p className={styles.groupTitle}>
        Retry: <output>{retry}</output>
      </p>
      <Dialog
        open={behind}
        onClose={() => setBehind(false)}
        title="Under the toast"
        description="A notification raised while this is open shows above it."
        size="sm"
        footer={<Button onClick={() => setBehind(false)}>Done</Button>}
      >
        <p>The toast can be reached while the page behind is shut.</p>
      </Dialog>
    </Section>
  );
}

/** A child that fails as it draws, the way a bug in a region would. */
function Fragile({ broken }: { broken: boolean }) {
  // Its own state, to show that trying again starts the child over.
  const [count, setCount] = useState(0);
  if (broken) throw new Error("The preview failed as it drew");
  return (
    <div className={styles.preview}>
      <p>The preview is fine.</p>
      <Button size="sm" onClick={() => setCount((value) => value + 1)}>
        Count: {count}
      </Button>
    </div>
  );
}

function ErrorBoundaryDemo() {
  const { t } = useI18n();
  const [broken, setBroken] = useState(false);
  const [resets, setResets] = useState(0);
  return (
    <Section id="errorboundary" title="ErrorBoundary">
      <div className={styles.row}>
        <Button onClick={() => setBroken(true)}>Make the preview throw</Button>
        <p>
          Resets: <output>{resets}</output>
        </p>
      </div>
      <div className={styles.boundary}>
        <ErrorBoundary
          label={t("kit.sample.region")}
          onReset={() => {
            setBroken(false);
            setResets((count) => count + 1);
          }}
        >
          <Fragile broken={broken} />
        </ErrorBoundary>
      </div>
      <p>The rest of the page is outside the boundary and carries on.</p>
    </Section>
  );
}

const paperTitle = "Attention Is All You Need";
const longTitle =
  "A Remarkably Long Paper Title That Will Not Fit In The Sidebar";

/** What each of the side card's tabs shows. */
const sideTexts: Record<Panel, string> = {
  guide: "The idea in a few lines, and where to start reading.",
  assistant: "Ask about a passage and the answer points back to the page.",
  translation: "The paragraph under the pointer, in your language.",
  notes: "What you wrote down while reading, in order.",
};

type Place = "reading" | "library" | "long";

/** A sample window: the pieces of the new interface, laid out as the product will. */
function Kit() {
  const { mode, setMode } = useAppearance();
  const { locale, setLocale } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [place, setPlace] = useState<Place>("reading");
  const [side, setSide] = useState<Panel>("guide");
  const idle = () => undefined;
  return (
    <div className={styles.kit}>
      <Shell
        sidebar={
          <Sidebar
            label="Workspace"
            collapsed={collapsed}
            onCollapsedChange={setCollapsed}
            header="UI kit"
            footer={
              <SidebarItem icon={Settings} label="Settings" onClick={idle} />
            }
          >
            <SidebarSection>
              <SidebarItem icon={Upload} label="Import" onClick={idle} />
              <SidebarItem icon={Search} label="Search" onClick={idle} />
            </SidebarSection>
            <SidebarSection title="Papers">
              <SidebarItem
                icon={BookOpen}
                label="Reading"
                dot
                active={place === "reading"}
                onClick={() => setPlace("reading")}
              />
              <SidebarItem
                icon={Library}
                label="Library"
                meta="128"
                active={place === "library"}
                onClick={() => setPlace("library")}
              />
              <SidebarItem
                icon={FileText}
                label={longTitle}
                active={place === "long"}
                onClick={() => setPlace("long")}
              />
            </SidebarSection>
          </Sidebar>
        }
      >
        <Card as="main" className={styles.paper} aria-labelledby="kit-paper">
          <CardHeader>
            <h1 id="kit-paper" className={styles.title}>
              {paperTitle}
            </h1>
            <select
              className={styles.select}
              aria-label="Kit theme"
              value={mode}
              onChange={(event) => setMode(parseAppearance(event.target.value))}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
            <select
              className={styles.select}
              aria-label="Kit locale"
              value={locale}
              onChange={(event) => {
                if (isLocale(event.target.value)) setLocale(event.target.value);
              }}
            >
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
            <IconButton icon={Share2} label="Share paper" />
          </CardHeader>
          <div className={styles.scroll}>
            <Tokens />
            <I18nDemo />
            <ButtonDemo />
            <FieldDemo />
            <TooltipDemo />
            <MenuDemo />
            <DialogDemo />
            <SegmentedDemo />
            <ToastDemo />
            <ErrorBoundaryDemo />
          </div>
        </Card>
        <Card as="aside" className={styles.side} aria-label="Assistant">
          <CardHeader>
            <SegmentedControl
              kind="tabs"
              size="sm"
              label="Side panel"
              options={panels.map(({ value, label, icon }) => ({
                value,
                label,
                icon,
                panelId: `kit-side-${value}`,
              }))}
              value={side}
              onChange={setSide}
            />
          </CardHeader>
          <div className={styles.scroll}>
            {panels.map(({ value }) => (
              <div
                key={value}
                role="tabpanel"
                id={`kit-side-${value}`}
                aria-labelledby={`kit-side-${value}-tab`}
                hidden={side !== value}
              >
                <p className={styles.sideText}>{sideTexts[value]}</p>
              </div>
            ))}
          </div>
        </Card>
      </Shell>
      <Toaster />
    </div>
  );
}

export function KitApp() {
  return (
    <I18nProvider>
      <Kit />
    </I18nProvider>
  );
}
