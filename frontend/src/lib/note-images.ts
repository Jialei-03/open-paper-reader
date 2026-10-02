// Only authenticated, application-owned image routes may render automatically.
export function safeNoteImage(src: string | undefined): boolean {
  return (
    !!src &&
    (/^\/api\/v1\/note-images\/[0-9a-f-]{36}$/.test(src) ||
      /^\/api\/v1\/agent\/files\/[0-9a-f-]{36}\/image(?:\?[^#]*)?$/.test(src) ||
      /^\/api\/v1\/files\/[0-9a-f-]{36}\/content$/.test(src))
  );
}
