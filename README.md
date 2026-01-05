# copilotkit-langgraph-history

[![npm version](https://img.shields.io/npm/v/copilotkit-langgraph-history.svg)](https://www.npmjs.com/package/copilotkit-langgraph-history)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

LangGraph thread history hydration for CopilotKit. Restore chat history on page refresh.

## The Problem

CopilotKit's default runtime doesn't fetch historical messages from LangGraph's checkpoint system. When users refresh the page or switch between threads, they lose their chat history.

**Without this package:**
- Page refresh = empty chat
- Thread switching requires full remount
- No persistence of agent state

**With this package:**
- Chat history restored on page load
- Seamless thread switching
- Agent state preserved

## Installation

```bash
npm install copilotkit-langgraph-history
# or
pnpm add copilotkit-langgraph-history
# or
yarn add copilotkit-langgraph-history
```

### Peer Dependencies

This package requires the following peer dependencies:

```bash
npm install @copilotkit/runtime @copilotkitnext/runtime @ag-ui/core @langchain/langgraph-sdk rxjs
```

## Quick Start

### Next.js App Router

```typescript
// app/api/copilotkit/route.ts
import { CopilotRuntime, createCopilotEndpointSingleRoute } from "@copilotkit/runtime/v2";
import {
  HistoryHydratingAgentRunner,
  createIsolatedAgent,
} from "copilotkit-langgraph-history";

const deploymentUrl = process.env.LANGGRAPH_DEPLOYMENT_URL!;
const langsmithApiKey = process.env.LANGSMITH_API_KEY;
const graphId = "my-agent";

function createRuntime() {
  // Create isolated agent (prevents serverless state contamination)
  const agent = createIsolatedAgent({
    deploymentUrl,
    graphId,
    langsmithApiKey,
  });

  // Create history-hydrating runner
  const runner = new HistoryHydratingAgentRunner({
    agent,
    deploymentUrl,
    graphId,
    langsmithApiKey,
    historyLimit: 100, // Max messages to load
  });

  return new CopilotRuntime({
    agents: { [graphId]: agent },
    runner,
  });
}

export const POST = async (req: Request) => {
  const runtime = createRuntime();
  const route = createCopilotEndpointSingleRoute({
    runtime,
    basePath: "/api/copilotkit",
  });
  return route.handleRequest(req);
};
```

### Frontend (React)

```tsx
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";

function App() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="my-agent"
      threadId={threadId} // Pass your thread ID here
    >
      <CopilotChat />
    </CopilotKit>
  );
}
```

## Configuration

### `HistoryHydratingAgentRunner` Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `agent` | `LangGraphAgent` | **required** | The LangGraphAgent instance |
| `deploymentUrl` | `string` | **required** | LangGraph deployment URL |
| `graphId` | `string` | **required** | Graph identifier |
| `langsmithApiKey` | `string` | `undefined` | LangSmith API key |
| `historyLimit` | `number` | `100` | Max checkpoints to fetch (max 1000) |
| `clientTimeoutMs` | `number` | `1800000` | HTTP timeout (default 30 min) |
| `debug` | `boolean` | `false` | Enable debug logging |
| `stateExtractor` | `function` | `undefined` | Custom state extraction |

### `createIsolatedAgent` Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `deploymentUrl` | `string` | **required** | LangGraph deployment URL |
| `graphId` | `string` | **required** | Graph identifier |
| `langsmithApiKey` | `string` | `undefined` | LangSmith API key |
| `clientTimeoutMs` | `number` | `1800000` | HTTP timeout |
| `debug` | `boolean` | `false` | Enable debug mode |

## Advanced Usage

### Custom State Extraction

If you need to extract custom fields from the CopilotKit request:

```typescript
const runner = new HistoryHydratingAgentRunner({
  agent,
  deploymentUrl,
  graphId,
  stateExtractor: (input, forwardedProps) => ({
    // Extract from forwardedProps.configurable (useCoAgent config)
    tenantId: forwardedProps?.configurable?.tenantId as string,
    userId: forwardedProps?.configurable?.userId as string,
    // Or from input.state (useCoAgent initialState)
    ...input.state,
  }),
});
```

### Why `createIsolatedAgent`?

In serverless environments (especially Vercel Fluid Compute), Node.js module-level state can be shared between bundled routes. This causes a critical bug where the LangGraph deployment URL gets contaminated between different agent configurations.

`createIsolatedAgent` fixes this by:
1. Creating agents with frozen, immutable config
2. Verifying the internal client URL matches expected
3. Force-replacing the client if contamination is detected

**Always use `createIsolatedAgent` instead of `new LangGraphAgent()` in serverless environments.**

### Debug Mode

Enable debug logging to troubleshoot issues:

```typescript
const runner = new HistoryHydratingAgentRunner({
  // ...
  debug: true,
});
```

This logs:
- History fetching progress
- Message transformation details
- Stream processing events
- State extraction results

## How It Works

### History Hydration Flow

When a client connects to an existing thread:

1. **Fetch History**: Retrieves all checkpoints from LangGraph via `client.threads.getHistory()`
2. **Extract Messages**: Processes checkpoints chronologically, deduplicating messages by ID
3. **Transform Format**: Converts LangGraph messages to CopilotKit format
4. **Emit Events**: Sends `MESSAGES_SNAPSHOT` and `STATE_SNAPSHOT` events to frontend
5. **Join Stream**: If thread is busy, joins the active execution stream

### Event Types Handled

- `on_chat_model_stream` → `TEXT_MESSAGE_CONTENT`
- `on_chat_model_start` → `TEXT_MESSAGE_START`
- `on_chat_model_end` → `TEXT_MESSAGE_END`
- `on_tool_start` → `TOOL_CALL_START`
- `on_tool_end` → `TOOL_CALL_END`
- Custom CopilotKit events (manual message/tool/state emission)
- Interrupt events

## API Reference

### Exports

```typescript
// Core
export { HistoryHydratingAgentRunner } from "copilotkit-langgraph-history";
export { createIsolatedAgent } from "copilotkit-langgraph-history";

// Types
export type {
  HistoryHydratingRunnerConfig,
  StateExtractor,
  CreateIsolatedAgentConfig,
  LangGraphMessage,
  ThreadState,
} from "copilotkit-langgraph-history";

// Constants
export {
  DEFAULT_TIMEOUT,
  DEFAULT_HISTORY_LIMIT,
  MAX_HISTORY_LIMIT,
} from "copilotkit-langgraph-history";

// Event Enums
export {
  CustomEventNames,
  LangGraphEventTypes,
} from "copilotkit-langgraph-history";

// Utilities (advanced)
export {
  transformMessages,
  extractContent,
  processStreamChunk,
} from "copilotkit-langgraph-history";
```

## Environment Variables

```env
# Required
LANGGRAPH_DEPLOYMENT_URL=https://your-deployment.langchain.com

# Optional (for authentication)
LANGSMITH_API_KEY=your-api-key
```

## Troubleshooting

### "No history found for thread"

- Ensure the thread exists in LangGraph
- Check that `deploymentUrl` is correct
- Verify `langsmithApiKey` has access to the deployment

### Messages not loading on refresh

- Confirm `threadId` is being passed to `<CopilotKit>`
- Check browser console for hydration errors
- Enable `debug: true` to see detailed logs

### "URL mismatch detected" warning

This is expected when the runner detects and fixes serverless state contamination. The client is automatically replaced with the correct URL.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Credits

Created by [Daniel Frey](https://github.com/clickspider).

Inspired by the need for thread history persistence in CopilotKit + LangGraph applications.
