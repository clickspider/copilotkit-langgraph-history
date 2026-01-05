/**
 * Default timeout for LangGraph Client HTTP requests (30 minutes).
 * Long timeout supports long-running agent workflows.
 */
export const DEFAULT_TIMEOUT = 30 * 60 * 1000; // 30 minutes in milliseconds

/**
 * Default number of history checkpoints to fetch.
 */
export const DEFAULT_HISTORY_LIMIT = 100;

/**
 * Maximum history limit allowed by the LangGraph API.
 */
export const MAX_HISTORY_LIMIT = 1000;
