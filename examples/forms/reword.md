---
description: Rephrase text with a suggestion count and optional tone
fields:
  count:
    label: Suggestions
    type: number
    default: 1
    min: 0
    integer: true
  tone:
    label: Tone (optional)
---
{{#if (gt count 0)}}reword ({{#if (eq count 1)}}choose a better way to phrase this, it doesn't quite fit{{else}}give me {{count}} suggestions for how to phrase this differently{{/if}}{{#if tone}}; tone: {{tone}}{{/if}}){{/if}}
