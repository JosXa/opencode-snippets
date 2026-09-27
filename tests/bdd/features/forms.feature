@forms
Feature: Try snippet fields without changing the source
  As a snippet author
  I want familiar and explained form controls
  So I can try an invocation without executing it or losing my draft

  Background:
    Given review has text, multiline, select, checkbox and number fields
    And the snippets library is open

  Scenario: Explain the basic keys before I start filling fields
    When I open the test form
    Then I should see "Enter confirms"
    And I should see "Escape cancels"
    And I should see "Shift+Tab"
    When I press "Enter"
    Then I should see "is required"
    And I should see "› Target"
    And no form invocation should be copied or submitted

  Scenario: Fill each native control and confirm from a field
    When I open the test form
    And I type "src"
    And I press "Tab"
    And I type "First"
    And I press "Ctrl+J"
    And I type "中😀 second"
    And I press keys "Tab, Down, Down"
    And I press keys "Tab, Space, Tab, Shift+Tab"
    Then I should see "› Enabled  [x]"
    When I press "Enter"
    Then one invocation should contain all the entered field values
    And the form source file should be unchanged
    And I should not see "Fields for #review"
    And the library should remain open

  Scenario Outline: Cancel a form without losing the source draft
    When I press keys "Enter, Ctrl+End"
    And I type " draft"
    And I open the test form
    And I type "not committed"
    And I cancel the test form using "<method>"
    Then I should not see "Fields for #review"
    And the form source draft should end with " draft"
    And no form invocation should be copied or submitted
    And the library should remain open

    Examples:
      | method       |
      | Escape       |
      | Cancel Enter |
      | Cancel Space |
      | Cancel mouse |

  Scenario: Reach help by reverse Tab and wrap to the first field
    When I open the test form
    And I press keys "Shift+Tab, Space"
    Then I should see "arrows choose"
    And I should see "Space toggles"
    And I should see "Ctrl+J newline"
    When I press keys "Enter, Tab"
    And I type "first field"
    Then I should see "› Target"
    And I should see "first field"
    And I should not see "Ctrl+J newline"
    And no form invocation should be copied or submitted

  Scenario: Confirm valid defaults with Ctrl+Enter
    When I open the test form
    And I type "src"
    And I press keys "Tab, Tab, Down, Ctrl+Enter"
    Then exactly one form invocation should be copied
    And I should not see "Fields for #review"

  Scenario: A form owns its keys while the library waits
    When I open the test form
    And I press keys "Ctrl+N, Ctrl+O, Ctrl+R, Ctrl+S"
    Then no library dialog or reload should start behind the form
    When I press "Escape"
    Then the library should remain open

  Scenario: Explain unavailable clipboard support
    Given the terminal clipboard is unavailable
    When I request a reference copy
    Then I should see "Clipboard unavailable. Reference: #review"
    And no form invocation should be copied or submitted
