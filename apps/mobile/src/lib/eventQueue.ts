import type { ClientEvent } from "@thumbcade/protocol";

export interface EventQueueDeps {
  send: (events: ClientEvent[]) => Promise<unknown>;
  load?: () => ClientEvent[];
  save?: (events: ClientEvent[]) => void;
  now?: () => number;
}

/**
 * Batches analytics events. Flushes every few seconds and on background; survives restarts through
 * `save`/`load`. Failed batches are retried (bounded queue: oldest events are dropped first).
 */
export class EventQueue {
  private queue: ClientEvent[];
  private inflight = false;
  static readonly MAX = 1000;
  static readonly BATCH = 200;

  constructor(private deps: EventQueueDeps) {
    this.queue = deps.load?.() ?? [];
  }

  get size(): number {
    return this.queue.length;
  }

  track(event: Omit<ClientEvent, "ts"> & { ts?: number }): void {
    this.queue.push({ ...event, ts: event.ts ?? (this.deps.now ?? Date.now)() } as ClientEvent);
    if (this.queue.length > EventQueue.MAX) this.queue.splice(0, this.queue.length - EventQueue.MAX);
  }

  async flush(): Promise<number> {
    if (this.inflight || this.queue.length === 0) return 0;
    this.inflight = true;
    let sent = 0;
    try {
      while (this.queue.length > 0) {
        const batch = this.queue.slice(0, EventQueue.BATCH);
        await this.deps.send(batch);
        this.queue.splice(0, batch.length);
        sent += batch.length;
      }
    } catch {
      // Keep the events for the next flush.
    } finally {
      this.inflight = false;
      this.persist();
    }
    return sent;
  }

  persist(): void {
    this.deps.save?.(this.queue);
  }
}
