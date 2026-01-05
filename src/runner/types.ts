import type { LangGraphAgent } from "@copilotkit/runtime/langgraph";
import type { AgentRunnerRunRequest } from "@copilotkitnext/runtime";

/**
 * Configuration for the HistoryHydratingAgentRunner.
 */
export interface HistoryHydratingRunnerConfig {
  /**
   * The LangGraphAgent instance to delegate run() calls to.
   */
  agent: LangGraphAgent;

  /**
   * LangGraph deployment URL (required).
   * Used to create fresh Client instances for history fetching.
   */
  deploymentUrl: string;

  /**
   * Graph ID for the agent.
   */
  graphId: string;

  /**
   * LangSmith API key for authentication (optional).
   */
  langsmithApiKey?: string;

  /**
   * Maximum number of history checkpoints to fetch.
   * Default: 100, Maximum: 1000 (LangGraph API limit)
   */
  historyLimit?: number;

  /**
   * Client timeout in milliseconds.
   * Default: 1800000 (30 minutes) - supports long-running agents.
   */
  clientTimeoutMs?: number;

  /**
   * Enable debug logging.
   * Default: false
   */
  debug?: boolean;

  /**
   * Optional function to extract additional state from the request.
   * Called during run() to enrich the state passed to the agent.
   *
   * @param input - The run request input
   * @param forwardedProps - Optional forwarded props from CopilotKit
   * @returns State object to merge with existing state
   */
  stateExtractor?: StateExtractor;
}

/**
 * Function type for extracting state from run requests.
 */
export type StateExtractor = (
  input: AgentRunnerRunRequest["input"],
  forwardedProps?: Record<string, unknown>
) => Record<string, unknown>;

/**
 * LangGraph message format from thread state.
 */
export interface LangGraphMessage {
  id: string;
  type: "human" | "ai" | "tool" | "system";
  content: string | Array<{ type: string; text?: string }>;
  tool_calls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }>;
  tool_call_id?: string;
}

/**
 * Thread state from LangGraph checkpoint.
 */
export interface ThreadState {
  values: {
    messages?: LangGraphMessage[];
    [key: string]: unknown;
  };
  next: string[];
  config?: unknown;
  created_at?: string;
  parent_config?: unknown;
  tasks?: Array<{
    id: string;
    name: string;
    interrupts?: Array<{
      value?: unknown;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  }>;
  checkpoint: unknown;
  metadata: unknown;
  parent_checkpoint?: unknown;
}

/**
 * Tool used to predict state (for intermediate state emission).
 */
export interface PredictStateTool {
  tool: string;
  state_key: string;
  tool_argument: string;
}

/**
 * Frozen agent config to prevent shared state contamination.
 */
export interface FrozenAgentConfig {
  deploymentUrl: string;
  graphId: string;
  langsmithApiKey?: string;
  clientTimeoutMs: number;
}
