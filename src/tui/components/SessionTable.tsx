import React from "react";
import { Box, Text } from "ink";
import type { SessionSummary } from "../../core/event.js";
import { formatCompact, formatUsd, shortId, summarizeModels } from "../../utils/format.js";

export const SessionTable = (props: { sessions: SessionSummary[]; compact: boolean }) => {
  const sessions = props.sessions.slice(0, props.compact ? 5 : 10);
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} marginTop={1}>
      <Text bold>Live sessions</Text>
      <Text dimColor>
        {"Time".padEnd(10)} {"Workspace".padEnd(18)} {"Session".padEnd(10)} {"Models".padEnd(24)}{" "}
        {"Tokens".padStart(8)} {"Cost".padStart(10)} State
      </Text>
      {sessions.length === 0 ? (
        <Text dimColor>No usage events found for this window.</Text>
      ) : (
        sessions.map((session) => (
          <Text key={`${session.provider}:${session.nativeSessionId}`}>
            {new Date(session.lastActivityAt).toLocaleTimeString().padEnd(10)}{" "}
            {(session.workspaceLabel ?? session.workspaceId ?? "n/a").slice(0, 18).padEnd(18)}{" "}
            {shortId(session.nativeSessionId).padEnd(10)}{" "}
            {summarizeModels(session.models).slice(0, 24).padEnd(24)}{" "}
            {formatCompact(session.totals.totalTokens).padStart(8)}{" "}
            {formatUsd(session.totals.costUsd).padStart(10)} {session.state}
          </Text>
        ))
      )}
    </Box>
  );
};
