import type { Plugin } from "@opencode/plugin/tui";
import type { TuiPlugin } from "@opencode-ai/plugin-v1/tui";

// Load only the active host's adapter. In particular, V1 must never evaluate
// the V2-only @opencode/plugin/tui runtime entrypoint.
const plugin = {
  id: "opencode-snippets:autocomplete",
  async setup(context: Plugin.Context) {
    return (await import("./tui-v2.js")).default.setup(context);
  },
  tui: (async (api, options, meta) => {
    return (await import("./tui-v1.js")).default.tui(api, options, meta);
  }) satisfies TuiPlugin,
};

export default plugin;
