---
description: Delete or improve tests that provide no confidence
fields:
  checks:
    label: What to look out for
    type: multiselect
    options: &checks
      - No meaningful assertions
      - Assertions that cannot fail
      - Mocks that bypass the behavior under test
      - Tests that never call project code
      - Test names that overstate coverage
      - Weak assertions that miss incorrect outcomes
      - Snapshots without meaningful behavior checks
      - Duplicate tests with no distinct case
      - Missing awaits or swallowed failures
    default: *checks
---
Find and delete or improve tests in the project that test nothing or provide no confidence. If the test provides no real value, delete it. If it just doesn't test what it says it should, improve it.
{{#if checks}}
Look out for:
{{#each checks}}- {{this}}
{{/each}}{{/if}}
Judge each test by the regression it would catch. Keep small tests that check real behavior. For each improved test, show that it fails when the behavior it claims to check is broken, then passes with the correct behavior.
