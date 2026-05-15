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
  messageId?: string,
): Promise<void> {
  try {
    await client.session.prompt({
      path: { id: sessionId },
      body: {
        messageID: messageId,
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

export async function deleteSessionMessage(
  client: OpencodeClient,
  serverUrl: URL,
  sessionId: string,
  messageId: string,
): Promise<boolean> {
  try {
    const session = client.session as typeof client.session & {
      deleteMessage?: (input: {
        sessionID: string;
        messageID: string;
      }) => Promise<{ data?: boolean }>;
    };
    const sdkResponse = await session.deleteMessage?.({
      sessionID: sessionId,
      messageID: messageId,
    });
    if (sdkResponse) return sdkResponse.data !== false;

    const legacySession = client.session as typeof client.session & {
      _client?: {
        delete?: (input: {
          url: string;
          path: { id: string; messageID: string };
        }) => Promise<{ data?: boolean }>;
      };
    };
    const legacyResponse = await legacySession._client?.delete?.({
      url: "/session/{id}/message/{messageID}",
      path: { id: sessionId, messageID: messageId },
    });
    if (legacyResponse) return legacyResponse.data !== false;

    const url = new URL(
      `/session/${encodeURIComponent(sessionId)}/message/${encodeURIComponent(messageId)}`,
      serverUrl,
    );
    const fetchResponse = await fetch(url, {
      method: "DELETE",
      signal: AbortSignal.timeout(1000),
    });

    if (fetchResponse.ok) return true;

    logger.debug("Failed to delete ignored message", {
      messageId,
      status: fetchResponse.status,
      statusText: fetchResponse.statusText,
    });
    return false;
  } catch (error) {
    logger.debug("Failed to delete ignored message", {
      messageId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function deleteSessionPart(
  client: OpencodeClient,
  serverUrl: URL,
  sessionId: string,
  messageId: string,
  partId: string,
): Promise<boolean> {
  try {
    const legacySession = client.session as typeof client.session & {
      _client?: {
        delete?: (input: {
          url: string;
          path: { id: string; messageID: string; partID: string };
        }) => Promise<{ data?: boolean }>;
      };
    };
    const legacyResponse = await legacySession._client?.delete?.({
      url: "/session/{id}/message/{messageID}/part/{partID}",
      path: { id: sessionId, messageID: messageId, partID: partId },
    });
    if (legacyResponse) return legacyResponse.data !== false;

    const url = new URL(
      `/session/${encodeURIComponent(sessionId)}/message/${encodeURIComponent(messageId)}/part/${encodeURIComponent(partId)}`,
      serverUrl,
    );
    const fetchResponse = await fetch(url, {
      method: "DELETE",
      signal: AbortSignal.timeout(1000),
    });

    if (fetchResponse.ok) return true;

    logger.debug("Failed to delete ignored message part", {
      messageId,
      partId,
      status: fetchResponse.status,
      statusText: fetchResponse.statusText,
    });
    return false;
  } catch (error) {
    logger.debug("Failed to delete ignored message part", {
      messageId,
      partId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
