/**
 * HistoryHydratingAgentRunner
 *
 * A custom AgentRunner that extends CopilotKit's base runner to add
 * message history hydration support for LangGraph threads.
 *
 * Fixes the issue where page refreshes don't load historical messages
 * by fetching thread state and emitting MESSAGES_SNAPSHOT events.
 */

import { type BaseEvent, EventType } from "@ag-ui/core";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
import {
  AgentRunner,
  type AgentRunnerConnectRequest,
  type AgentRunnerRunRequest,
  type AgentRunnerStopRequest,
} from "@copilotkitnext/runtime";
import { Client, type Run, type StreamMode } from "@langchain/langgraph-sdk";
import { Observable } from "rxjs";

import {
  DEFAULT_HISTORY_LIMIT,
  DEFAULT_TIMEOUT,
  MAX_HISTORY_LIMIT,
} from "./constants";
import type {
  FrozenAgentConfig,
  HistoryHydratingRunnerConfig,
  LangGraphMessage,
  StateExtractor,
  ThreadState,
} from "./types";
import { createIsolatedAgent } from "../utils/create-isolated-agent";
import { transformMessages } from "../utils/message-transformer";
import { processStreamChunk, type StreamChunk } from "../utils/stream-processor";

/**
 * Custom AgentRunner that extends CopilotKit's base runner to add
 * message history hydration support for LangGraph threads.
 *
 * @example
 * ```typescript
 * import { HistoryHydratingAgentRunner, createIsolatedAgent } from 'copilotkit-langgraph-history';
 *
 * const agent = createIsolatedAgent({
 *   deploymentUrl: process.env.LANGGRAPH_DEPLOYMENT_URL!,
 *   graphId: "my-agent",
 *   langsmithApiKey: process.env.LANGSMITH_API_KEY,
 * });
 *
 * const runner = new HistoryHydratingAgentRunner({
 *   agent,
 *   deploymentUrl: process.env.LANGGRAPH_DEPLOYMENT_URL!,
 *   graphId: "my-agent",
 *   langsmithApiKey: process.env.LANGSMITH_API_KEY,
 *   historyLimit: 100,
 * });
 *
 * const runtime = new CopilotRuntime({
 *   agents: { "my-agent": agent },
 *   runner,
 * });
 * ```
 */
export class HistoryHydratingAgentRunner extends AgentRunner {
  private agent: LangGraphAgent;
  private historyLimit: number;
  private debug: boolean;
  private stateExtractor?: StateExtractor;
  private activeRun: {
    manuallyEmittedState?: Record<string, unknown>;
  } = {};

  /**
   * Frozen agent config to prevent shared state contamination.
   * We store the raw config values and create fresh Agent/Client instances per request.
   * This is critical because Vercel serverless can bundle multiple routes together,
   * causing module-level state to leak between different agent configurations.
   */
  private readonly frozenConfig: Readonly<FrozenAgentConfig>;

  constructor(config: HistoryHydratingRunnerConfig) {
    super();
    this.agent = config.agent;
    this.debug = config.debug ?? false;
    this.stateExtractor = config.stateExtractor;

    // LangGraph API has a maximum limit of 1000 for history endpoint
    this.historyLimit = Math.min(
      config.historyLimit ?? DEFAULT_HISTORY_LIMIT,
      MAX_HISTORY_LIMIT
    );

    // Freeze the config to prevent mutation
    this.frozenConfig = Object.freeze({
      deploymentUrl: config.deploymentUrl,
      graphId: config.graphId,
      langsmithApiKey: config.langsmithApiKey,
      clientTimeoutMs: config.clientTimeoutMs ?? DEFAULT_TIMEOUT,
    });
  }

  /**
   * Creates a fresh LangGraphAgent instance using the frozen config.
   * Uses our isolated agent creator to prevent shared state contamination.
   */
  private createFreshAgent(): LangGraphAgent {
    return createIsolatedAgent({
      deploymentUrl: this.frozenConfig.deploymentUrl,
      graphId: this.frozenConfig.graphId,
      langsmithApiKey: this.frozenConfig.langsmithApiKey,
      clientTimeoutMs: this.frozenConfig.clientTimeoutMs,
    });
  }

  /**
   * Creates a fresh LangGraph Client instance using the frozen config.
   * This prevents shared state contamination in serverless environments.
   */
  private createFreshClient(): Client {
    return new Client({
      apiUrl: this.frozenConfig.deploymentUrl,
      apiKey: this.frozenConfig.langsmithApiKey,
      timeoutMs: this.frozenConfig.clientTimeoutMs,
    });
  }

