import path from "node:path";
import { resolveCost } from "../../core/pricing.js";
import type {
  NormalizedUsageEvent,
  PricingMode,
  TokenSnapshot,
  UsageCategory,
} from "../../core/event.js";
import { readJsonl } from "../../utils/fs.js";

export interface CodexSessionDebugContext {
  kind: "prompt" | "tool" | "signal";
  label: string;
  text: string;
  timestamp?: string | undefined;
  lineNumber: number;
}

export interface CodexSessionDebugEvent {
  id: string;
  lineNumber: number;
  occurredAt: string;
  modelId: string;
  category?: UsageCategory | undefined;
  usage: TokenSnapshot;
  totalTokens: number;
  costUsd: number;
  culpritScore: number;
  culpritReason: "input" | "output" | "reasoning" | "cache" | "cost";
  prompt?: string | undefined;
  promptTruncated?: boolean | undefined;
  context: CodexSessionDebugContext[];
}

export interface CodexSessionDebugResponse {
  provider: "codex";
  sessionId: string;
  workspace?: string | undefined;
  generatedAt: string;
  sourceCount: number;
  totals: {
    inputFresh: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    costUsd: number;
  };
  events: CodexSessionDebugEvent[];
  culprits: CodexSessionDebugEvent[];
}

const PROMPT_LIMIT = 80_000;
const CONTEXT_LIMIT = 8;

export const buildCodexSessionDebug = async (args: {
  events: NormalizedUsageEvent[];
  pricingMode: PricingMode;
  sessionId: string;
}): Promise<CodexSessionDebugResponse> => {
  const events = args.events
    .filter((event) => event.provider === "codex" && event.nativeSessionId === args.sessionId)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  if (!events.length) {
    throw new Error(`No Codex usage events found for session "${args.sessionId}".`);
  }

  const lineEvents = new Map<string, NormalizedUsageEvent>();
  const sourcePaths = Array.from(new Set(events.map((event) => event.meta.sourcePath))).sort();
  for (const event of events) {
    const lineNumber = lineNumberFromEvent(event);
    if (lineNumber) {
      lineEvents.set(`${event.meta.sourcePath}:${lineNumber}`, event);
    }
  }

  const debugEvents: CodexSessionDebugEvent[] = [];
  for (const sourcePath of sourcePaths) {
    const contexts: CodexSessionDebugContext[] = [];
    for await (const record of readJsonl(sourcePath)) {
      const context = contextFromRecord(record.value, record.lineNumber);
      if (context) {
        contexts.push(context);
      }

      const event = lineEvents.get(`${sourcePath}:${record.lineNumber}`);
      if (!event) {
        continue;
      }
      const recentContext = contexts
        .filter((item) => item.lineNumber < record.lineNumber)
        .slice(-CONTEXT_LIMIT);
      const prompt = [...recentContext]
        .reverse()
        .find((item) => item.kind === "prompt" && item.text.trim())?.text;
      const cost =
        event.cost.effectiveUsd ||
        resolveCost({
          modelId: event.modelId,
          pricingMode: args.pricingMode,
          provider: "codex",
          usage: event.usage,
        }).effectiveUsd;
      const totalTokens = usageTotal(event.usage);
      const culprit = culpritReason(event.usage, cost);
      debugEvents.push({
        id: event.id,
        category: event.meta.category,
        context: recentContext,
        costUsd: cost,
        culpritReason: culprit.reason,
        culpritScore: culprit.score,
        lineNumber: record.lineNumber,
        modelId: event.modelId,
        occurredAt: event.occurredAt,
        prompt: prompt ? truncate(prompt, PROMPT_LIMIT).text : undefined,
        promptTruncated: prompt ? truncate(prompt, PROMPT_LIMIT).truncated : undefined,
        totalTokens,
        usage: event.usage,
      });
    }
  }

  debugEvents.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const totals = debugEvents.reduce(
    (acc, event) => ({
      cacheRead: acc.cacheRead + event.usage.cacheRead,
      cacheWrite: acc.cacheWrite + event.usage.cacheWrite,
      costUsd: acc.costUsd + event.costUsd,
      inputFresh: acc.inputFresh + event.usage.inputFresh,
      output: acc.output + event.usage.output,
      reasoning: acc.reasoning + event.usage.reasoning,
      totalTokens: acc.totalTokens + event.totalTokens,
    }),
    {
      cacheRead: 0,
      cacheWrite: 0,
      costUsd: 0,
      inputFresh: 0,
      output: 0,
      reasoning: 0,
      totalTokens: 0,
    },
  );

  return {
    provider: "codex",
    culprits: [...debugEvents].sort((a, b) => b.culpritScore - a.culpritScore).slice(0, 8),
    events: debugEvents,
    generatedAt: new Date().toISOString(),
    sessionId: args.sessionId,
    sourceCount: sourcePaths.length,
    totals,
    workspace: events[0]?.workspaceLabel ?? events[0]?.workspaceId ?? path.basename(process.cwd()),
  };
};

