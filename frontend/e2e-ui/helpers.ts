import type { Page } from "@playwright/test";

/** Open the kit page; a theme or locale that is not given is left as the page has it. */
export async function openKit(
  page: Page,
  options: { theme?: "light" | "dark"; locale?: "zh" | "en" } = {},
): Promise<void> {
  await page.goto("/ui-kit.html");
  if (options.theme)
    await page.getByLabel("Kit theme").selectOption(options.theme);
  if (options.locale)
    await page.getByLabel("Kit locale").selectOption(options.locale);
}

type Pixel = [number, number, number, number];

function luminance([r, g, b]: Pixel): number {
  const [lr, lg, lb] = [r, g, b].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/**
 * WCAG contrast of a foreground over a background, as the browser really paints
 * them: the colors go through a 1x1 canvas, so `color-mix()` and translucent
 * colors give their true composited result. `baseCss` is painted first, for a
 * background that is itself translucent. Arguments are CSS color values.
 */
export async function contrast(
  page: Page,
  fgCss: string,
  bgCss: string,
  baseCss?: string,
): Promise<number> {
  const [behind, front] = await page.evaluate(
    ([fg, bg, base]) => {
      const context = Object.assign(document.createElement("canvas"), {
        width: 1,
        height: 1,
      }).getContext("2d", { willReadFrequently: true })!;
      const read = (): number[] =>
        Array.from(context.getImageData(0, 0, 1, 1).data);
      for (const color of base ? [base, bg] : [bg]) {
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
      }
      const behind = read();
      context.fillStyle = fg;
      context.fillRect(0, 0, 1, 1);
      return [behind, read()];
    },
    [fgCss, bgCss, baseCss ?? null] as const,
  );
  if (behind[3] !== 255)
    throw new Error(`"${bgCss}" is translucent: pass an opaque baseCss`);
  const [l1, l2] = [luminance(behind as Pixel), luminance(front as Pixel)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Like `contrast`, with colors named by their `--ui-*` custom properties. */
export async function contrastOfTokens(
  page: Page,
  fgToken: string,
  bgToken: string,
  baseToken?: string,
): Promise<number> {
  const [fg, bg, base] = await page.evaluate(
    (tokens) => {
      const style = getComputedStyle(document.documentElement);
      return tokens.map((token) =>
        token ? style.getPropertyValue(token).trim() : null,
      );
    },
    [fgToken, bgToken, baseToken ?? null],
  );
  if (!fg || !bg || (baseToken && !base))
    throw new Error(
      `A token is not defined: ${[fgToken, bgToken, baseToken].join(", ")}`,
    );
  return contrast(page, fg, bg, base ?? undefined);
}
