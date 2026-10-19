import type { ItemStack } from '../core/types';

/** Inventaire : consultation, sélection, utilisation. Sérialisable et validé au chargement. */
export class Inventory {
  private counts = new Map<string, number>();
  private order: string[] = [];
  selected = 0;

  add(id: string, n = 1): void {
    if (n <= 0) return;
    if (!this.counts.has(id)) this.order.push(id);
    this.counts.set(id, (this.counts.get(id) ?? 0) + n);
  }

  remove(id: string, n = 1): boolean {
    const have = this.counts.get(id) ?? 0;
    if (have < n) return false;
    if (have === n) {
      this.counts.delete(id);
      this.order = this.order.filter((x) => x !== id);
      if (this.selected >= this.order.length) this.selected = Math.max(0, this.order.length - 1);
    } else {
      this.counts.set(id, have - n);
    }
    return true;
  }

  count(id: string): number {
    return this.counts.get(id) ?? 0;
  }

  has(id: string, n = 1): boolean {
    return this.count(id) >= n;
  }

  list(): ItemStack[] {
    return this.order.map((id) => ({ id, count: this.counts.get(id) ?? 0 }));
  }

  size(): number {
    return this.order.length;
  }

  select(index: number): void {
    if (this.order.length === 0) {
      this.selected = 0;
      return;
    }
    this.selected = ((index % this.order.length) + this.order.length) % this.order.length;
  }

  selectedId(): string | null {
    return this.order[this.selected] ?? null;
  }

  /** Nombre de fragments de souvenir distincts. */
  memoryCount(): number {
    return this.order.filter((id) => id.startsWith('memory:')).length;
  }

  clear(): void {
    this.counts.clear();
    this.order = [];
    this.selected = 0;
  }

  toJSON(): ItemStack[] {
    return this.list();
  }

  /** Charge une liste d'objets ; retourne false si les données sont invalides. */
  load(data: unknown): boolean {
    if (!Array.isArray(data)) return false;
    const cleaned: ItemStack[] = [];
    for (const entry of data) {
      if (typeof entry !== 'object' || entry === null) return false;
      const e = entry as Record<string, unknown>;
      if (typeof e.id !== 'string' || e.id.length === 0 || e.id.length > 64) return false;
      if (typeof e.count !== 'number' || !Number.isInteger(e.count) || e.count < 1 || e.count > 999) return false;
      cleaned.push({ id: e.id, count: e.count });
    }
    this.clear();
    for (const c of cleaned) this.add(c.id, c.count);
    return true;
  }

  static from(stacks: ItemStack[]): Inventory {
    const inv = new Inventory();
    for (const s of stacks) inv.add(s.id, s.count);
    return inv;
  }
}
