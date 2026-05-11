import type { NormalizedUsageEvent } from "../core/event.js";

export class MemoryStore {
  #events = new Map<string, NormalizedUsageEvent>();

  upsert(events: NormalizedUsageEvent[]): void {
    for (const event of events) {
      this.#events.set(event.id, event);
    }
  }

  all(): NormalizedUsageEvent[] {
    return [...this.#events.values()].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  }

  clear(): void {
    this.#events.clear();
  }
}
