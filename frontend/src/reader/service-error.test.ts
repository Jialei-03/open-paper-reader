import { describe, expect, it } from "vitest";
import { ApiError } from "../api";
import { createTranslator } from "../i18n/i18n";
import { serviceReason, serviceWords } from "./service-error";
import { chosenModel } from "./useModel";

const en = createTranslator("en");
const zh = createTranslator("zh");
const CHINESE = /[一-鿿]/;

describe("serviceReason", () => {
  it("keeps the service's own words in the Chinese interface", () => {
    expect(serviceReason(new ApiError(429, "今天的额度已用完"), zh)).toBe(
      "今天的额度已用完",
    );
  });

  it("says what the status means in the English one, never the service's Chinese", () => {
    const said = (status: number) =>
      serviceReason(new ApiError(status, "服务说的中文"), en);
    expect(said(401)).toBe(en.t("reader.error.signedOut"));
    expect(said(403)).toBe(en.t("reader.error.forbidden"));
    expect(said(404)).toBe(en.t("reader.error.missing"));
    expect(said(413)).toBe(en.t("reader.error.tooLarge"));
    expect(said(429)).toBe(en.t("reader.error.busy"));
    expect(said(503)).toBe(en.t("reader.error.server", { status: 503 }));
    expect(said(409)).toBe("The service reported an error (409).");
    for (const status of [400, 401, 409, 422, 429, 500])
      expect(said(status)).not.toMatch(CHINESE);
  });

  it("takes the caller's words for a status that says nothing by itself", () => {
    expect(
      serviceReason(new ApiError(422, "参数错误"), en, {
        fallback: "reader.translate.failed",
      }),
    ).toBe(en.t("reader.translate.failed"));
  });

  it("calls no answer at all the connection, in the caller's words if it has them", () => {
    expect(serviceReason(new TypeError("Failed to fetch"), en)).toBe(
      en.t("reader.error.offline"),
    );
    expect(
      serviceReason(new TypeError("Failed to fetch"), zh, {
        offline: "reader.assistant.unsent",
      }),
    ).toBe(zh.t("reader.assistant.unsent"));
  });

  it("shows a run's own reason in Chinese only", () => {
    expect(serviceWords("模型不可用", zh)).toBe("模型不可用");
    expect(serviceWords("模型不可用", en)).toBe("");
    expect(serviceWords(undefined, zh)).toBe("");
  });
});

describe("chosenModel", () => {
  const models = [{ id: "a" }, { id: "b" }];
  it("is the active model when it is listed, else the first", () => {
    expect(chosenModel({ active_id: "b", models })).toBe("b");
    expect(chosenModel({ active_id: "gone", models })).toBe("a");
    expect(chosenModel({ active_id: "", models })).toBe("a");
    expect(chosenModel({ active_id: "", models: [] })).toBe("");
    expect(chosenModel({})).toBe("");
  });

  it("is none when the active one is known not to be set up", () => {
    expect(chosenModel({ active_id: "b", configured: false, models })).toBe("");
    expect(chosenModel({ active_id: "b", configured: true, models })).toBe("b");
  });
});
