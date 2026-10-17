import { describe, expect, it, vi } from "vitest";
import { createToastStore } from "./toast-store";

describe("createToastStore", () => {
  it("errors do not expire by default", () => {
    const s = createToastStore();
    s.add({ message: "Import failed", tone: "error" });
    s.add({ message: "Saved", tone: "success" });
    expect(s.list().map((t) => t.duration)).toEqual([null, 5000]);
  });

  it("is an info toast that lasts five seconds unless told otherwise", () => {
    const s = createToastStore();
    s.add({ message: "Copied" });
    expect(s.list()).toMatchObject([
      { message: "Copied", tone: "info", duration: 5000 },
    ]);
  });

  it("lets an explicit duration win, errors included", () => {
    const s = createToastStore();
    s.add({ message: "Quick", duration: 1000 });
    s.add({ message: "Failed", tone: "error", duration: 8000 });
    expect(s.list().map((t) => t.duration)).toEqual([1000, 8000]);
  });

  it("reads an infinite duration as no expiry, which a timer could not", () => {
    const s = createToastStore();
    s.add({ message: "Sticky", duration: Infinity });
    expect(s.list().map((t) => t.duration)).toEqual([null]);
  });

  it("keeps at most three, dropping the oldest non-error first", () => {
    const s = createToastStore();
    s.add({ message: "e1", tone: "error" });
    s.add({ message: "i1" });
    s.add({ message: "i2" });
    s.add({ message: "i3" });
    expect(s.list().map((t) => t.message)).toEqual(["e1", "i2", "i3"]);
  });

  it("drops the oldest error when all are errors", () => {
    const s = createToastStore();
    for (const message of ["e1", "e2", "e3", "e4"])
      s.add({ message, tone: "error" });
    expect(s.list().map((t) => t.message)).toEqual(["e2", "e3", "e4"]);
  });

  it("makes room for a newcomer from what came before, even when that is only errors", () => {
    const s = createToastStore();
    for (const message of ["e1", "e2", "e3"]) s.add({ message, tone: "error" });
    const id = s.add({ message: "Copied" });
    expect(s.list().map((t) => t.message)).toEqual(["e2", "e3", "Copied"]);
    expect(s.list().at(-1)?.id).toBe(id);
  });

  it("does not stack duplicates", () => {
    const s = createToastStore();
    const a = s.add({ message: "Offline", tone: "error" });
    expect(s.add({ message: "Offline", tone: "error" })).toBe(a);
    expect(s.list()).toHaveLength(1);
  });

  it("treats the same message in another tone as a different toast", () => {
    const s = createToastStore();
    const a = s.add({ message: "Done", tone: "info" });
    const b = s.add({ message: "Done", tone: "success" });
    expect(b).not.toBe(a);
    expect(s.list()).toHaveLength(2);
  });

  it("gives every toast its own id, and carries its description and action", () => {
    const s = createToastStore();
    const onClick = vi.fn();
    const a = s.add({
      message: "Import failed",
      tone: "error",
      description: "The file is not a PDF.",
      action: { label: "Retry", onClick },
    });
    const b = s.add({ message: "Copied" });
    expect(a).not.toBe(b);
    expect(s.list()[0]).toMatchObject({
      id: a,
      description: "The file is not a PDF.",
      action: { label: "Retry", onClick },
    });
  });

  it("dismisses by id, and ignores an id it does not have", () => {
    const s = createToastStore();
    const a = s.add({ message: "a" });
    const b = s.add({ message: "b" });
    s.dismiss(a);
    expect(s.list().map((t) => t.id)).toEqual([b]);
    s.dismiss("nope");
    expect(s.list()).toHaveLength(1);
  });

  it("allows a toast again once its twin has gone", () => {
    const s = createToastStore();
    const a = s.add({ message: "Copied" });
    s.dismiss(a);
    const b = s.add({ message: "Copied" });
    expect(b).not.toBe(a);
    expect(s.list()).toHaveLength(1);
  });

  it("notifies on a change only, and stops after unsubscribe", () => {
    const s = createToastStore();
    const listener = vi.fn();
    const unsubscribe = s.subscribe(listener);
    const a = s.add({ message: "a" });
    expect(listener).toHaveBeenCalledTimes(1);
    s.add({ message: "a" }); // a duplicate changes nothing
    s.dismiss("nope"); // neither does an unknown id
    expect(listener).toHaveBeenCalledTimes(1);
    s.dismiss(a);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    s.add({ message: "b" });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("returns the same list until something changes", () => {
    const s = createToastStore();
    s.add({ message: "a" });
    const before = s.list();
    expect(s.list()).toBe(before);
    s.add({ message: "a" });
    expect(s.list()).toBe(before);
    s.add({ message: "b" });
    expect(s.list()).not.toBe(before);
  });
});
