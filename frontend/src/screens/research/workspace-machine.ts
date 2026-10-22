import type { SSHConnection, WorkspaceLocation } from "./navigation-api";

/** A folder's device identity, independent of its research or project name. */
export function workspaceMachine(
  location:
    | (Pick<WorkspaceLocation, "kind"> & {
        connection_id?: string;
        host?: string;
      })
    | null
    | undefined,
  connections: SSHConnection[],
  localLabel: string,
  remoteLabel: string,
) {
  if (location?.kind !== "ssh")
    return { label: localLabel, title: localLabel, remote: false };
  const connection = connections.find(
    (item) => item.id === location.connection_id,
  );
  const host = location.host?.trim() || connection?.host.trim() || "";
  const label = connection?.name.trim() || host || remoteLabel;
  return {
    label,
    title: host ? `${label} · SSH · ${host}` : `${label} · SSH`,
    remote: true,
  };
}
