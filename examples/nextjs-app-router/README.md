# Next.js App Router Example

This example demonstrates how to use `copilotkit-langgraph-history` with Next.js App Router.

## Setup

1. Install dependencies:

```bash
pnpm install
```

2. Copy `.env.example` to `.env.local` and fill in your values:

```bash
cp .env.example .env.local
```

3. Update `.env.local` with your LangGraph deployment:

```env
LANGGRAPH_DEPLOYMENT_URL=https://your-deployment.langchain.com
LANGSMITH_API_KEY=your-api-key
LANGGRAPH_GRAPH_ID=my-agent
```

4. Run the development server:

```bash
pnpm dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

## What This Example Shows

1. **History Hydration**: Send some messages, refresh the page, and see your chat history restored automatically.

2. **Thread Switching**: Use the thread ID input to switch between different conversation threads.

3. **Isolated Agents**: The API route uses `createIsolatedAgent` to prevent serverless state contamination.

## Key Files

- `src/app/api/copilotkit/route.ts` - API route with HistoryHydratingAgentRunner
- `src/app/page.tsx` - Frontend with CopilotKit integration

## Requirements

- Node.js 18+
- A LangGraph deployment with checkpointing enabled
- (Optional) LangSmith API key for authentication
