---
aliases:
  - prompt
description: Generate a handoff prompt from context, with optional instructions and output choices
fields:
  outcome:
    label: Outcome (optional)
    type: textarea
  extra:
    label: Extra instructions (optional)
    type: textarea
  platform:
    label: Target platform
    type: select
    options: [From context, Cross-platform, Linux, macOS, Windows]
    default: From context
  opencode:
    label: OpenCode involved
    type: checkbox
    default: false
  file:
    label: Write to file
    type: checkbox
    default: true
  path:
    label: Output path (optional, when writing a file)
---
<prepend>
<task>
Generate a prompt to reproduce the underlying requested outcome. The generated prompt should tell the receiving agent what to do, not merely describe the previous conversation.

{{#if outcome}}The receiving agent should achieve this outcome:
{{outcome}}
{{else}}Infer the requested outcome from the surrounding message and relevant conversation context.{{/if}}

{{#if file}}{{#if path}}Write the generated prompt to this output path: {{path}}.
{{else}}Write the generated prompt to an appropriately named markdown file under `~/prompts/{kebab-topic}.prompt.md`.
{{/if}}If file writing is unavailable, output the generated prompt in a self-contained, copyable markdown text codefence instead. In that fallback, prefer an outer tilde fence like `~~~markdown` so the generated prompt can contain ordinary triple-backtick code fences without breaking copy/paste.
{{else}}Output the generated prompt in a self-contained, copyable markdown text codefence in the reply. Do not write a file. Prefer an outer tilde fence like `~~~markdown` so the generated prompt can contain ordinary triple-backtick code fences without breaking copy/paste.{{/if}}

Generate a handoff prompt for another agent to complete the underlying requested outcome.

The generated prompt must be runnable in a fresh session with no prior context assumed. Include all original requirements, decisions, constraints, and context required to understand and complete the requested outcome.

{{#if extra}}Additional instructions for the generated prompt:
{{extra}}
{{/if}}

Curate context deliberately. Include details only if they are requirements, decisions, constraints, expected target state, or operational facts the receiving agent needs to complete the outcome. Omit incidental observations, one-off diagnostic dead ends, local accidents, and conversation artifacts unless they materially change what the receiving agent should do. Do not preserve incidental details as generalized cautions unless the generated prompt would be incomplete or likely to fail without that caution. A useful test: if removing the detail would not change the receiving agent's correct behavior, leave it out.

Make the generated prompt directly executable by the receiving agent. Instruct it to inspect, infer, and perform anything it can determine on its own. If user credentials, secrets, account access, environment-specific values, or genuine user choices are required, instruct it to ask concise questions at that point instead of guessing.

Write the generated prompt in natural prose suitable for handing to another agent. Avoid generic labels like "Task:" when a short explanatory preamble would read better, for example "Here's how you can...".
{{#if (eq platform "From context")}}Unless the user specified one platform, make instructions cross-platform and use wording like "depending on your OS" for installation or environment-specific steps.
{{else}}{{#if (eq platform "Cross-platform")}}Make the instructions cross-platform and distinguish OS-specific steps where necessary.
{{else}}{{#if platform}}Target {{platform}}. Adapt installation, paths, and environment-specific instructions to that platform.
{{else}}Unless the user specified one platform, make the instructions cross-platform.{{/if}}{{/if}}{{/if}}

{{#if opencode}}
Assume that whoever we're sharing this prompt with has only a single plain `opencode.json(c)` file, and no permachine setup or machine-specific generated configs whatsoever. Because they don't exist for the recipient, the generated prompt must not mention permachine or machine-specific generated configs at all - that is a local detail of this machine, meaningless to the recipient.
{{/if}}

So, to be clear: The user's instruction around this task is what you're supposed to look up and prepare for handoff to another agent. If the user says "generate a prompt to install everything related to X", that means you have to gather all the user's current configuration around X and package it up so that another agent can replicate that requested setup on another human's computer - all through a single, self-contained, text-based description. Do NOT just restate what the user said in different word.
If I mention that this is for person X, then do not encode "person X" in the generated prompt - person X will be who I later send this prompt to so that they can enter it into their agent.
</task>
</prepend>

generate a prompt