const lineNumberFromEvent = (event: NormalizedUsageEvent): number | undefined => {
  const suffix = event.logicalRequestId.split(":").at(-1);
  const parsed = Number(suffix);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const contextFromRecord = (
  value: unknown,
  lineNumber: number,
): CodexSessionDebugContext | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const timestamp = stringValue(value, "timestamp");
  const payload = objectValue(value, "payload");
  const payloadType = stringValue(payload, "type") ?? stringValue(value, "type") ?? "event";
  if (payloadType === "token_count") {
    return undefined;
  }

  const text = textFromPayload(payload) ?? textFromPayload(value);
  if (!text) {
    return undefined;
  }
  const kind: CodexSessionDebugContext["kind"] =
    payloadType === "user_message"
      ? "prompt"
      : /tool|exec|command|patch|spawn|agent/i.test(payloadType)
        ? "tool"
        : "signal";
  return {
    kind,
    label: readableLabel(payloadType),
    lineNumber,
    text,
    timestamp,
  };
};

const textFromPayload = (value: unknown): string | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const parts = [
    stringValue(value, "message"),
    stringValue(value, "text"),
    stringValue(value, "name"),
    stringValue(value, "arguments"),
    stringValue(value, "output"),
    textFromContent(value.content),
    textFromMessage(value.message),
  ].filter((part): part is string => Boolean(part?.trim()));
  return parts.length ? parts.join("\n") : undefined;
};

const textFromMessage = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    return value;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  return textFromPayload(value);
};

const textFromContent = (content: unknown): string | undefined => {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  const parts = content
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      if (!isRecord(item)) {
        return undefined;
      }
      return stringValue(item, "text") ?? stringValue(item, "input_text") ?? textFromPayload(item);
    })
    .filter((part): part is string => Boolean(part?.trim()));
  return parts.length ? parts.join("\n") : undefined;
};

const culpritReason = (
  usage: TokenSnapshot,
  costUsd: number,
): { reason: CodexSessionDebugEvent["culpritReason"]; score: number } => {
  const reasonCandidates: Array<{
    reason: CodexSessionDebugEvent["culpritReason"];
    tokens: number;
  }> = [
    { reason: "input", tokens: usage.inputFresh },
    { reason: "output", tokens: usage.output },
    { reason: "reasoning", tokens: usage.reasoning },
  ];
  reasonCandidates.sort((a, b) => b.tokens - a.tokens);
  const topReason =
    reasonCandidates[0] && reasonCandidates[0].tokens > 0 ? reasonCandidates[0].reason : "cache";
  const nonCacheTokens = usage.inputFresh + usage.output + usage.reasoning;
  const fallbackScore = nonCacheTokens + (usage.cacheRead + usage.cacheWrite) * 0.1;
  return {
    reason: costUsd > 0 ? topReason : topReason === "cache" ? "cache" : topReason,
    score: costUsd > 0 ? costUsd * 1_000_000 : fallbackScore,
  };
};

const usageTotal = (usage: TokenSnapshot): number =>
  usage.inputFresh + usage.output + usage.reasoning + usage.cacheRead + usage.cacheWrite;

const truncate = (value: string, limit: number): { text: string; truncated: boolean } => {
  if (value.length <= limit) {
    return { text: value, truncated: false };
  }
  return { text: value.slice(0, limit), truncated: true };
};

const readableLabel = (value: string): string =>
  value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const objectValue = (value: unknown, key: string): Record<string, unknown> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const nested = value[key];
  return isRecord(nested) ? nested : undefined;
};

const stringValue = (value: unknown, key: string): string | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const nested = value[key];
  return typeof nested === "string" ? nested : undefined;
};
