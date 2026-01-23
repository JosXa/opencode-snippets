import { logger } from "./logger.js";
import type { OpencodeClient } from "./types.js";

/**
 * Sends a message that will be displayed but ignored by the AI
 * Used for command output that shouldn't trigger AI responses
 *
 * @param client - The OpenCode client instance
 * @param sessionId - The current session ID
 * @param text - The text to display
 */
export async function sendIgnoredMessage(
  client: OpencodeClient,
  sessionId: string,
  text: string,
): Promise<void> {
  try {
    await client.session.prompt({
      path: { id: sessionId },
      body: {
        noReply: true,
        parts: [{ type: "text", text, ignored: true }],
      },
    });
  } catch (error) {
    logger.error("Failed to send ignored message", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
