import type { Plugin } from "@opencode-ai/plugin"
import { loadSnippets } from "./src/loader.js"
import { expandHashtags } from "./src/expander.js"
import { executeShellCommands } from "./src/shell.js"

/**
 * Snippets Plugin for OpenCode
 * 
 * Expands hashtag-based shortcuts in user messages into predefined text snippets.
 * 
 * @see https://github.com/JosXa/opencode-snippets for full documentation
 */
export const SnippetsPlugin: Plugin = async (ctx) => {
  // Load all snippets at startup
  const snippets = await loadSnippets()

  return {
    "chat.message": async (input, output) => {
      // Only process user messages, never assistant messages
      if (output.message.role !== "user") return
      
      for (const part of output.parts) {
        if (part.type === "text" && part.text) {
          // 1. Expand hashtags recursively with loop detection
          part.text = expandHashtags(part.text, snippets)
          
          // 2. Execute shell commands: !`command`
          part.text = await executeShellCommands(part.text, ctx)
        }
      }
    }
  }
}
