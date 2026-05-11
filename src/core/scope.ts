import type { ActiveScope, NormalizedUsageEvent, ScopeKind } from "./event.js";

export const createScope = (kind: ScopeKind = "global", value?: string): ActiveScope => {
  if (kind === "global") {
    return {
      kind,
      label: "Global",
    };
  }
  return {
    kind,
    value,
    label: value ? `${kind}: ${value}` : kind,
  };
};

export const eventMatchesScope = (event: NormalizedUsageEvent, scope: ActiveScope): boolean => {
  if (scope.kind === "global") {
    return true;
  }
  if (!scope.value) {
    return true;
  }

  switch (scope.kind) {
    case "account":
      return event.accountId === scope.value;
    case "workspace":
      return event.workspaceId === scope.value || event.workspaceLabel === scope.value;
    case "session":
      return event.nativeSessionId === scope.value;
    case "billing-block":
      return false;
  }
};
