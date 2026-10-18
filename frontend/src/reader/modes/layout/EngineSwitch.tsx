import { useI18n } from "../../../i18n/I18nProvider";
import { SegmentedControl } from "../../../ui";
import { ENGINES, percentOf, type Engine } from "./job";
import type { Layout } from "./useLayoutTranslation";

/**
 * Which method's translation is read, in the strip under the card's header.
 * Each item says in a word how its method is doing when that is not "done".
 */
export function EngineSwitch({ layout }: { layout: Layout }) {
  const { t } = useI18n();
  const options = ENGINES.filter(
    (engine) => layout.engines[engine].supported,
  ).map((engine) => {
    const view = layout.engines[engine];
    const percent = view.job ? percentOf(view.job) : null;
    const extra =
      view.state === "running"
        ? percent !== null
          ? t("reader.layout.percent", { percent })
          : t("reader.engine.state.running")
        : view.state === "failed"
          ? t("reader.engine.state.failed")
          : view.state === "idle"
            ? t("reader.engine.state.idle")
            : "";
    const name = t(`reader.engine.${engine}.name`);
    return { value: engine, label: extra ? `${name} · ${extra}` : name };
  });
  return (
    <SegmentedControl<Engine>
      kind="radio"
      size="sm"
      label={t("reader.engine.switch")}
      value={layout.selected}
      options={options}
      onChange={layout.select}
    />
  );
}