  /**
   * Log a message if debug mode is enabled.
   */
  private log(message: string, ...args: unknown[]): void {
    if (this.debug) {
      console.log(`[HistoryHydratingRunner] ${message}`, ...args);
    }
  }

  /**
   * Log a warning.
   */
  private warn(message: string, ...args: unknown[]): void {
    console.warn(`[HistoryHydratingRunner] ${message}`, ...args);
  }

  /**
   * Log an error.
   */
  private error(message: string, ...args: unknown[]): void {
    console.error(`[HistoryHydratingRunner] ${message}`, ...args);
  }

  /**
   * Run the agent with a FRESH agent instance.
   * CRITICAL: We cannot trust request.agent (cloned by CopilotKit) because
   * its internal Client may have been corrupted by shared module state in
   * Vercel serverless environments. Create a completely fresh agent with
   * our frozen config to guarantee the correct deployment URL is used.
   */
  run(request: AgentRunnerRunRequest) {
    // Create a fresh agent to bypass any shared state contamination
    const freshAgent = this.createFreshAgent();

    // Extract state values using the configured extractor or default passthrough
    const inputWithProps = request.input as typeof request.input & {
      forwardedProps?: { configurable?: Record<string, unknown> };
    };
    const forwardedProps = inputWithProps.forwardedProps;
    const existingState = (request.input.state || {}) as Record<string, unknown>;

    let enrichedState: Record<string, unknown>;

    if (this.stateExtractor) {
      // Use custom state extractor
      const extractedState = this.stateExtractor(request.input, forwardedProps);
      enrichedState = {
        ...existingState,
        ...extractedState,
      };
    } else {
      // Default: just pass through existing state
      enrichedState = existingState;
    }

    this.log("State extraction:", {
      hasStateExtractor: !!this.stateExtractor,
      hasForwardedProps: !!forwardedProps,
      hasState: !!request.input.state,
      threadId: request.input.threadId,
    });

    // CRITICAL: Set state on the fresh agent before running
    // This ensures the agent has the state configured before the run starts
    freshAgent.setState(enrichedState);

    // Create modified input with state values injected
    // This ensures LangGraph starts with these values from the first message
    const inputWithState = {
      ...request.input,
      state: enrichedState,
    };

    return freshAgent.run(inputWithState);
  }

  /**
   * Delegate isRunning to the agent.
   */
  async isRunning(): Promise<boolean> {
    return this.agent.isRunning;
  }

  /**
   * Delegate stop to the agent.
   */
  async stop(_request: AgentRunnerStopRequest): Promise<boolean | undefined> {
    const result = this.agent.abortRun();
    return result !== undefined ? result : true;
  }

