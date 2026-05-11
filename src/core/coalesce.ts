import type { TokenSnapshot } from "./event.js";

export interface StreamSnapshot {
  logicalRequestId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  occurredAt: string;
  usage: TokenSnapshot;
}

export const coalesceStreamingSnapshots = <T extends StreamSnapshot>(snapshots: T[]): T[] => {
  const map = new Map<string, T>();

  for (const snapshot of snapshots) {
    const previous = map.get(snapshot.logicalRequestId);
    if (!previous) {
      map.set(snapshot.logicalRequestId, snapshot);
      continue;
    }

    map.set(snapshot.logicalRequestId, {
      ...snapshot,
      firstSeenAt: previous.firstSeenAt,
      occurredAt: previous.occurredAt,
      usage: {
        inputFresh: Math.max(previous.usage.inputFresh, snapshot.usage.inputFresh),
        output: Math.max(previous.usage.output, snapshot.usage.output),
        reasoning: Math.max(previous.usage.reasoning, snapshot.usage.reasoning),
        cacheRead: Math.max(previous.usage.cacheRead, snapshot.usage.cacheRead),
        cacheWrite: Math.max(previous.usage.cacheWrite, snapshot.usage.cacheWrite),
      },
    });
  }

  return [...map.values()].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
};

export const cumulativeToDelta = (
  previous: TokenSnapshot | null,
  next: TokenSnapshot,
): TokenSnapshot => {
  if (!previous) {
    return next;
  }

  return {
    inputFresh: Math.max(0, next.inputFresh - previous.inputFresh),
    output: Math.max(0, next.output - previous.output),
    reasoning: Math.max(0, next.reasoning - previous.reasoning),
    cacheRead: Math.max(0, next.cacheRead - previous.cacheRead),
    cacheWrite: Math.max(0, next.cacheWrite - previous.cacheWrite),
  };
};
