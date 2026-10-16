/** Keep a small LRU of offscreen pages so a short scroll back reuses pixels and
 * selectable text. Visible pages are never evicted; large documents stay bounded. */
export class PdfRenderRetention {
  private idle = new Map<object, () => void>();
  constructor(private limit = 3) {}
  visible(key: object) {
    this.idle.delete(key);
  }
  retain(key: object, evict: () => void) {
    this.idle.delete(key);
    this.idle.set(key, evict);
    while (this.idle.size > this.limit) {
      const first = this.idle.entries().next().value!;
      this.idle.delete(first[0]);
      first[1]();
    }
  }
  remove(key: object) {
    this.idle.delete(key);
  }
}
