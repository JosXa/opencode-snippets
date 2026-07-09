import type { TuiPluginApi, TuiPromptRef } from "@opencode-ai/plugin/tui";
import { listSnippets, loadSnippets } from "./loader.js";
import { markSnippetReloadRequested } from "./reload-signal.js";

export async function reloadSnippetsInTui(api: TuiPluginApi): Promise<number> {
  const registry = await loadSnippets(api.state.path.directory);
  await markSnippetReloadRequested(api.state.path.directory);
  return listSnippets(registry).length;
}

export function executeReloadInPrompt(
  api: TuiPluginApi,
  ref: TuiPromptRef,
  clear: () => void,
  refresh: () => Promise<unknown> | undefined,
): void {
  void (async () => {
    const count = await reloadSnippetsInTui(api);
    await refresh();
    clear();
    ref.focus();
    api.renderer.requestRender();
    setTimeout(() => {
      api.ui.toast({
        variant: "success",
        title: "Snippets reloaded",
        message: `Reloaded ${count} snippet${count === 1 ? "" : "s"}.`,
        duration: 3000,
      });
      api.renderer.requestRender();
    }, 0);
  })();
}
