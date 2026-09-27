@navigation @vim
Feature: Navigate the library with Vim motions
  Motions work in the list and preview, while inputs own their text.

  Scenario Outline: Counted list motions stop at boundaries
    Given the library has 80 numbered snippets
    And the snippets library is open
    When I press keys "<keys>"
    Then the snippet "<selected>" should be selected
    And no library dialog should be open

    Examples:
      | keys              | selected |
      | j                 | item02   |
      | k                 | item01   |
      | 1, 2, j           | item13   |
      | 5, G              | item05   |
      | 5, g, g           | item05   |
      | G, j              | item80   |
      | G, 2, k           | item78   |
      | G, g, g           | item01   |
      | End, Home         | item01   |
      | Ctrl+N, Ctrl+N    | item03   |
      | Ctrl+N, Ctrl+P    | item01   |

  Scenario Outline: Page motions move relative to the visible list
    Given the library has 80 numbered snippets
    And the snippets library is open
    When I press keys "4, 0, G"
    And I remember the list position
    And I press "<down>"
    Then the list selection should advance by a "<size>" page
    When I press "<up>"
    Then the snippet "item40" should be selected

    Examples:
      | down     | up       | size |
      | Ctrl+D   | Ctrl+U   | half |
      | Ctrl+F   | Ctrl+B   | full |
      | PageDown | PageUp   | full |

  Scenario: Viewport motions and alignment reveal the selected row
    Given the library has 80 numbered snippets
    And the snippets library is open
    When I press keys "4, 0, G, z, z"
    Then the selected row should be at the "middle" of the list viewport
    When I press "H"
    Then the selected row should be at the "top" of the list viewport
    When I press "M"
    Then the selected row should be at the "middle" of the list viewport
    When I press "L"
    Then the selected row should be at the "bottom" of the list viewport
    When I press keys "4, 0, G, z, t"
    Then the selected row should be at the "top" of the list viewport
    When I press keys "z, b"
    Then the selected row should be at the "bottom" of the list viewport

  Scenario: Line scrolling keeps the list selection visible
    Given the library has 80 numbered snippets
    And the snippets library is open
    When I press "Ctrl+E"
    Then the snippet "item02" should be selected
    And the pane "library-list" should be scrolled to line 1
    When I press "Ctrl+Y"
    Then the snippet "item02" should be selected
    And the pane "library-list" should be scrolled to line 0

  Scenario: Preview scrolling keeps the snippet selected
    Given review has a long preview ending in a reference to base
    And the snippets library is open
    When I press "l"
    Then the control "library-preview" should have focus
    And I should see "preview focused"
    When I press keys "3, j"
    Then the pane "library-preview" should be scrolled to line 3
    When I press "k"
    Then the pane "library-preview" should be scrolled to line 2
    When I press keys "Ctrl+E, Ctrl+Y"
    Then the pane "library-preview" should be scrolled to line 2
    When I press "G"
    Then the pane "library-preview" should be at its end
    And I should see "scroll j/k"
    When I press keys "g, g"
    Then the pane "library-preview" should be scrolled to line 0
    When I press keys "5, G"
    Then the pane "library-preview" should be scrolled to line 4
    And the snippet "review" should be selected
    When I press "h"
    Then the control "library-list" should have focus

  Scenario Outline: Page keys scroll the preview and return
    Given review has a long preview ending in a reference to base
    And the snippets library is open
    When I press "l"
    And I press "<down>"
    Then the pane "library-preview" should have scrolled down
    When I press "<up>"
    Then the pane "library-preview" should be scrolled to line 0
    And the snippet "review" should be selected

    Examples:
      | down     | up       |
      | Ctrl+D   | Ctrl+U   |
      | Ctrl+F   | Ctrl+B   |
      | PageDown | PageUp   |

  Scenario: Window motions switch panes and Tab still reaches controls
    Given the snippets library is open
    When I press keys "Ctrl+W, l"
    Then the control "library-preview" should have focus
    When I press keys "Ctrl+W, h"
    Then the control "library-list" should have focus
    When I press keys "Ctrl+W, j"
    Then the control "library-preview" should have focus
    When I press keys "Ctrl+W, k"
    Then the control "library-list" should have focus
    When I press keys "Ctrl+W, w"
    Then the control "library-preview" should have focus
    When I press "Left"
    Then the control "library-list" should have focus
    When I press "Right"
    Then the control "library-preview" should have focus
    When I press "Tab"
    Then the control "library-action-back" should have focus
    When I press keys "2, j"
    Then the control "library-action-project" should have focus
    When I press "k"
    Then the control "library-action-all" should have focus

  Scenario Outline: Search repeats respect the search direction and wrap
    Given the library has 80 numbered snippets
    And the snippets library is open
    When I press "<search>"
    And I type "item"
    And I press "Enter"
    Then the snippet "<first>" should be selected
    When I press "n"
    Then the snippet "<next>" should be selected
    When I press "N"
    Then the snippet "<first>" should be selected
    When I press "N"
    Then the snippet "<wrapped>" should be selected

    Examples:
      | search | first  | next   | wrapped |
      | /      | item01 | item02 | item80  |
      | ?      | item80 | item79 | item01  |

  Scenario: Jump history follows references in both directions
    Given the snippets library is open
    When I Tab to the included reference "base"
    And I press "Enter"
    Then the snippet "base" should be selected
    When I press "Ctrl+O"
    Then the snippet "review" should be selected
    When I press "Ctrl+I"
    Then the snippet "base" should be selected
    And no library dialog should be open

  Scenario: A new jump discards the abandoned forward history
    Given the snippets library is open
    When I press keys "g, g, G, Ctrl+O, Ctrl+O"
    Then the snippet "review" should be selected
    When I press "/"
    And I type "global"
    And I press keys "Enter, Ctrl+O"
    Then the snippet "review" should be selected
    When I press "Ctrl+I"
    Then the snippet "global" should be selected
    When I press "Ctrl+I"
    Then the snippet "global" should be selected

  Scenario: Escape cancels a count or prefix before it steps back
    Given the snippets library is open
    When I press "g"
    Then I should see "pending g"
    When I press "Escape"
    Then I should not see "pending"
    And the library should remain open
    When I press keys "9, Escape, j"
    Then the snippet "global" should be selected
    And the library should remain open

  Scenario: A focus change cancels an incomplete motion
    Given the snippets library is open
    When I press "g"
    And I click "library-action-global"
    Then I should not see "pending"
    When I press "h"
    Then the control "library-list" should have focus

  Scenario: Navigation text stays literal in the editor and search field
    Given the snippets library is open
    When I press "i"
    And I press "Ctrl+End"
    And I type "hjklggGnN/?123:zt"
    Then the source editor should end with "hjklggGnN/?123:zt"
    And no library dialog should be open
    When I press keys "Escape, /"
    And I type "hjklggGnN/?123:zt"
    Then the control "library-search" should have focus
    And I should see "hjklggGnN/?123:zt"
    And no library dialog should be open
    And the library should remain open

  Scenario: Empty lists safely accept navigation and still offer actions
    Given the library is empty
    And the snippets library is open
    When I press keys "j, k, g, g, G, H, M, L, Ctrl+D, Ctrl+U, l, i, n, N, Ctrl+O, Ctrl+I"
    Then the control "library-list" should have focus
    And the source editor should be closed
    When I press ":"
    Then the host dialog "Library actions" should offer an option "New snippet"
    And the host dialog "Library actions" should offer an option "Reload library"

  Scenario: Help documents the Vim motions and shortcut changes
    Given the snippets library is open
    When I press "F1"
    Then I should see "gg/G"
    And I should see "Ctrl+D/U"
    And I should see "Ctrl+O/I"
    And I should see "? backward"
    And I should see ": opens actions"
