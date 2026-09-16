---
description: Suggest better names with optional naming constraints
fields:
  count:
    label: Options
    type: number
    default: 5
    min: 0
    integer: true
  constraint:
    label: Naming constraint (optional)
---
{{#if (gt count 0)}}(suggest {{#if (eq count 1)}}a better name{{else}}better names{{/if}}{{#if constraint}}; naming constraint: {{constraint}}{{/if}})

<append>
#options
</append>
{{/if}}
