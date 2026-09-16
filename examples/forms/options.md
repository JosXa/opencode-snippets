---
description: Offer a chosen number of options
fields:
  count:
    label: Options
    type: number
    default: 5
    min: 0
    integer: true
---
{{#if (gt count 0)}}give me {{count}} {{plural count "option" "options"}} to choose from{{/if}}
