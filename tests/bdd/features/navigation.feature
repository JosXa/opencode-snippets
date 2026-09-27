@navigation
Feature: Browse a snippet library using only the keyboard
  A newcomer can find snippets, follow references, and understand where focus is.

  Scenario: Navigation hints explain the keys before the first move
    Given the snippets library is open
    Then the control "library-list" should have focus
    And I should see "search /"
    And the visible navigation hints should explain arrows and Shift+Tab

  Scenario: Tab and Shift+Tab visit every visible control in both directions
    Given the snippets library is open
    Then the control "library-list" should have focus
    When I traverse the library focus ring forward
    Then Shift+Tab should retrace the library focus ring and wrap
    And the library should remain open

  Scenario Outline: Search by name, alias, or description
    Given the initial snippet is "<initial>"
    And the snippets library is open
    When I press "/"
    And I type "<query>"
    And I press "<key>"
    Then the control "library-list" should have focus
    And the snippet "<selected>" should be selected

    Examples:
      | initial | query        | key   | selected |
      | review  | base         | Enter | base     |
      | base    | rev          | Down  | review   |
      | base    | Inspect code | Enter | review   |

  Scenario: Tab from search opens the result I can see
    Given the snippets library is open
    When I press "/"
    And I type "global"
    And I press keys "Tab, Enter"
    Then the snippet "global" should be selected
    And the control "library-editor" should have focus
    And the source editor should contain "Global instructions"

  Scenario: List arrows stop at the boundary like Vim motions
    Given the snippets library is open
    Then the snippet "review" should be selected
    When I press "Down"
    Then the snippet "global" should be selected
    When I press "Down"
    Then the snippet "global" should be selected
    When I press "Up"
    Then the snippet "review" should be selected
    And the control "library-list" should have focus

  Scenario: Enter on an empty filtered list does not open a hidden snippet
    Given the snippets library is open
    When I press "/"
    And I type "no-such-snippet"
    And I press keys "Tab, Enter"
    Then the control "library-list" should have focus
    And I should see "No matching snippets."
    And the source editor should be closed

  Scenario: Changing scope selects a snippet in the visible list
    Given the snippets library is open
    When I select the global scope using Tab and Enter
    Then the control "library-action-global" should have focus
    And the snippet "global" should be selected
    And I should see "› #global"
    And I should see "Global instructions"
    And I should not see "#review"

  Scenario: Tab scrolls a long preview to its focused reference
    Given review has a long preview ending in a reference to base
    And the snippets library is open
    When I Tab to the included reference "base"
    Then the included reference "base" should be visible within the preview
    When I press "Enter"
    Then the snippet "base" should be selected

  Scenario: Includes and Used by links work with Enter
    Given the snippets library is open
    When I Tab to the included reference "base"
    And I press "Enter"
    Then the snippet "base" should be selected
    When I Tab to the Used by link for "review"
    And I press "Enter"
    Then the snippet "review" should be selected

  Scenario: An unresolved reference explains why navigation did not occur
    Given the snippets library is open
    When I Tab to the included reference "missing"
    And I press "Enter"
    Then the snippet "review" should be selected
    And I should see "Unresolved reference: #missing"

  Scenario: Enter cannot enter an invisible editor when the library is empty
    Given the library is empty
    And the snippets library is open
    Then I should see "No snippets yet. Use new or :."
    When I press "Enter"
    Then the control "library-list" should have focus
    And the source editor should be closed

  Scenario: The actions menu starts a new snippet from an empty library
    Given the library is empty
    And the snippets library is open
    When I press ":"
    And I choose "New snippet" in host dialog "Library actions"
    And I name the new snippet "first" in the project scope
    Then the snippet "first" should be selected
    And the control "library-editor" should have focus
    And I should see "#first"
    And the snippet file "first" should exist

  Scenario: Narrow and wide terminals keep navigation visible
    Given the terminal is 72 columns by 32 rows
    And the snippets library is open
    Then I should see "back esc"
    And the control "library-list" should have focus
    When I press "Shift+Tab"
    Then the control "library-search" should have focus
    When I resize the terminal to 130 columns by 45 rows
    And I press "Tab"
    Then the control "library-list" should have focus
    And the navigation controls should remain visible after resizing

  Scenario: Letters and shortcuts typed into inputs do not navigate
    Given the snippets library is open
    When I press "/"
    And I type "q?"
    Then the search input should contain "q?" without opening help or quitting
    When I clear the search and open the selected source
    And I type "q/?"
    Then the source editor should end with "q/?" without opening help or quitting

  Scenario: F1 toggles help and q quits from the list
    Given the snippets library is open
    Then I should see "quit q"
    And I should see "help f1"
    When I press "F1"
    Then I should see "P project · G global"
    When I press "F1"
    Then I should not see "P project · G global"
    When I press "q"
    Then the library should be closed

  Scenario: Shortcuts belong to OpenCode's base mode
    Given the snippets library is open
    And OpenCode has left base mode
    When I press keys "/, ?, Ctrl+N, q"
    Then the control "library-list" should have focus
    And no library dialog should be open
    And I should not see "P project · G global"
    And the library should remain open

  Scenario: Space activates a focused scope action like Enter
    Given the snippets library is open
    When I press keys "Tab, Tab, Tab, Tab, Tab"
    Then the control "library-action-global" should have focus
    When I press "Space"
    Then the snippet "global" should be selected
    And the control "library-action-global" should have focus

  Scenario: Editor boundary keys select source without submitting
    Given the snippets library is open
    When I press keys "Enter, Ctrl+End, Ctrl+Shift+Home"
    And I type "Replacement"
    Then the source editor should contain "Replacement"
    When I press "Ctrl+Home"
    And I type "Start "
    Then the source editor should contain "Start Replacement"
    When I press "Ctrl+Shift+End"
    And I type "End"
    Then the source editor should contain "Start End"
    And the host should have received 0 prompt submissions

  Scenario: Quit is explained when focus leaves the editor
    Given the snippets library is open
    When I press "Enter"
    Then I should not see "quit q"
    When I press "Shift+Tab"
    Then the control "library-list" should have focus
    And I should see "quit q"
    When I press "q"
    Then the library should be closed

  Scenario: External editor shortcut explains missing configuration
    Given the snippets library is open
    Then I should see "external shift+enter"
    When I press "Shift+Enter"
    Then I should see "Set VISUAL or EDITOR"
    And the library should remain open
