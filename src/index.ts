/**
 * copilotkit-langgraph-history
 *
 * LangGraph thread history hydration for CopilotKit.
 * Restore chat history on page refresh.
 *
 * @packageDocumentation
 */

// Core exports
export { HistoryHydratingAgentRunner } from "./runner/history-hydrating-runner";
export {
  createIsolatedAgent,
  type CreateIsolatedAgentConfig,
} from "./utils/create-isolated-agent";

// Types
export type {
  HistoryHydratingRunnerConfig,
  StateExtractor,
  LangGraphMessage,
  ThreadState,
  FrozenAgentConfig,
  PredictStateTool,
} from "./runner/types";

// Constants
export {
  DEFAULT_TIMEOUT,
  DEFAULT_HISTORY_LIMIT,
  MAX_HISTORY_LIMIT,
} from "./runner/constants";

// Event enums
export { CustomEventNames } from "./events/custom-events";
export { LangGraphEventTypes } from "./events/langgraph-events";

// Utilities (advanced usage)
export {
  transformMessages,
  extractContent,
  type TransformedMessage,
} from "./utils/message-transformer";
export {
  processStreamChunk,
  type StreamProcessorContext,
  type StreamChunk,
} from "./utils/stream-processor";
