import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import type { Driver } from "../driver";
import type { LibraryWorld } from "../world";

const actions = [
  "back",
  "all",
  "project",
  "global",
  "new",
  "reload",
  "inspect",
  "edit",
  "save",
  "more",
].map((id) => `library-action-${id}`);

async function tabThrough(ui: Driver, ids: string[]) {
  for (const id of ids) {
    await ui.press("Tab");
    ui.focused(id);
  }
}

Given("the initial snippet is {string}", function (this: LibraryWorld, name: string) {
  this.options = { ...this.options, selected: name };
});

Given("review has a long preview ending in a reference to base", function (this: LibraryWorld) {
  this.seeds = this.seeds.map((seed) =>
    seed.name === "review"
      ? {
          ...seed,
          raw: `${Array.from({ length: 75 }, (_, index) => `Line ${index + 1}`).join("\n")}\n#base`,
        }
      : seed,
  );
});

Given("OpenCode has left base mode", function (this: LibraryWorld) {
  this.ui.host.mode = "insert";
});

Then(
  "the visible navigation hints should explain arrows and Shift+Tab",
  function (this: LibraryWorld) {
    assert.match(this.ui.frame(), /(?:↑|↓|arrows|up.*down)/i);
    assert.match(this.ui.frame(), /shift\+tab/i);
  },
);

When("I traverse the library focus ring forward", async function (this: LibraryWorld) {
  this.ui.focused("library-list");
  await this.ui.press("Shift+Tab");
  this.ui.focused("library-search");
  await this.ui.press("Tab");
  this.ui.focused("library-list");
  await tabThrough(this.ui, [
    "library-preview",
    ...actions,
    "library-action-include:base",
    "library-action-include:missing",
    "library-action-help",
  ]);
});

Then(
  "Shift+Tab should retrace the library focus ring and wrap",
  async function (this: LibraryWorld) {
    for (const id of [
      "library-action-include:missing",
      "library-action-include:base",
      ...actions.toReversed(),
      "library-preview",
      "library-list",
      "library-search",
      "library-action-help",
    ]) {
      await this.ui.press("Shift+Tab");
      this.ui.focused(id);
    }
  },
);

When("I select the global scope using Tab and Enter", async function (this: LibraryWorld) {
  await tabThrough(this.ui, ["library-preview", ...actions.slice(0, 4)]);
  await this.ui.press("Enter");
});

When("I Tab to the included reference {string}", async function (this: LibraryWorld, name: string) {
  await tabThrough(this.ui, [
    "library-preview",
    ...actions,
    ...(name === "missing" ? ["base", "missing"] : [name]).map(
      (reference) => `library-action-include:${reference}`,
    ),
  ]);
});

When("I Tab to the Used by link for {string}", async function (this: LibraryWorld, name: string) {
  await tabThrough(this.ui, [
    "library-preview",
    ...actions,
    `library-action-used:${this.ui.path(name)}`,
  ]);
});

Then(
  "the included reference {string} should be visible within the preview",
  function (this: LibraryWorld, name: string) {
    const preview = this.ui.node("library-preview");
    const reference = this.ui.node(`library-action-include:${name}`);
    this.ui.focused(`library-action-include:${name}`);
    assert.ok(reference.y >= preview.y, "reference starts inside the preview");
    assert.ok(
      reference.y + reference.height <= preview.y + preview.height,
      "reference ends inside the preview",
    );
  },
);

Then("the source editor should contain {string}", function (this: LibraryWorld, source: string) {
  assert.equal(this.ui.editor().plainText, source);
});

When(
  "I name the new snippet {string} in the project scope",
  async function (this: LibraryWorld, name: string) {
    await this.ui.answer("New snippet name", name);
    await this.ui.choose("Snippet scope", "Project");
  },
);

Then("the snippet file {string} should exist", async function (this: LibraryWorld, name: string) {
  await this.ui.until(async () => assert.equal(await Bun.file(this.ui.path(name)).exists(), true));
});

When(
  "I resize the terminal to {int} columns by {int} rows",
  async function (this: LibraryWorld, width: number, height: number) {
    await this.ui.resize(width, height);
  },
);

Then("the navigation controls should remain visible after resizing", function (this: LibraryWorld) {
  this.ui.visible("library-search");
  this.ui.visible("library-action-help");
  this.ui.visible("library-action-edit");
  assert.ok(this.ui.frame().includes("edit source enter"));
  assert.ok(this.ui.frame().includes("back esc"));
});

Then(
  "the search input should contain {string} without opening help or quitting",
  function (this: LibraryWorld, value: string) {
    this.ui.focused("library-search");
    assert.ok(this.ui.frame().includes(value));
    assert.ok(!this.ui.frame().includes("P project · G global"));
    assert.equal(this.ui.host.closed, false);
  },
);

When("I clear the search and open the selected source", async function (this: LibraryWorld) {
  await this.ui.press("Backspace");
  await this.ui.press("Backspace");
  await this.ui.press("Enter");
  this.ui.focused("library-list");
  await this.ui.press("Enter");
  this.ui.focused("library-editor");
  await this.ui.press("Ctrl+End");
});

Then(
  "the source editor should end with {string} without opening help or quitting",
  function (this: LibraryWorld, value: string) {
    this.ui.focused("library-editor");
    assert.ok(this.ui.editor().plainText.endsWith(value));
    assert.ok(!this.ui.frame().includes("P project · G global"));
    assert.equal(this.ui.host.closed, false);
  },
);

Then("no library dialog should be open", function (this: LibraryWorld) {
  assert.equal(this.ui.host.dialog, undefined);
});
