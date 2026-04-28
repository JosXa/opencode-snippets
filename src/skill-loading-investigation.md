# Skill Loading Investigation

## Requirements

Skill content must stay hidden from the user.
Skill content must be injected immediately below the visible user message and reach the LLM.
The agent must not call `skill` a second time for an already-loaded skill.

## Testing Strategy

Use a fresh `opencode` PTY session for every real repro that is meant to answer the end-to-end question. Rebuild first with `bun run build` so the TUI loads current `dist/` output. The repro is only valid if the visible transcript shows `↳ Loaded opencode-config`, because runs without that marker did not exercise the original path and produced false negatives.

The canonical probe is a first-turn prompt through the `#oc-config` snippet path that asks whether the hidden `opencode-config` content mentions `permachine`, forbids tools, and forbids calling `skill`. A passing run should answer `Yes` and quote a real phrase from `~/.config/opencode/skill/opencode-config/SKILL.md`, such as `This setup uses [permachine]` or `Both opencode and tui configs are permachine-managed.`

Each PTY repro should be paired with three checks. First, capture the visible screen with `pty_snapshot` or `pty_snapshot_wait`. Second, isolate the exact OpenCode session with `session-search` or `session-transcript`. Third, confirm the plugin branch behavior in `~/.config/opencode/logs/snippets/daily/2026-04-28.log` using the exact session ID.

## What We Proved

The plugin does resolve hidden skill payloads for valid repros. For the same-message failure session `ses_22b67627dffeyIG4UuXV5fcqhf`, the snippets log shows `Resolved skill loads from direct part metadata` with `payloadCount=1` and then `Appended hidden skill payload to user message` with `hiddenLength=6222`. That means the plugin appended a large hidden synthetic text part in the exact PTY run where the visible transcript showed `↳ Loaded opencode-config`.

OpenCode prompt assembly also appears to preserve that structure. `experimental.chat.messages.transform` mutates the same `msgs` array that is passed into `MessageV2.toModelMessagesEffect`. The OpenCode code path does not drop `synthetic` text parts, and the inspected `vercel/ai` conversion path preserves multiple user text parts in order for generic model messages and for OpenAI-compatible adapters.

The `experimental.chat.system.transform` mirror fixes the end-to-end PTY behavior. In valid runtime session `ses_22ad57ba3ffeeLgDdsjAEnegrn`, the snippets log shows all three of these lines for the same prompt:

- `Resolved skill loads from direct part metadata`
- `Appended hidden skill payload to user message`
- `Mirrored hidden skill payloads into system prompt`

All three used the same `hiddenLength=6222`. The matching valid PTY repro showed `↳ Loaded opencode-config` in the visible transcript, did not call `skill` a second time, and answered `Yes` with the exact quote `This setup uses [permachine]`.

## What We Tried And It Did Not Fix It

We first used a separate synthetic `user` message inserted immediately after the visible user message. Valid PTY runs still answered only from the visible marker and not from the hidden skill body.

We then fixed reprocessing of injected skill content by skipping synthetic parts during later transform passes. That removed one real corruption path, but it did not fix the PTY behavior.

We removed snippet hashtag expansion from hidden `SKILL.md` payload construction so literal skill markdown now survives unchanged inside `<skill_content ...>`. Tests prove literal headings and `#skill(...)` examples are preserved, but the PTY repro still failed semantically.

We changed the transport shape from a separate synthetic message to a synthetic text part on the same visible user message. Valid PTY runs still answered only from the visible marker.

We then flipped the same-message ordering so the hidden synthetic text part is prepended before the visible user text instead of appended after it. That by itself still did not produce a valid successful PTY repro.

Finally, we mirrored the same hidden payload into `experimental.chat.system.transform` while keeping the visible marker path and same-message payload path intact. This is the first transport that produced a valid passing PTY repro.

## Known Invalid Repros

Some PTY runs never showed `↳ Loaded opencode-config` at all. Those runs are not useful for the original bug because the snippet marker path did not trigger. Session `ses_22b6a422cffesxtsHjcXmW23Pz` is the clearest example. Its stored transcript contained only `OpenCode config at \`~/.config/opencode\`` and the question, with no visible load marker and no hidden-payload branch logs.

## Current Best Failure Session

The clearest same-message failure session is `ses_22b67627dffeyIG4UuXV5fcqhf`. It is valid because the visible transcript contained `↳ Loaded opencode-config`, the plugin log proves a 6222-character hidden payload was appended to the same user message, and the model still answered `No` and quoted only `~/.config/opencode`.

## Current Best Success Session

The clearest passing session is `ses_22ad57ba3ffeeLgDdsjAEnegrn`. It is valid because the visible transcript contained `↳ Loaded opencode-config`, the snippets log proves both same-message append and system-prompt mirroring with `hiddenLength=6222`, and the model answered `Yes` with the exact quote `This setup uses [permachine]`.

## Current Hypothesis

The remaining problem no longer looks like missing insertion or payload corruption inside this plugin. The strongest evidence now says that GitHub Copilot GPT-5.4 can ignore or under-attend hidden synthetic user text even when it is structurally preserved, while the same payload becomes usable once mirrored into `experimental.chat.system.transform`. Keep the visible `↳ Loaded ...` marker behavior, keep the same-message payload for observability, and rely on the system-hook mirror for the working end-to-end transport.
