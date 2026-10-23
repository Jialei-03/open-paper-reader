import { useId, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { Button, Dialog, TextArea, TextField } from "../../ui";
import {
  convertAgentDocument,
  importAgentDocument,
} from "../research/team-api";
import type {
  LibraryMember,
  MemberConfig,
  MemberPermissions,
  Team,
} from "../research/team-api";
import type { ModelRow } from "../setup/model-api";
import {
  avatarColors,
  initials,
  memberDraft,
  memberName,
  permissionChange,
  validMember,
  documentDraft,
  withMemberPermissions,
} from "./member-model";
import styles from "./Members.module.css";

export function MemberAvatar({
  name,
  color = "blue",
}: {
  name: string;
  color?: string;
}) {
  return (
    <span className={styles.avatar} data-color={color} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
export function PermissionFields({
  value,
  machines,
  onChange,
}: {
  value: MemberPermissions;
  machines: { id: string; name: string }[];
  onChange(p: MemberPermissions): void;
}) {
  const { t } = useI18n();
  return (
    <fieldset className={styles.checks}>
      <legend>{t("members.permissions")}</legend>
      {(
        ["papers", "files", "commands", "readonly", "file_readonly"] as const
      ).map((key) => (
        <label key={key}>
          <input
            type="checkbox"
            checked={value[key] ?? false}
            disabled={key === "commands" && value.readonly}
            onChange={(e) =>
              onChange(permissionChange(value, key, e.target.checked))
            }
          />
          {t(`members.permission.${key}`)}
        </label>
      ))}
      <fieldset className={styles.checks}>
        <legend>{t("members.machines")}</legend>
        {machines.map((m) => (
          <label key={m.id}>
            <input
              type="checkbox"
              checked={value.machines.includes(m.id)}
              onChange={(e) =>
                onChange({
                  ...value,
                  machines: e.target.checked
                    ? [...value.machines, m.id]
                    : value.machines.filter((id) => id !== m.id),
                })
              }
            />
            {m.name}
          </label>
        ))}
      </fieldset>
    </fieldset>
  );
}
export function MemberFields({
  draft,
  identityLocked,
  models,
  machines,
  body = true,
  onChange,
}: {
  draft: MemberConfig;
  identityLocked: boolean;
  body?: boolean;
  models: ModelRow[];
  machines: { id: string; name: string }[];
  onChange(d: MemberConfig): void;
}) {
  const { t } = useI18n();
  const modelId = useId();
  const colorId = useId();
  const set = (patch: Partial<MemberConfig>) =>
    onChange({ ...draft, ...patch });
  return (
    <>
      <div className={styles.identity}>
        <MemberAvatar name={draft.name} color={draft.avatar_color} />
        <TextField
          required
          maxLength={100}
          label={t("members.name")}
          value={draft.name}
          disabled={identityLocked}
          onChange={(e) => set({ name: e.target.value })}
        />
      </div>
      <div className={styles.field}>
        <label htmlFor={colorId}>{t("members.color")}</label>
        <select
          id={colorId}
          value={draft.avatar_color}
          disabled={identityLocked}
          onChange={(e) => set({ avatar_color: e.target.value })}
        >
          {avatarColors.map((color) => (
            <option value={color} key={color}>
              {t(`members.color.${color}`)}
            </option>
          ))}
        </select>
      </div>
      <TextField
        label={t("members.summary")}
        value={draft.description ?? ""}
        maxLength={5000}
        onChange={(e) => set({ description: e.target.value })}
      />
      {body && (
        <TextArea
          label={t("members.description")}
          rows={6}
          maxLength={50000}
          value={draft.role_description}
          disabled={identityLocked}
          onChange={(e) => set({ role_description: e.target.value })}
        />
      )}
      <div className={styles.field}>
        <label htmlFor={modelId}>{t("commands.model")}</label>
        <select
          id={modelId}
          value={draft.model_config_id}
          onChange={(e) => set({ model_config_id: e.target.value })}
        >
          <option value="">{t("members.teamModel")}</option>
          {draft.model_config_id &&
            !models.some((m) => m.id === draft.model_config_id) && (
              <option value={draft.model_config_id}>
                {draft.model_config_id}
              </option>
            )}
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name || m.model}
            </option>
          ))}
        </select>
      </div>
      <PermissionFields
        value={draft.permissions}
        machines={machines}
        onChange={(permissions) =>
          onChange(withMemberPermissions(draft, permissions))
        }
      />
      <fieldset className={styles.checks}>
        <legend>{t("members.tools")}</legend>
        {["literature", "files", "shell", "experiments", "web", "project"].map(
          (tool) => (
            <label key={tool}>
              <input
                type="checkbox"
                disabled={
                  draft.permissions.readonly &&
                  ["shell", "experiments"].includes(tool)
                }
                checked={
                  draft.tools?.includes(tool) ??
                  {
                    literature: draft.permissions.papers,
                    files: draft.permissions.files,
                    shell: draft.permissions.commands,
                    experiments: draft.permissions.commands,
                    web: true,
                    project: true,
                  }[tool] ??
                  false
                }
                onChange={(e) => {
                  const current =
                    withMemberPermissions(draft, draft.permissions).tools ?? [];
                  const tools = e.target.checked
                    ? [...current, tool]
                    : current.filter((v) => v !== tool);
                  set({
                    tools,
                    permissions: {
                      ...draft.permissions,
                      papers: tools.includes("literature"),
                      files: tools.includes("files"),
                      commands:
                        tools.includes("shell") ||
                        tools.includes("experiments"),
                    },
                  });
                }}
              />
              {tool}
            </label>
          ),
        )}
      </fieldset>
      <div className={styles.budget}>
        <TextField
          label={t("members.turns")}
          type="number"
          min={1}
          max={256}
          required
          value={draft.wake_turns}
          onChange={(e) => set({ wake_turns: Number(e.target.value) })}
        />
        <TextField
          label={t("members.tokens")}
          type="number"
          min={0}
          max={2000000}
          placeholder={t("team.unlimited")}
          value={draft.wake_tokens || ""}
          onChange={(e) => set({ wake_tokens: Number(e.target.value) })}
        />
        <TextField
          label={t("members.minutes")}
          type="number"
          min={1}
          max={1440}
          required
          value={draft.wake_minutes ?? 20}
          onChange={(e) => set({ wake_minutes: Number(e.target.value) })}
        />
      </div>
    </>
  );
}
export function MemberEditor({
  initial,
  initialSource = "",
  initialError = "",
  initialSubscriptions = [],
  role = "custom",
  creating = false,
  team,
  library,
  models,
  machines,
  onSave,
  onClose,
}: {
  initial?: MemberConfig;
  initialSource?: string;
  initialError?: string;
  initialSubscriptions?: string[];
  role?: string;
  builtin?: boolean;
  creating?: boolean;
  team: Team;
  library: LibraryMember[];
  models: ModelRow[];
  machines: { id: string; name: string }[];
  onSave(
    config: MemberConfig,
    subscriptions: string[],
    source: string,
    document?: string,
  ): Promise<void>;
  onClose(): void;
}) {
  const { t } = useI18n();
  const form = useId();
  const sourceId = useId();
  const [draft, setDraft] = useState(() => memberDraft(initial));
  const [subscriptions, setSubscriptions] = useState(initialSubscriptions);
  const [source, setSource] = useState("");
  const [document, setDocument] = useState(initialSource);
  const [mode, setMode] = useState<"form" | "source">(
    initialError ? "source" : "form",
  );
  const [importing, setImporting] = useState(false);
  const [paste, setPaste] = useState("");
  const [format, setFormat] = useState("agent.md");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(initialError);
  const librarySource = source.startsWith("l:");
  const adopt = (value: Awaited<ReturnType<typeof convertAgentDocument>>) => {
    const next = documentDraft(value, team.channels);
    setDraft(next.draft);
    setDocument(next.source);
    setSubscriptions(next.subscriptions);
    setWarnings(value.warnings);
    setError("");
    return next;
  };
  const convert = () =>
    convertAgentDocument(
      team.workspace_id,
      document,
      mode === "form" ? draft : undefined,
      mode === "form"
        ? team.channels
            .filter((c) => subscriptions.includes(c.id))
            .map((c) => `#${c.name}`)
        : undefined,
      role,
    );
  const changeMode = async (next: "form" | "source") => {
    if (next === mode) return;
    if (next === "source" && !document && !draft.name.trim()) {
      setDocument('---\nname: ""\n---\n\n' + draft.role_description);
      setMode("source");
      return;
    }
    setSaving(true);
    try {
      adopt(await convert());
      setMode(next);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  };
  const importText = async (content: string, filename: string) => {
    setSaving(true);
    try {
      adopt(await importAgentDocument(team.workspace_id, content, filename));
      setSource("");
      setImporting(false);
      setMode("form");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      size="lg"
      title={t(creating ? "members.add" : "members.edit")}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            form={form}
            type="submit"
            disabled={mode === "form" && !validMember(draft)}
            loading={saving}
          >
            {t("projects.save")}
          </Button>
        </>
      }
    >
      <form
        id={form}
        className={styles.form}
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          try {
            if (librarySource) await onSave(draft, subscriptions, source);
            else {
              const value = await convert();
              const next = adopt(value);
              await onSave(
                next.draft,
                next.subscriptions,
                source,
                value.source,
              );
            }
          } catch (reason) {
            setError(String(reason));
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className={styles.toolbar}>
          <Button
            disabled={saving || librarySource}
            aria-pressed={mode === "form"}
            onClick={() => void changeMode("form")}
          >
            {t("members.form")}
          </Button>
          <Button
            disabled={saving || librarySource}
            aria-pressed={mode === "source"}
            onClick={() => void changeMode("source")}
          >
            {t("members.sourceFile")}
          </Button>
          <Button onClick={() => setImporting(!importing)}>
            {t("members.import")}
          </Button>
        </div>
        {importing && (
          <div className={styles.form}>
            <input
              type="file"
              accept=".md,.toml"
              aria-label={t("members.importFile")}
              onChange={(e) => {
                const selected = e.target.files?.[0];
                if (selected)
                  void selected
                    .text()
                    .then((text) => importText(text, selected.name));
              }}
            />
            <div className={styles.field}>
              <label htmlFor={`${sourceId}-format`}>
                {t("members.format")}
              </label>
              <select
                id={`${sourceId}-format`}
                value={format}
                onChange={(e) => setFormat(e.target.value)}
              >
                <option value="agent.md">Claude Code</option>
                <option value="agent.toml">Codex</option>
              </select>
            </div>
            <TextArea
              label={t("members.paste")}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              rows={6}
            />
            <Button
              disabled={!paste || saving}
              onClick={() => void importText(paste, format)}
            >
              {t("members.import")}
            </Button>
          </div>
        )}
        {creating && (
          <div className={styles.field}>
            <label htmlFor={sourceId}>{t("members.source")}</label>
            <select
              id={sourceId}
              value={source}
              onChange={(e) => {
                const value = e.target.value;
                setSource(value);
                const chosen = value.startsWith("l:")
                  ? library.find((m) => m.id === value.slice(2))
                  : team.members.find((m) => m.id === value.slice(2));
                setDraft(
                  memberDraft(
                    chosen && "config" in chosen
                      ? chosen.config
                      : (chosen as Partial<MemberConfig>),
                  ),
                );
                setDocument(chosen?.source ?? "");
              }}
            >
              <option value="">{t("members.new")}</option>
              <optgroup label={t("members.copy")}>
                {team.members
                  .filter((m) => m.role !== "human" && !m.deleted)
                  .map((m) => (
                    <option key={m.id} value={`m:${m.id}`}>
                      {memberName(m, t)}
                    </option>
                  ))}
              </optgroup>
              <optgroup label={t("members.library")}>
                {library.map((m) => (
                  <option key={m.id} value={`l:${m.id}`}>
                    {m.config.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
        )}
        {mode === "source" ? (
          <TextArea
            label={t("members.sourceFile")}
            className={styles.sourceEditor}
            rows={24}
            value={document}
            onChange={(e) => setDocument(e.target.value)}
          />
        ) : (
          <div className={styles.editorColumns}>
            <div className={styles.fields}>
              <fieldset disabled={librarySource} className={styles.fields}>
                <MemberFields
                  draft={draft}
                  identityLocked={false}
                  body={false}
                  models={models}
                  machines={machines}
                  onChange={setDraft}
                />
              </fieldset>
              <fieldset className={styles.checks}>
                <legend>{t("members.subscriptions")}</legend>
                {team.channels
                  .filter((c) => !c.member_id)
                  .map((c) => (
                    <label key={c.id}>
                      <input
                        type="checkbox"
                        checked={subscriptions.includes(c.id)}
                        onChange={(e) =>
                          setSubscriptions(
                            e.target.checked
                              ? [...subscriptions, c.id]
                              : subscriptions.filter((id) => id !== c.id),
                          )
                        }
                      />
                      #{c.name}
                    </label>
                  ))}
              </fieldset>
            </div>
            <TextArea
              label={t("members.description")}
              className={styles.bodyEditor}
              rows={24}
              maxLength={50000}
              value={draft.role_description}
              disabled={librarySource}
              onChange={(e) =>
                setDraft({ ...draft, role_description: e.target.value })
              }
            />
          </div>
        )}
        {warnings.map((warning) => (
          <p role="status" key={warning}>
            {warning}
          </p>
        ))}
        {error && <p role="alert">{error}</p>}
      </form>
    </Dialog>
  );
}
