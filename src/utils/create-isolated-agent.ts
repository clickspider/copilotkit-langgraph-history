/**
 * LangGraph Agent Isolation Utilities
 *
 * Fixes shared state contamination in Vercel serverless (Fluid Compute)
 * where CopilotKit's LangGraphAgent can get wrong deploymentUrl due to
 * module-level state being shared between bundled routes.
 *
 * Root cause: CopilotKit's clone() passes config by reference, not by value.
 * Our fix: Create completely isolated agents with verified URLs.
 */

import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
import { Client } from "@langchain/langgraph-sdk";
import { DEFAULT_TIMEOUT } from "../runner/constants";

/**
 * Internal type for accessing protected Client properties.
 * The LangGraph SDK Client has apiUrl as protected, but we need to
 * verify it for contamination detection.
 */
type ClientInternals = {
  apiUrl: string;
};

/**
 * Configuration for creating an isolated LangGraph agent.
 */
export interface CreateIsolatedAgentConfig {
  /**
   * LangGraph deployment URL.
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
   * Client timeout in milliseconds.
   * Default: 1800000 (30 minutes)
   */
  clientTimeoutMs?: number;

  /**
   * Enable debug mode on the agent.
   */
  debug?: boolean;
}

/**
 * Creates a completely isolated LangGraphAgent that cannot be contaminated
 * by shared module state. This is the "nuclear option" fix for serverless
 * environments like Vercel Fluid Compute.
 *
 * Key features:
 * 1. Creates agent with fresh, frozen config
 * 2. Verifies the internal client has correct URL
 * 3. Force-replaces client if contamination detected
 *
 * @example
 * ```typescript
 * const agent = createIsolatedAgent({
 *   deploymentUrl: process.env.LANGGRAPH_DEPLOYMENT_URL!,
 *   graphId: "my-agent",
 *   langsmithApiKey: process.env.LANGSMITH_API_KEY,
 * });
 * ```
 */
export function createIsolatedAgent(
  config: CreateIsolatedAgentConfig
): LangGraphAgent {
  const timeout = config.clientTimeoutMs ?? DEFAULT_TIMEOUT;

  // Create frozen config to prevent mutation
  const isolatedConfig = Object.freeze({
    deploymentUrl: String(config.deploymentUrl),
    graphId: String(config.graphId),
    langsmithApiKey: config.langsmithApiKey
      ? String(config.langsmithApiKey)
      : undefined,
    debug: Boolean(config.debug),
  });

  // Create agent with isolated config
  const agent = new LangGraphAgent(isolatedConfig);

  // CRITICAL: Verify the agent's internal client has correct URL
  // We need to access the protected apiUrl property for verification
  const clientInternals = agent.client as unknown as ClientInternals;
  const expectedUrl = config.deploymentUrl.replace(/\/$/, "");
  const actualUrl = clientInternals.apiUrl?.replace(/\/$/, "");

  if (expectedUrl !== actualUrl) {
    // CONTAMINATION DETECTED - Force replace the client
    console.warn(
      `[LangGraphHistory] URL mismatch detected! Expected: ${expectedUrl}, Got: ${actualUrl}. Replacing client.`
    );

    // Create new client with correct URL and configured timeout
    const newClient = new Client({
      apiUrl: config.deploymentUrl,
      apiKey: config.langsmithApiKey,
      timeoutMs: timeout,
    });

    // Replace the client on the agent
    // LangGraphAgent.client is public, so this assignment is valid at runtime
    Object.assign(agent, { client: newClient });
  }

  return agent;
}
