import type { LangGraphMessage } from "../runner/types";

/**
 * Transformed message in CopilotKit format.
 */
export interface TransformedMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCalls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
  toolCallId?: string;
}

/**
 * Extracts text content from LangGraph message content.
 * Handles both string and array formats.
 */
export function extractContent(
  content: string | Array<{ type: string; text?: string }>
): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    // Handle array format - extract text from content blocks
    return content
      .map((block) => {
        if (block.type === "text" && block.text) {
          return block.text;
        }
        return "";
      })
      .filter((text) => text.length > 0)
      .join("\n");
  }

  return "";
}

/**
 * Transforms LangGraph messages to CopilotKit message format.
 *
 * Based on the `ut` function from @ag-ui/langgraph but adapted
 * for standalone use.
 */
export function transformMessages(
  messages: LangGraphMessage[],
  options?: { debug?: boolean }
): TransformedMessage[] {
  const result: TransformedMessage[] = [];

  for (const msg of messages) {
    try {
      let transformed: TransformedMessage | null = null;

      switch (msg.type) {
        case "human": {
          const content = extractContent(msg.content);
          transformed = {
            id: msg.id,
            role: "user",
            content,
          };
          break;
        }

        case "ai": {
          const content = extractContent(msg.content);
          transformed = {
            id: msg.id,
            role: "assistant",
            content: content || "",
            toolCalls: msg.tool_calls?.map((toolCall) => ({
              id: toolCall.id,
              type: "function" as const,
              function: {
                name: toolCall.name,
                arguments: JSON.stringify(toolCall.args),
              },
            })),
          };
          break;
        }

        case "system": {
          const content = extractContent(msg.content);
          transformed = {
            id: msg.id,
            role: "system",
            content,
          };
          break;
        }

        case "tool": {
          const content = extractContent(msg.content);
          transformed = {
            id: msg.id,
            role: "tool",
            content,
            toolCallId: msg.tool_call_id,
          };
          break;
        }

        default:
          if (options?.debug) {
            console.warn(
              `[HistoryHydratingRunner] Unknown message type: ${(msg as LangGraphMessage).type}`
            );
          }
      }

      if (transformed) {
        result.push(transformed);
      }
    } catch (error) {
      if (options?.debug) {
        console.warn(
          "[HistoryHydratingRunner] Failed to transform message:",
          msg,
          error
        );
      }
    }
  }

  return result;
}
