@editing
Feature: Edit valuable snippets without losing drafts or overwriting files
  Host prompts, selections and confirmations are observed at the dialog boundary.
  Source editing uses the native terminal input and a real temporary library.

  Background:
    Given the snippets library is open

  Scenario: Multiline Unicode editing, undo, redo and save
    When I click "library-action-edit"
    Then the control "library-editor" should have focus
    When I press keys "Ctrl+End, Enter"
    And I paste:
      """
      中😀 New line
      """
    Then the source editor should end with "中😀 New line"
    And I should see "Unsaved"
    When I press "Ctrl+Z"
    Then the source editor should not contain "New line"
    When I press "Ctrl+Y"
    Then the source editor should end with "中😀 New line"
    When I press "Ctrl+S"
    Then the file "review" in "project" scope should end with "中😀 New line"
    And the draft count should be 0
    And the host should have reloaded the library 1 time
    And the host should have received 0 prompt submissions

  Scenario: Find in source preserves the draft even for a missing or cancelled search
    When I click "library-action-edit"
    And I press "Ctrl+End"
    And I paste:
      """

      Review again
      """
    And I press "Ctrl+F"
    Then the host dialog "Find in source" should suggest "Text to find"
    When I answer host dialog "Find in source" with "Review"
    Then I should see "Found: Review"
    And the control "library-editor" should have focus
    When I press "Ctrl+F"
    And I answer host dialog "Find in source" with "not present"
    Then I should see "No match in this snippet."
    When I press "Ctrl+F"
    And I cancel host dialog "Find in source"
    Then the source editor should end with "Review again"
    And the file "review" in "project" scope should match its original source

  Scenario: One Escape leaves the editor and activates list navigation without losing the draft
    When I press keys "Enter, Ctrl+End"
    And I type " retained draft"
    And I press "Escape"
    Then the source editor should be closed
    And the control "library-list" should have focus
    And the library should remain open
    And no library dialog should be open
    When I press "j"
    Then the snippet "global" should be selected
    When I press keys "k, Enter"
    Then the source editor should end with " retained draft"
    And the file "review" in "project" scope should match its original source

  Scenario: Keep editing after an exit attempt retains both drafts
    Given I have unsaved drafts in review and base
    When I press "Escape"
    Then the control "library-list" should have focus
    And the source editor should be closed
    When I press "Escape"
    Then the host dialog "Unsaved snippets" should offer:
      | Save all and return         |
      | Discard changes and return |
      | Keep editing                |
    When I choose "Keep editing" in host dialog "Unsaved snippets"
    Then the library should remain open
    And the draft count should be 2
    When I press "Enter"
    Then the source editor should end with "Base draft"
    When I click "library-file-2"
    Then the source editor should end with "Review draft"
    And the file "review" in "project" scope should match its original source
    And the file "base" in "project" scope should match its original source

  Scenario: Save all before returning saves both files
    Given I have unsaved drafts in review and base
    When I click "library-action-back"
    And I click "library-action-back"
    And I choose "Save all and return" in host dialog "Unsaved snippets"
    Then the library should be closed
    And the file "review" in "project" scope should end with "Review draft"
    And the file "base" in "project" scope should end with "Base draft"
    And the draft count should be 0
    And the host should have reloaded the library 1 time

  Scenario: Discarding on exit does not write either draft
    Given I have unsaved drafts in review and base
    When I press keys "Escape, Escape"
    And I choose "Discard changes and return" in host dialog "Unsaved snippets"
    Then the library should be closed
    And the draft count should be 0
    And the file "review" in "project" scope should match its original source
    And the file "base" in "project" scope should match its original source

  Scenario: q closes from navigation while retaining both drafts
    Given I have unsaved drafts in review and base
    When I press "Shift+Tab"
    Then I should see "quit q"
    When I press "q"
    Then the library should be closed
    And the draft count should be 2
    And the file "review" in "project" scope should match its original source
    And the file "base" in "project" scope should match its original source

  Scenario: A disk conflict blocks saving and reload requires consent
    When I click "library-action-edit"
    And I press "Ctrl+End"
    And I paste:
      """

      My valuable draft
      """
    And an external edit replaces "review" in "project" scope with "External version"
    And I press "Ctrl+S"
    Then I should see "changed on disk"
    And the source editor should end with "My valuable draft"
    And the file "review" in "project" scope should contain "External version"
    And the draft count should be 1
    When I press "Ctrl+R"
    Then the host dialog "Reload this file?" should mention "Discard this snippet's unsaved changes"
    When I reject host dialog "Reload this file?"
    Then the source editor should end with "My valuable draft"
    And the draft count should be 1
    When I press "Ctrl+R"
    And I confirm host dialog "Reload this file?"
    Then the source editor should contain "External version"
    And the draft count should be 0

  Scenario: Save all stops at a disk conflict and does not lose either draft
    Given I have unsaved drafts in review and base
    When an external edit replaces "review" in "project" scope with "External version"
    And I press keys "Escape, Escape"
    And I choose "Save all and return" in host dialog "Unsaved snippets"
    Then I should see "changed on disk"
    And the library should remain open
    And the draft for "review" in "project" scope should remain
    And the draft for "base" in "project" scope should remain
    And the file "review" in "project" scope should contain "External version"
    And the file "base" in "project" scope should match its original source

  Scenario: Cancelling either New prompt does not create a snippet
    When I click "library-action-new"
    Then the host dialog "New snippet name" should suggest "my-snippet"
    When I cancel host dialog "New snippet name"
    Then the snippet "review" should be selected
    When I click "library-action-new"
    And I answer host dialog "New snippet name" with "cancel-scope"
    Then the host dialog "Snippet scope" should offer:
      | Project |
      | Global  |
    When I cancel host dialog "Snippet scope"
    Then the file "cancel-scope" in "project" scope should not exist
    And the file "cancel-scope" in "global" scope should not exist
    And the snippet "review" should be selected

  Scenario: Creating a global snippet opens its editable source
    When I click "library-action-new"
    And I answer host dialog "New snippet name" with "new-global"
    And I choose "Global" in host dialog "Snippet scope"
    Then the snippet "new-global" should be selected
    And the control "library-editor" should have focus
    And the file "new-global" in "global" scope should contain "description:"
    And the host should have reloaded the library 1 time

  Scenario: Invalid and occupied names cannot overwrite project files
    When I click "library-action-new"
    And I answer host dialog "New snippet name" with "base"
    And I choose "Project" in host dialog "Snippet scope"
    Then the file "base" in "project" scope should match its original source
    And the snippet "review" should be selected
    When I click "library-action-new"
    And I answer host dialog "New snippet name" with "bad/name"
    And I choose "Project" in host dialog "Snippet scope"
    Then I should see "Invalid snippet name"
    And the file "bad/name" in "project" scope should not exist

  Scenario: Duplicate cancellation, collision and success preserve the original
    When I click "library-action-more"
    Then the host dialog "Actions for #review" should offer an option "Duplicate"
    When I choose "Duplicate" in host dialog "Actions for #review"
    Then the host dialog "Duplicate snippet: new name" should suggest "review-copy"
    When I cancel host dialog "Duplicate snippet: new name"
    And I click "library-action-more"
    And I choose "Duplicate" in host dialog "Actions for #review"
    And I answer host dialog "Duplicate snippet: new name" with "aborted-copy"
    And I cancel host dialog "Snippet scope"
    Then the file "aborted-copy" in "project" scope should not exist
    And the file "review" in "project" scope should match its original source
    When I click "library-action-more"
    And I choose "Duplicate" in host dialog "Actions for #review"
    And I answer host dialog "Duplicate snippet: new name" with "base"
    And I choose "Project" in host dialog "Snippet scope"
    Then the file "base" in "project" scope should match its original source
    When I click "library-action-more"
    And I choose "Duplicate" in host dialog "Actions for #review"
    And I answer host dialog "Duplicate snippet: new name" with "review-copy"
    And I choose "Global" in host dialog "Snippet scope"
    Then the snippet "review-copy" should be selected
    And the file "review-copy" in "global" scope should contain "Review this code:"
    And the source editor should not contain "aliases: [rev]"
    And the file "review" in "project" scope should match its original source

  Scenario: Rename cancellation, occupied destination and retained old alias
    When I click "library-action-more"
    And I choose "Rename" in host dialog "Actions for #review"
    Then the host dialog "Rename snippet" should suggest "review"
    When I cancel host dialog "Rename snippet"
    And I click "library-action-more"
    And I choose "Rename" in host dialog "Actions for #review"
    And I answer host dialog "Rename snippet" with "renamed"
    Then the host dialog "Rename #review?" should mention "remain as an alias"
    When I reject host dialog "Rename #review?"
    Then the file "review" in "project" scope should match its original source
    And the file "renamed" in "project" scope should not exist
    When I click "library-action-more"
    And I choose "Rename" in host dialog "Actions for #review"
    And I answer host dialog "Rename snippet" with "base"
    And I confirm host dialog "Rename #review?"
    Then the file "review" in "project" scope should match its original source
    And the file "base" in "project" scope should match its original source
    When I click "library-action-more"
    And I choose "Rename" in host dialog "Actions for #review"
    And I answer host dialog "Rename snippet" with "renamed"
    And I confirm host dialog "Rename #review?"
    Then the snippet "renamed" should be selected
    And the file "review" in "project" scope should not exist
    And the file "renamed" in "project" scope should contain "review"
    And I should see "Aliases:"

  Scenario: Move cancellation and occupied destination preserve both files
    When a project snippet "global" appears with content "Project collision"
    And I click "library-action-reload"
    And I click "library-action-global"
    And I click "library-file-0"
    Then the snippet "global" should be selected
    When I click "library-action-more"
    And I choose "Move" in host dialog "Actions for #global"
    Then the host dialog "Move to project?" should mention "will not be overwritten"
    When I reject host dialog "Move to project?"
    Then the file "global" in "global" scope should match its original source
    When I click "library-action-more"
    And I choose "Move" in host dialog "Actions for #global"
    And I confirm host dialog "Move to project?"
    Then the file "global" in "global" scope should match its original source
    And the file "global" in "project" scope should contain "Project collision"

  Scenario: Moving a project snippet to Global keeps its source intact
    When I click "library-action-more"
    And I choose "Move" in host dialog "Actions for #review"
    Then the host dialog "Move to global?" should have confirm label "Move"
    When I confirm host dialog "Move to global?"
    Then the snippet "review" should be selected
    And the file "review" in "global" scope should match its original source
    And the file "review" in "project" scope should not exist

  Scenario: Dirty source blocks rename and move until saved or reloaded
    When I click "library-action-edit"
    And I press "Ctrl+End"
    And I paste:
      """

      Unpublished work
      """
    And I click "library-action-more"
    And I choose "Rename" in host dialog "Actions for #review"
    Then I should see "Save or reload this snippet"
    And no library dialog should be open
    And the source editor should end with "Unpublished work"
    When I click "library-action-more"
    And I choose "Move" in host dialog "Actions for #review"
    Then I should see "Save or reload this snippet"
    And no library dialog should be open
    And the source editor should end with "Unpublished work"
    And the file "review" in "project" scope should match its original source

  Scenario: Delete warns about references and cancellation preserves the file
    When I click "library-file-1"
    And I click "library-action-more"
    And I choose "Delete" in host dialog "Actions for #base"
    Then the host dialog "Delete #base?" should mention "Used by: #review"
    And the host dialog "Delete #base?" should mention "base.md"
    And the host dialog "Delete #base?" should have confirm label "Delete file"
    When I reject host dialog "Delete #base?"
    Then the file "base" in "project" scope should match its original source
    When I click "library-action-more"
    And I choose "Delete" in host dialog "Actions for #base"
    And I confirm host dialog "Delete #base?"
    Then the file "base" in "project" scope should not exist
    And the host should have reloaded the library 1 time

  Scenario: Deleting an unsaved snippet warns and discards only its own draft
    Given I have unsaved drafts in review and base
    When I click "library-action-more"
    And I choose "Delete" in host dialog "Actions for #base"
    Then the host dialog "Delete #base?" should mention "Unsaved changes will be discarded."
    When I reject host dialog "Delete #base?"
    Then the draft count should be 2
    And the file "base" in "project" scope should match its original source
    When I click "library-action-more"
    And I choose "Delete" in host dialog "Actions for #base"
    And I confirm host dialog "Delete #base?"
    Then the file "base" in "project" scope should not exist
    And the draft for "base" in "project" scope should be removed
    And the draft for "review" in "project" scope should remain
