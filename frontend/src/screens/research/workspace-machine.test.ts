import { describe, expect, it } from "vitest";
import type { SSHConnection, WorkspaceLocation } from "./navigation-api";
import { workspaceMachine } from "./workspace-machine";

const connections: SSHConnection[] = [
  {
    id: "wsl",
    name: "Windows WSL",
    host: "research-wsl",
    kind: "ssh",
    port: 22,
    identity_file: "",
  },
  {
    id: "lab",
    name: "",
    host: "tang1",
    kind: "ssh",
    port: 22,
    identity_file: "",
  },
];
const remote = (id: string): WorkspaceLocation => ({
  kind: "ssh",
  path: "/home/research/work",
  connection_id: id,
});
const machine = (location?: WorkspaceLocation) =>
  workspaceMachine(location, connections, "本机", "远程设备");

describe("workspace machine", () => {
  it("uses the selected SSH display name and keeps its host visible in the title", () => {
    expect(machine(remote("wsl"))).toEqual({
      label: "Windows WSL",
      title: "Windows WSL · SSH · research-wsl",
      remote: true,
    });
  });
  it("falls back to a configured host alias when a display name is absent", () => {
    expect(machine(remote("lab")).label).toBe("tang1");
  });
  it("does not call a local folder a remote machine even with a leftover connection id", () => {
    expect(machine({ ...remote("wsl"), kind: "local" })).toEqual({
      label: "本机",
      title: "本机",
      remote: false,
    });
    expect(
      machine({ kind: "managed", path: "/private/ora/work", connection_id: "" })
        .label,
    ).toBe("本机");
  });
  it("keeps a merge preview's recorded host when its connection is unavailable", () => {
    expect(
      workspaceMachine(
        { kind: "ssh", host: "research-wsl" },
        [],
        "本机",
        "远程设备",
      ),
    ).toEqual({
      label: "research-wsl",
      title: "research-wsl · SSH · research-wsl",
      remote: true,
    });
  });
  it("does not expose an opaque connection identifier if a connection is unavailable", () => {
    expect(machine(remote("missing-secret-id"))).toEqual({
      label: "远程设备",
      title: "远程设备 · SSH",
      remote: true,
    });
  });
});
