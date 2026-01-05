import type { BaseEvent } from "@ag-ui/core";
import type {
  CustomStreamEvent,
  ErrorStreamEvent,
  EventsStreamEvent,
  MetadataStreamEvent,
  UpdatesStreamEvent,
  ValuesStreamEvent,
} from "@langchain/langgraph-sdk";
import { CustomEventNames } from "../events/custom-events";
import { LangGraphEventTypes } from "../events/langgraph-events";
import type { PredictStateTool } from "../runner/types";

/**
 * Context for stream processing.
 */
export interface StreamProcessorContext {
  threadId: string;
  runId: string;
  subscriber: { next: (event: BaseEvent) => void };
  startedMessages?: Set<string>;
  startedToolCalls?: Set<string>;
  debug?: boolean;
  manuallyEmittedState?: Record<string, unknown>;
}

/**
 * Stream chunk from LangGraph.
 */
export interface StreamChunk {
  id?: string;
  event: string;
  data: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * Processes a single stream chunk and transforms it to BaseEvent format.
 *
 * Based on CopilotKit's event processing patterns from the agent's .run method.
 * Handles all event types including custom events, metadata filtering, and
 * transformations for TEXT_MESSAGE and TOOL_CALL events.
 */
export async function processStreamChunk(
  chunk: StreamChunk,
  context: StreamProcessorContext
): Promise<{ runId: string; manuallyEmittedState?: Record<string, unknown> }> {
  const { event, data } = chunk;
  let { runId } = context;
  const { threadId, subscriber, startedMessages, startedToolCalls, debug } =
    context;
  let manuallyEmittedState = context.manuallyEmittedState;

  // Handle different event types
  switch (event) {
    case "metadata": {
      // Metadata events contain run and thread information
      const metadataData = data as MetadataStreamEvent["data"];
      // Update runId if provided in metadata
      if (metadataData.run_id) {
        runId = metadataData.run_id;
      }
      break;
    }

    case "events": {
      // LangChain events (on_chat_model_stream, on_tool_start, etc.)
      const eventsData = data as EventsStreamEvent["data"];

      // First, emit the RAW event - CopilotKit processes these for intermediate state
      const rawEvent: BaseEvent = {
        type: "RAW" as unknown as BaseEvent["type"],
        event: eventsData.event,
        name: eventsData.name,
        data: eventsData.data,
        run_id: eventsData.run_id,
        metadata: chunk.metadata,
        rawEvent: {
          id: runId,
          event: eventsData.event,
          name: eventsData.name,
          data: eventsData.data,
          run_id: eventsData.run_id,
          metadata: chunk.metadata,
        },
        timestamp: Date.now(),
        threadId,
        runId,
      } as unknown as BaseEvent;

      // Check for intermediate state prediction (like CopilotKit does)
      const eventType = eventsData.event;
      const toolCallData = (eventsData.data as { chunk?: { tool_call_chunks?: Array<{ name?: string }> } })?.chunk
        ?.tool_call_chunks?.[0];
      const metadata = chunk.metadata || {};
      const emitIntermediateState = metadata[
        "copilotkit:emit-intermediate-state"
      ] as PredictStateTool[] | undefined;
      const toolCallUsedToPredictState = emitIntermediateState?.some(
        (predictStateTool: PredictStateTool) =>
          predictStateTool.tool === toolCallData?.name
      );

      if (
        eventType === LangGraphEventTypes.OnChatModelStream &&
        toolCallUsedToPredictState
      ) {
        // Transform to PredictState custom event
        subscriber.next({
          type: "CUSTOM" as unknown as BaseEvent["type"],
          name: "PredictState",
          value: metadata["copilotkit:emit-intermediate-state"],
          rawEvent,
          timestamp: Date.now(),
          threadId,
          runId,
        } as unknown as BaseEvent);
        break;
      }

      // Process chat model streaming for TEXT_MESSAGE events
      if (eventType === LangGraphEventTypes.OnChatModelStream) {
        const messageChunk = (eventsData.data as { chunk?: { content?: string | unknown[] } })?.chunk;
        if (messageChunk?.content) {
          // Check metadata to see if we should emit messages
          if (
            "copilotkit:emit-messages" in metadata &&
            metadata["copilotkit:emit-messages"] === false
          ) {
            // Skip message emission
            break;
          }

          // Use the event's run_id as the message ID - must match OnChatModelStart/End
          const messageId = eventsData.run_id || runId;
          const delta =
            typeof messageChunk.content === "string"
              ? messageChunk.content
              : "";

          // If joining mid-stream, emit START first if we haven't seen it
          if (startedMessages && !startedMessages.has(messageId)) {
            subscriber.next({
              type: "TEXT_MESSAGE_START" as unknown as BaseEvent["type"],
              role: "assistant",
              messageId,
              rawEvent,
              timestamp: Date.now(),
              threadId,
              runId,
            } as unknown as BaseEvent);
            startedMessages.add(messageId);
          }

          // Emit TEXT_MESSAGE_CONTENT event
          subscriber.next({
            type: "TEXT_MESSAGE_CONTENT" as unknown as BaseEvent["type"],
            messageId,
            delta,
            rawEvent,
            timestamp: Date.now(),
            threadId,
            runId,
          } as unknown as BaseEvent);
        }
      }

      // Process chat model start for TEXT_MESSAGE_START
      if (eventType === LangGraphEventTypes.OnChatModelStart) {
        const eventMetadata = chunk.metadata || {};
        if (
          "copilotkit:emit-messages" in eventMetadata &&
          eventMetadata["copilotkit:emit-messages"] === false
        ) {
          break;
        }

        // Use the event's run_id as the message ID - this is the unique identifier for this message
        const messageId = eventsData.run_id || runId;

        // Only emit START if not already started
        if (!startedMessages || !startedMessages.has(messageId)) {
          subscriber.next({
            type: "TEXT_MESSAGE_START" as unknown as BaseEvent["type"],
            role: "assistant",
            messageId,
            rawEvent,
            timestamp: Date.now(),
            threadId,
            runId,
          } as unknown as BaseEvent);

          // Track that we've started this message
          if (startedMessages) {
            startedMessages.add(messageId);
          }
        }
      }

      // Process chat model end for TEXT_MESSAGE_END
      if (eventType === LangGraphEventTypes.OnChatModelEnd) {
        const eventMetadata = chunk.metadata || {};
        if (
          "copilotkit:emit-messages" in eventMetadata &&
          eventMetadata["copilotkit:emit-messages"] === false
        ) {
          break;
        }

        // Use the event's run_id as the message ID - this matches what we used in OnChatModelStart
        const messageId = eventsData.run_id || runId;

        // If joining mid-stream, emit START first if we haven't seen it
        if (startedMessages && !startedMessages.has(messageId)) {
          subscriber.next({
            type: "TEXT_MESSAGE_START" as unknown as BaseEvent["type"],
            role: "assistant",
            messageId,
            rawEvent,
            timestamp: Date.now(),
            threadId,
            runId,
          } as unknown as BaseEvent);
          startedMessages.add(messageId);
        }

        subscriber.next({
          type: "TEXT_MESSAGE_END" as unknown as BaseEvent["type"],
          messageId,
          rawEvent,
          timestamp: Date.now(),
          threadId,
          runId,
        } as unknown as BaseEvent);
      }

      // Process tool start for TOOL_CALL_START
      if (eventType === LangGraphEventTypes.OnToolStart) {
        const eventMetadata = chunk.metadata || {};
        if (
          "copilotkit:emit-tool-calls" in eventMetadata &&
          eventMetadata["copilotkit:emit-tool-calls"] === false
        ) {
          break;
        }

        const toolData = (eventsData.data as { input?: unknown })?.input;
        const toolName = eventsData.name;
        // Use the event's run_id as the tool call ID - this is the unique identifier for this specific tool call
        const toolCallId = eventsData.run_id || runId;

        // Only emit START if not already started
        if (!startedToolCalls || !startedToolCalls.has(toolCallId)) {
          subscriber.next({
            type: "TOOL_CALL_START" as unknown as BaseEvent["type"],
            toolCallId,
            toolCallName: toolName,
            parentMessageId: runId,
            rawEvent,
            timestamp: Date.now(),
            threadId,
            runId,
          } as unknown as BaseEvent);

          // Track that we've started this tool call
          if (startedToolCalls) {
            startedToolCalls.add(toolCallId);
          }
        }

        // Emit args if available
        if (toolData) {
          subscriber.next({
            type: "TOOL_CALL_ARGS" as unknown as BaseEvent["type"],
            toolCallId,
            delta: JSON.stringify(toolData),
            rawEvent,
            timestamp: Date.now(),
            threadId,
            runId,
          } as unknown as BaseEvent);
        }
      }

      // Process tool end for TOOL_CALL_END
      if (eventType === LangGraphEventTypes.OnToolEnd) {
        const eventMetadata = chunk.metadata || {};
        if (
          "copilotkit:emit-tool-calls" in eventMetadata &&
          eventMetadata["copilotkit:emit-tool-calls"] === false
        ) {
          break;
        }

        // Use the event's run_id as the tool call ID - this matches what we used in OnToolStart
        const toolCallId = eventsData.run_id || runId;
        const toolName = eventsData.name;

        // If joining mid-stream, emit START first if we haven't seen it
        if (startedToolCalls && !startedToolCalls.has(toolCallId)) {
          subscriber.next({
            type: "TOOL_CALL_START" as unknown as BaseEvent["type"],
            toolCallId,
            toolCallName: toolName,
            parentMessageId: runId,
            rawEvent,
            timestamp: Date.now(),
            threadId,
            runId,
          } as unknown as BaseEvent);
          startedToolCalls.add(toolCallId);
        }

        subscriber.next({
          type: "TOOL_CALL_END" as unknown as BaseEvent["type"],
          toolCallId,
          rawEvent,
          timestamp: Date.now(),
          threadId,
          runId,
        } as unknown as BaseEvent);
      }

      // Also emit as generic CUSTOM event for any other processing
      subscriber.next({
        type: "CUSTOM" as unknown as BaseEvent["type"],
        name: eventsData.event,
        value: JSON.stringify(eventsData.data),
        rawEvent,
        timestamp: Date.now(),
        threadId,
        runId,
      } as unknown as BaseEvent);
      break;
    }

    case "updates": {
      // State updates from nodes - emit as STATE_SNAPSHOT
      const updatesData = data as UpdatesStreamEvent<unknown>["data"];

      subscriber.next({
        type: "STATE_SNAPSHOT" as unknown as BaseEvent["type"],
        snapshot: updatesData,
        rawEvent: {
          id: runId,
          event: "updates",
          data: updatesData,
        },
        timestamp: Date.now(),
        threadId,
        runId,
      } as unknown as BaseEvent);
      break;
    }

    case "values": {
      // Complete state values after a step - emit as STATE_SNAPSHOT
      const valuesData = data as ValuesStreamEvent<unknown>["data"];

      subscriber.next({
        type: "STATE_SNAPSHOT" as unknown as BaseEvent["type"],
        snapshot: valuesData,
        rawEvent: {
          id: runId,
          event: "values",
          data: valuesData,
        },
        timestamp: Date.now(),
        threadId,
        runId,
      } as unknown as BaseEvent);
      break;
    }

    case "custom": {
      // Custom events emitted from within nodes
      const customData = data as CustomStreamEvent<unknown>["data"];

      // Handle CopilotKit-specific custom events
      const result = handleCustomEvent(
        customData,
        threadId,
        runId,
        subscriber,
        manuallyEmittedState
      );
      manuallyEmittedState = result.manuallyEmittedState;
      break;
    }

    case "error": {
      // Error events
      const errorData = data as ErrorStreamEvent["data"];

      if (debug) {
        console.error(
          "[HistoryHydratingRunner] Stream error:",
          errorData.message
        );
      }

      subscriber.next({
        type: "CUSTOM" as unknown as BaseEvent["type"],
        name: "on_error",
        value: JSON.stringify(errorData),
        rawEvent: {
          id: runId,
          error: errorData.error,
          message: errorData.message,
        },
        timestamp: Date.now(),
        threadId,
        runId,
      } as unknown as BaseEvent);
      break;
    }

    default: {
      // Log unknown events for debugging
      if (debug) {
        console.log(
          `[HistoryHydratingRunner] Unhandled event type: ${event}`,
          data
        );
      }
    }
  }

  return { runId, manuallyEmittedState };
}

/**
 * Handles CopilotKit-specific custom events.
 * These are events with special names that trigger specific transformations.
 */
function handleCustomEvent(
  customData: unknown,
  threadId: string,
  runId: string,
  subscriber: { next: (event: BaseEvent) => void },
  manuallyEmittedState?: Record<string, unknown>
): { manuallyEmittedState?: Record<string, unknown> } {
  const rawEvent = {
    id: runId,
    data: customData,
  };

  // Check if this is a named custom event
  const typedData = customData as { name?: string; event?: string; value?: unknown };
  const eventName = typedData?.name || typedData?.event;

  switch (eventName) {
    case CustomEventNames.CopilotKitManuallyEmitMessage: {
      // Transform to TEXT_MESSAGE events
      const value = typedData.value as { message_id?: string; message?: string } | undefined;
      const messageId = value?.message_id || runId;
      const message = value?.message || "";

      subscriber.next({
        type: "TEXT_MESSAGE_START" as unknown as BaseEvent["type"],
        role: "assistant",
        messageId,
        rawEvent,
        timestamp: Date.now(),
        threadId,
        runId,
      } as unknown as BaseEvent);

      subscriber.next({
        type: "TEXT_MESSAGE_CONTENT" as unknown as BaseEvent["type"],
        messageId,
        delta: message,
        rawEvent,
        timestamp: Date.now(),
        threadId,
        runId,
      } as unknown as BaseEvent);

      subscriber.next({
        type: "TEXT_MESSAGE_END" as unknown as BaseEvent["type"],
        messageId,
        rawEvent,
        timestamp: Date.now(),
        threadId,
        runId,
      } as unknown as BaseEvent);
      break;
    }

    case CustomEventNames.CopilotKitManuallyEmitToolCall: {
      // Transform to TOOL_CALL events
      const value = typedData.value as { id?: string; name?: string; args?: unknown } | undefined;
      const toolCallId = value?.id || runId;
      const toolCallName = value?.name || "";
      const args = value?.args || {};

      subscriber.next({
        type: "TOOL_CALL_START" as unknown as BaseEvent["type"],
        toolCallId,
        toolCallName,
        parentMessageId: toolCallId,
        rawEvent,
        timestamp: Date.now(),
        threadId,
        runId,
      } as unknown as BaseEvent);

      subscriber.next({
        type: "TOOL_CALL_ARGS" as unknown as BaseEvent["type"],
        toolCallId,
        delta: JSON.stringify(args),
        rawEvent,
        timestamp: Date.now(),
        threadId,
        runId,
      } as unknown as BaseEvent);

      subscriber.next({
        type: "TOOL_CALL_END" as unknown as BaseEvent["type"],
        toolCallId,
        rawEvent,
        timestamp: Date.now(),
        threadId,
        runId,
      } as unknown as BaseEvent);
      break;
    }

    case CustomEventNames.CopilotKitManuallyEmitIntermediateState: {
      // Store manually emitted state and emit STATE_SNAPSHOT
      manuallyEmittedState = typedData.value as Record<string, unknown>;

      subscriber.next({
        type: "STATE_SNAPSHOT" as unknown as BaseEvent["type"],
        snapshot: manuallyEmittedState,
        rawEvent,
        timestamp: Date.now(),
        threadId,
        runId,
      } as unknown as BaseEvent);
      break;
    }

    case CustomEventNames.CopilotKitExit: {
      // Emit Exit custom event
      subscriber.next({
        type: "CUSTOM" as unknown as BaseEvent["type"],
        name: "Exit",
        value: true,
        rawEvent,
        timestamp: Date.now(),
        threadId,
        runId,
      } as unknown as BaseEvent);
      break;
    }

    default: {
      // Generic custom event - emit as-is
      subscriber.next({
        type: "CUSTOM" as unknown as BaseEvent["type"],
        name: eventName || "on_custom_event",
        value: JSON.stringify(customData),
        rawEvent,
        timestamp: Date.now(),
        threadId,
        runId,
      } as unknown as BaseEvent);
    }
  }

  return { manuallyEmittedState };
}
