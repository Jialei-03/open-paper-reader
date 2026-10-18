import { describe, expect, it, vi } from "vitest";
import {
  enterModal,
  focusStart,
  subscribeModals,
  topModal,
} from "./modal-stack";

const dialog = () => ({}) as HTMLElement;
const noop = () => undefined;

describe("modal stack", () => {
  it("has the one that opened last on top, and the one before it again after", () => {
    const [a, b] = [dialog(), dialog()];
    expect(topModal()).toBeNull();
    const leaveA = enterModal(a, noop);
    const leaveB = enterModal(b, noop);
    expect(topModal()).toBe(b);
    leaveB();
    expect(topModal()).toBe(a);
    leaveA();
    expect(topModal()).toBeNull();
  });

  it("keeps the top one when one under it leaves", () => {
    const [a, b] = [dialog(), dialog()];
    const leaveA = enterModal(a, noop);
    const leaveB = enterModal(b, noop);
    leaveA();
    expect(topModal()).toBe(b);
    leaveB();
  });

  it("tells subscribers of each change, and a second leave changes nothing", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeModals(listener);
    const leave = enterModal(dialog(), noop);
    expect(listener).toHaveBeenCalledTimes(1);
    leave();
    leave();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    enterModal(dialog(), noop)();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("asks the dialog that is named to put the focus where it starts", () => {
    const [a, b] = [dialog(), dialog()];
    const [startA, startB] = [vi.fn(), vi.fn()];
    const leaveA = enterModal(a, startA);
    const leaveB = enterModal(b, startB);
    focusStart(a);
    expect(startA).toHaveBeenCalledTimes(1);
    expect(startB).not.toHaveBeenCalled();
    leaveA();
    focusStart(a); // no longer open: nothing to ask
    expect(startA).toHaveBeenCalledTimes(1);
    leaveB();
  });
});