  /**
   * Override connect to add history hydration support.
   *
   * When reconnecting to a thread:
   * 1. Fetches ALL thread history (checkpoints) from LangGraph
   * 2. Extracts and deduplicates messages from all checkpoints
   * 3. Transforms historical messages to CopilotKit format
   * 4. Emits MESSAGES_SNAPSHOT and STATE_SNAPSHOT events
   * 5. Completes the observable
   */
  connect(request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    const { threadId } = request;

    // CRITICAL: Create a fresh Client per connect() call to prevent
    // shared state contamination in Vercel serverless environments.
    const client = this.createFreshClient();

    return new Observable<BaseEvent>((subscriber) => {
      const hydrate = async () => {
        try {
          // Fetch ALL thread history (checkpoints) from LangGraph
          // Using fresh client to ensure correct URL
          const history = await client.threads.getHistory(threadId, {
            limit: this.historyLimit > 0 ? this.historyLimit : DEFAULT_HISTORY_LIMIT,
          });

          if (!history || history.length === 0) {
            this.warn(`No history found for thread ${threadId}`);
            // Still emit required events so frontend doesn't get empty response
            const fallbackRunId =
              "hydration_" + Math.random().toString(36).slice(2);
            subscriber.next({
              type: EventType.RUN_STARTED,
              timestamp: Date.now(),
              threadId,
              runId: fallbackRunId,
            } as BaseEvent);
            subscriber.next({
              type: EventType.MESSAGES_SNAPSHOT,
              messages: [],
              timestamp: Date.now(),
              threadId,
              runId: fallbackRunId,
            } as BaseEvent);
            subscriber.next({
              type: EventType.RUN_FINISHED,
              timestamp: Date.now(),
              threadId,
              runId: fallbackRunId,
            } as BaseEvent);
            subscriber.complete();
            return;
          }

          // Extract messages from all checkpoints
          // Checkpoints are returned newest-first, so we reverse to get chronological order
          const allMessages: LangGraphMessage[] = [];
          const seenMessageIds = new Set<string>();

          // Process checkpoints in reverse order (oldest to newest) to maintain chronological order
          for (const checkpoint of history.reverse()) {
            const state = checkpoint as unknown as ThreadState;
            if (state.values?.messages) {
              const messages = (state.values.messages ||
                []) as LangGraphMessage[];

              // Add messages we haven't seen yet (deduplicate by ID)
              for (const msg of messages) {
                if (!seenMessageIds.has(msg.id)) {
                  seenMessageIds.add(msg.id);
                  allMessages.push(msg);
                }
              }
            }
          }

          this.log(
            `Loaded ${allMessages.length} unique messages from ${history.length} checkpoints`
          );

          // Apply history limit if configured (after deduplication)
          const limitedMessages =
            this.historyLimit > 0
              ? allMessages.slice(-this.historyLimit)
              : allMessages;

          // Transform LangGraph messages to CopilotKit format
          const transformedMessages = transformMessages(limitedMessages, {
            debug: this.debug,
          });

          // Fetch runs to get the latest runId
          let runId: string;
          try {
            const runs = await client.runs.list(threadId);
            // Use the most recent run ID if available
            runId =
              runs && runs.length > 0
                ? runs[0]!.run_id
                : "hydration_" + Math.random().toString(36).slice(2);
          } catch (error) {
            this.warn("Failed to fetch runs, using generated ID:", error);
            runId = "hydration_" + Math.random().toString(36).slice(2);
          }

          // Emit RUN_STARTED event first - CopilotKit requires this as the first event
          subscriber.next({
            type: EventType.RUN_STARTED,
            timestamp: Date.now(),
            threadId,
            runId,
          } as BaseEvent);

          // Emit MESSAGES_SNAPSHOT event - this is what the frontend needs for hydration
          subscriber.next({
            type: EventType.MESSAGES_SNAPSHOT,
            messages: transformedMessages,
            timestamp: Date.now(),
            threadId,
            runId,
          } as BaseEvent);

          // Get the latest checkpoint state (first in original history, last after reverse)
          const latestState = history[
            history.length - 1
          ] as unknown as ThreadState;

          // Emit STATE_SNAPSHOT event with latest state values
          // This hydrates other state fields like searchTools, triggers, plan, etc.
          if (latestState.values) {
            subscriber.next({
              type: "STATE_SNAPSHOT" as unknown as typeof EventType.CUSTOM,
              snapshot: latestState.values,
              rawEvent: {
                id: runId,
                event: "values",
                data: latestState.values,
              },
              timestamp: Date.now(),
              threadId,
              runId,
            } as unknown as BaseEvent);
          }

          // Check for interrupts in tasks from the latest checkpoint
          const interruptedTask = latestState.tasks?.find(
            (task) => task.interrupts && task.interrupts.length > 0
          );

          if (
            interruptedTask &&
            interruptedTask.interrupts &&
            interruptedTask.interrupts.length > 0
          ) {
            const interrupt = interruptedTask.interrupts[0];
            const interruptValue = interrupt?.value;

            // Emit custom interrupt event
            subscriber.next({
              type: "CUSTOM" as unknown as typeof EventType.CUSTOM,
              name: "on_interrupt",
              value: JSON.stringify(interruptValue),
              rawEvent: {
                id: runId,
                value: interruptValue,
              },
              timestamp: Date.now(),
              threadId,
              runId,
            } as unknown as BaseEvent);
          }

          // Check if thread is busy and has an active run to join (from latest checkpoint)
          const isThreadBusy = latestState.next && latestState.next.length > 0;

          let activeRun: Run | undefined;
          if (isThreadBusy) {
            try {
              const runs = await client.runs.list(threadId);
              // Find the most recent active run
              activeRun = runs?.find(
                (run: Run) =>
                  run.status === "running" || run.status === "pending"
              );
            } catch (error) {
              this.warn("Failed to check for active runs:", error);
            }
          }

          // If there's an active run, join the stream
          if (activeRun) {
            this.log(`Joining active stream for run ${activeRun.run_id}`);
            try {
              await this.joinAndProcessStream(
                client,
                threadId,
                activeRun.run_id,
                subscriber
              );
            } catch (error) {
              this.error("Error joining stream:", error);
              // Continue to complete even if stream joining fails
            }
          } else {
            // No active run - emit RUN_FINISHED and complete
            subscriber.next({
              type: EventType.RUN_FINISHED,
              timestamp: Date.now(),
              threadId,
              runId,
            } as BaseEvent);
          }

          // Complete - history hydration done
          subscriber.complete();
        } catch (error) {
          this.error("Failed to hydrate history:", error);
          // Fall back: emit required events so frontend doesn't get empty response
          const fallbackRunId =
            "hydration_error_" + Math.random().toString(36).slice(2);
          subscriber.next({
            type: EventType.RUN_STARTED,
            timestamp: Date.now(),
            threadId,
            runId: fallbackRunId,
          } as BaseEvent);
          subscriber.next({
            type: EventType.MESSAGES_SNAPSHOT,
            messages: [],
            timestamp: Date.now(),
            threadId,
            runId: fallbackRunId,
          } as BaseEvent);
          subscriber.next({
            type: EventType.RUN_FINISHED,
            timestamp: Date.now(),
            threadId,
            runId: fallbackRunId,
          } as BaseEvent);
          subscriber.complete();
        }
      };

      hydrate();
    });
  }

