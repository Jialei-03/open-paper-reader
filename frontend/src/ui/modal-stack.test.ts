import { describe, expect, it, vi } from "vitest";
import { enterModal, subscribeModals, topModal } from "./modal-stack";

const dialog = () => ({}) as HTMLElement;

describe("modal stack", () => {
  it("has the one that opened last on top, and the one before it again after", () => {
    const [a, b] = [dialog(), dialog()];
    expect(topModal()).toBeNull();
    const leaveA = enterModal(a);
    const leaveB = enterModal(b);
    expect(topModal()).toBe(b);
    leaveB();
    expect(topModal()).toBe(a);
    leaveA();
    expect(topModal()).toBeNull();
  });

  it("keeps the top one when one under it leaves", () => {
    const [a, b] = [dialog(), dialog()];
    const leaveA = enterModal(a);
    const leaveB = enterModal(b);
    leaveA();
    expect(topModal()).toBe(b);
    leaveB();
  });

  it("tells subscribers of each change, and a second leave changes nothing", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeModals(listener);
    const leave = enterModal(dialog());
    expect(listener).toHaveBeenCalledTimes(1);
    leave();
    leave();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    enterModal(dialog())();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
