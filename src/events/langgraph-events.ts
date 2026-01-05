/**
 * LangGraph event types for stream processing.
 * These correspond to LangChain/LangGraph lifecycle events.
 */
export enum LangGraphEventTypes {
  OnChatModelStart = "on_chat_model_start",
  OnChatModelStream = "on_chat_model_stream",
  OnChatModelEnd = "on_chat_model_end",
  OnToolStart = "on_tool_start",
  OnToolEnd = "on_tool_end",
  OnChainStart = "on_chain_start",
  OnChainEnd = "on_chain_end",
}
