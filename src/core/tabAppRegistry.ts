/**
 * Svelte instances owned by individual SiYuan Custom tabs.
 *
 * The host can restore two tabs with the same registered type. The Custom
 * model is therefore the owner key; a type key is not unique for a tab's
 * lifetime.
 */
export class TabAppRegistry {
  private readonly instances = new Map<object, object>();

  has(owner: object): boolean {
    return this.instances.has(owner);
  }

  set(owner: object, instance: object): void {
    this.instances.set(owner, instance);
  }

  async destroy(owner: object, unmount: (instance: object) => void | Promise<void>): Promise<boolean> {
    const instance = this.instances.get(owner);
    if (!instance) return false;
    // Delete before invoking user code so a re-entrant/double destroy cannot
    // unmount the same Svelte instance twice.
    this.instances.delete(owner);
    await unmount(instance);
    return true;
  }

  async clear(unmount: (instance: object) => void | Promise<void>): Promise<void> {
    const instances = [...this.instances.values()];
    this.instances.clear();
    // One broken cleanup must not leave the other restored tabs mounted.
    const results = await Promise.allSettled(instances.map(async (instance) => unmount(instance)));
    const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    if (failures.length) throw Object.assign(new Error("Failed to unmount exam tabs"), { errors: failures });
  }

  get size(): number {
    return this.instances.size;
  }
}
