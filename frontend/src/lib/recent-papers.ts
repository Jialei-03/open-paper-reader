// Device-local history only: never presented as a server-synchronised timestamp.
export function recentPapers(owner: string): Record<string, number> {
  try {
    const value = JSON.parse(
      localStorage.getItem(`paper-recent:${owner}`) || "{}",
    ) as Record<string, number>;
    return Object.fromEntries(
      Object.entries(value).filter(
        ([id, time]) =>
          /^[a-zA-Z0-9-]{1,64}$/.test(id) &&
          typeof time === "number" &&
          Number.isFinite(time) &&
          time > 0 &&
          time < 8.64e15,
      ),
    );
  } catch {
    return {};
  }
}
export function rememberPaper(owner: string, paper: string) {
  try {
    const visits = recentPapers(owner);
    visits[paper] = Date.now();
    localStorage.setItem(
      `paper-recent:${owner}`,
      JSON.stringify(
        Object.fromEntries(
          Object.entries(visits)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 1000),
        ),
      ),
    );
  } catch {
    /* Storage may be unavailable in private browsing. */
  }
}
