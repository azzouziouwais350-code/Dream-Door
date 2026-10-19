/** Petit émetteur d'événements typé, avec désabonnement explicite. */
export class Emitter<E extends object> {
  private handlers = new Map<keyof E, Set<(payload: never) => void>>();

  on<K extends keyof E>(key: K, fn: (payload: E[K]) => void): () => void {
    let set = this.handlers.get(key);
    if (!set) {
      set = new Set();
      this.handlers.set(key, set);
    }
    set.add(fn as (payload: never) => void);
    return () => {
      set?.delete(fn as (payload: never) => void);
    };
  }

  emit<K extends keyof E>(key: K, payload: E[K]): void {
    const set = this.handlers.get(key);
    if (!set) return;
    for (const fn of [...set]) (fn as (p: E[K]) => void)(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}
