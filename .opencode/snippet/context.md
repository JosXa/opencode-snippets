---
aliases: ctx
---
Project: !`basename $(pwd)`
Branch: !`git branch --show-current`
Recent changes: !`git diff --stat HEAD~3 | tail -5`