  /**
   * Joins an active stream and processes its events.
   *
   * This method connects to an already-running LangGraph execution and
   * processes all incoming events, transforming them to BaseEvent format.
   *
   * Tracks started messages and tool calls to handle mid-stream joins where
   * we might receive CONTENT/END events without having seen START events.
   */
  private async joinAndProcessStream(
    client: Client,
    threadId: string,
    runId: string,
    subscriber: {
      next: (event: BaseEvent) => void;
      complete: () => void;
      error: (err: unknown) => void;
    }
  ): Promise<void> {
    // Track which messages and tool calls we've started
    // to handle mid-stream joins
    const startedMessages = new Set<string>();
    const startedToolCalls = new Set<string>();

    try {
      // Join the stream with multiple stream modes to get comprehensive event coverage
      // Using the fresh client passed from connect() to ensure correct URL
      const stream = client.runs.joinStream(threadId, runId, {
        streamMode: ["events", "values", "updates", "custom"] as StreamMode[],
      });

      let currentRunId = runId;
      let manuallyEmittedState = this.activeRun.manuallyEmittedState;

      // Process each chunk from the stream
      for await (const chunk of stream) {
        try {
          const result = await processStreamChunk(chunk as StreamChunk, {
            threadId,
            runId: currentRunId,
            subscriber,
            startedMessages,
            startedToolCalls,
            debug: this.debug,
            manuallyEmittedState,
          });
          currentRunId = result.runId;
          manuallyEmittedState = result.manuallyEmittedState;
        } catch (chunkError) {
          this.error("Error processing stream chunk:", chunkError);
          // Continue processing other chunks even if one fails
        }
      }

      // Update active run state
      this.activeRun.manuallyEmittedState = manuallyEmittedState;

      // Stream completed - check for interrupts before finishing
      try {
        const state = await client.threads.getState(threadId);
        const threadState = state as unknown as ThreadState;

        // Check for interrupts in the final state
        const interruptedTask = threadState.tasks?.find(
          (task) => task.interrupts && task.interrupts.length > 0
        );

        if (
          interruptedTask &&
          interruptedTask.interrupts &&
          interruptedTask.interrupts.length > 0
        ) {
          const interrupt = interruptedTask.interrupts[0];
          const interruptValue = interrupt?.value;

          // Emit custom interrupt event
          subscriber.next({
            type: "CUSTOM" as unknown as typeof EventType.CUSTOM,
            name: "on_interrupt",
            value: JSON.stringify(interruptValue),
            rawEvent: {
              id: currentRunId,
              value: interruptValue,
            },
            timestamp: Date.now(),
            threadId,
            runId: currentRunId,
          } as unknown as BaseEvent);
        }
      } catch (stateError) {
        this.warn("Failed to check for interrupts after stream:", stateError);
      }

      // Stream completed - emit RUN_FINISHED
      subscriber.next({
        type: EventType.RUN_FINISHED,
        timestamp: Date.now(),
        threadId,
        runId: currentRunId,
      } as BaseEvent);
    } catch (error) {
      this.error("Error in joinAndProcessStream:", error);

      // Emit error event
      subscriber.next({
        type: EventType.RUN_FINISHED,
        timestamp: Date.now(),
        threadId,
        runId,
      } as BaseEvent);

      throw error;
    }
  }
}
