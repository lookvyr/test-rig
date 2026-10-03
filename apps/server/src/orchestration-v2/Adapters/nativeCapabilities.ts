import type { OrchestrationV2ProviderCapabilities } from "@t3tools/contracts";

/** Capabilities backed by the existing Codex and Claude native engines. */
export function nativeCapabilities(
  driver: "codex" | "claudeAgent" | "opencode",
): OrchestrationV2ProviderCapabilities {
  const codex = driver === "codex";
  const opencode = driver === "opencode";
  return {
    sessions: {
      supportsMultipleProviderThreadsPerSession: false,
      supportsModelSwitchInSession: true,
      supportsProviderSwitchingViaHandoff: true,
      supportsRuntimeModeSwitchInSession: false,
      pendingRequestsSurviveRestart: false,
    },
    threads: {
      canCreateEmptyThread: true,
      canReadThreadSnapshot: false,
      canRollbackThread: true,
      canForkThread: true,
      canForkFromTurn: false,
      canForkFromSubagentThread: false,
      exposesNativeThreadId: true,
    },
    turns: {
      exposesNativeTurnId: codex,
      emitsTurnStarted: true,
      emitsTurnCompleted: true,
      supportsInterrupt: true,
      supportsActiveSteering: true,
      supportsSteeringByInterruptRestart: false,
      supportsQueuedMessages: true,
      terminalStatusQuality: "strong",
    },
    streaming: {
      streamsAssistantText: true,
      streamsReasoning: true,
      streamsToolOutput: true,
      streamsPlanText: codex,
      emitsMessageCompleted: true,
    },
    tools: {
      exposesToolItemIds: true,
      emitsToolStarted: true,
      emitsToolCompleted: true,
      emitsToolOutput: true,
      supportsMcpTools: !opencode,
      supportsDynamicToolCallbacks: false,
    },
    approvals: {
      supportsCommandApproval: true,
      supportsFileReadApproval: true,
      supportsFileChangeApproval: true,
      supportsApplyPatchApproval: codex,
      approvalsHaveNativeRequestIds: true,
      approvalCallbacksAreLiveOnly: true,
      approvalsCanOriginateFromSubagents: true,
    },
    planning: {
      emitsPlanUpdated: !opencode,
      emitsTodoList: !opencode,
      emitsProposedPlan: !opencode,
      supportsStructuredQuestions: true,
      planDeltasHaveItemIds: codex,
    },
    subagents: {
      supportsSubagents: true,
      exposesSubagentThreadIds: codex || opencode,
      emitsSubagentLifecycle: true,
      canWaitForSubagents: false,
      canCloseSubagents: false,
      canForkSubagentThread: false,
    },
    context: {
      acceptsSystemContext: false,
      acceptsDeveloperContext: false,
      acceptsSyntheticUserContext: true,
      canGenerateSummaries: true,
      canConsumeHandoffSummaries: true,
      supportsDeltaHandoff: false,
      supportsFullThreadHandoff: false,
      maxRecommendedHandoffChars: null,
    },
    checkpointing: {
      appCanCheckpointFilesystem: true,
      supportsNestedCheckpointScopes: false,
      providerCanRollbackConversation: true,
      providerRollbackReturnsSnapshot: false,
      providerCanReadConversationSnapshot: false,
    },
    identity: {
      nativeThreadIds: "strong",
      nativeTurnIds: codex ? "strong" : "weak",
      nativeItemIds: "strong",
      nativeRequestIds: "strong",
    },
    runtimePolicy: { enforcement: "native" },
  };
}
