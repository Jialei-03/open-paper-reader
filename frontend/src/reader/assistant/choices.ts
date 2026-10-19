/** What a model says it can do with thinking (`controls` of `GET /translation-settings`). */
export interface ModelControls {
  thinking_modes?: string[];
  effort_levels?: string[];
}

/** The strength sent with a question; absent, the model's saved one applies. */
export interface RunOptions {
  thinking_mode: string;
  reasoning_effort: string;
}

export interface EffortChoice {
  /** Stored and shown as the menu item's id: "default", "off", or the effort level. */
  id: string;
  options: RunOptions;
}

const LEVELS = ["low", "medium", "high", "xhigh", "max"];

/**
 * The thinking strengths a model offers: its own default, switching thinking
 * off when it can be, and each effort level it supports.
 */
export function effortChoices(
  controls: ModelControls | undefined,
): EffortChoice[] {
  const modes = controls?.thinking_modes ?? ["default"];
  const levels = controls?.effort_levels ?? ["default"];
  const choices: EffortChoice[] = [
    {
      id: "default",
      options: { thinking_mode: "default", reasoning_effort: "default" },
    },
  ];
  if (modes.includes("disabled"))
    choices.push({
      id: "off",
      options: { thinking_mode: "disabled", reasoning_effort: "default" },
    });
  for (const level of LEVELS)
    if (levels.includes(level))
      choices.push({
        id: level,
        options: { thinking_mode: "default", reasoning_effort: level },
      });
  return choices;
}

/** The options to send for a choice; none for the model's own default (nothing was chosen). */
export function optionsFor(
  controls: ModelControls | undefined,
  id: string,
): RunOptions | undefined {
  if (!id || id === "default") return undefined;
  return effortChoices(controls).find((choice) => choice.id === id)?.options;
}

/** The choice if the model still offers it, else the default. */
export function validChoice(
  controls: ModelControls | undefined,
  id: string,
): string {
  return effortChoices(controls).some((choice) => choice.id === id)
    ? id
    : "default";
}
