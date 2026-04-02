# Injection Placement Strategy

## Problem

When a snippet uses `<inject>` blocks, the injected content needs to persist across the
conversation so the LLM keeps respecting it. But **where** that content appears in the
message history matters a lot for how the model treats it.

If we inject the content right next to the most recent message every turn, the model
overfits to it, treating the injection as the user's latest directive rather than
background context. It responds with "yes I will do what you asked" every single time.

## Solution: Fixed Offset from Bottom

Injections are placed at a **constant distance from the bottom** of the conversation:

```
targetPosition = max(0, messageCount - recencyWindow)
```

This means the injected message always appears `recencyWindow` messages back from the
latest turn. As the conversation grows, the injection "floats" upward, maintaining
that fixed gap. The model sees it as something said a while ago: background context
it respects but doesn't fixate on.

## Visual Example

```
recencyWindow = 5

messageCount=3 (conversation shorter than window)
─────────────────────────────────────────────────
  [INJECTED "Be careful"]    <-- position 0 (top, conv too short)
  msg 1  [user #safe]
  msg 2  [assistant]
  msg 3  [user]

messageCount=6, target = max(0, 6-5) = 1
─────────────────────────────────────────
  msg 1  [user]
  [INJECTED "Be careful"]    <-- 5 from bottom
  msg 2  [assistant]
  msg 3  [user]
  msg 4  [assistant]
  msg 5  [user]
  msg 6  [assistant]

messageCount=10, target = max(0, 10-5) = 5
───────────────────────────────────────────
  msg 1  [user]
  msg 2  [assistant]
  msg 3  [user]
  msg 4  [assistant]
  msg 5  [user]
  [INJECTED "Be careful"]    <-- 5 from bottom
  msg 6  [assistant]
  msg 7  [user]
  msg 8  [assistant]
  msg 9  [user]
  msg 10 [assistant]

messageCount=16, target = max(0, 16-5) = 11
────────────────────────────────────────────
  msg 1  [user]
  ...
  msg 11 [user]
  [INJECTED "Be careful"]    <-- 5 from bottom
  msg 12 [assistant]
  ...
  msg 16 [assistant]
```

The injection maintains a steady distance from the bottom. The model treats it as
old context rather than a fresh command.

## Why Not "Re-inject When Stale"?

An earlier design tracked when each injection was last placed and "refreshed" it
(moved it to the current position) after N messages. This created a sawtooth pattern:

```
         ___         ___         ___
        /   \       /   \       /   \
bottom /     \_____/     \_____/     \___
       refresh     refresh     refresh
```

Every refresh snapped the injection back to the bottom of the conversation, making
the model treat it as a fresh instruction again. The fixed-offset approach eliminates
this entirely. No refresh logic, no sawtooth, just a stable position.

## Configuration

The `injectRecencyMessages` config value controls the offset distance:

```jsonc
{
  // How many messages from the bottom to place injected context
  // Higher = injection feels "older" to the model
  // Lower = injection stays closer to recent context
  // Default: 5
  "injectRecencyMessages": 5
}
```

## Implementation

See `src/injection-manager.ts` for the `InjectionManager` class and
`index.ts` for the `insertInjectionsIntoMessages` function that handles
actual message array manipulation.
