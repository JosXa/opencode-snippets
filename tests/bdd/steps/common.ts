import assert from "node:assert/strict";
import { type DataTable, Given, Then, When } from "@cucumber/cucumber";
import { open } from "../driver";
import type { LibraryWorld } from "../world";

Given("the library is empty", function (this: LibraryWorld) {
  this.seeds = [];
});
Given(
  "the terminal is {int} columns by {int} rows",
  function (this: LibraryWorld, width: number, height: number) {
    this.options = { ...this.options, width, height };
  },
);
Given("the library contains:", function (this: LibraryWorld, table: DataTable) {
  this.seeds = table.hashes().map((row) => ({
    name: row.name,
    source: row.scope === "global" ? "global" : "project",
    raw: `---\naliases: ${JSON.stringify(row.aliases?.split(",").filter(Boolean) ?? [])}\ndescription: ${JSON.stringify(row.description ?? "")}\n---\n${row.body ?? row.name}`,
  }));
});
Given("the snippets library is open", async function (this: LibraryWorld) {
  assert.ok(!this.ui, "Open the library once per scenario");
  this.ui = await open({ ...this.options, seeds: this.seeds });
});
When("I press {string}", async function (this: LibraryWorld, key: string) {
  await this.ui.press(key);
});
When("I press keys {string}", async function (this: LibraryWorld, sequence: string) {
  for (const key of sequence.split(",").map((key) => key.trim())) {
    await this.ui.press(key);
  }
});
When("I type {string}", async function (this: LibraryWorld, text: string) {
  await this.ui.type(text);
});
When("I paste:", async function (this: LibraryWorld, text: string) {
  await this.ui.paste(text);
});
When("I click {string}", async function (this: LibraryWorld, id: string) {
  await this.ui.click(id);
});
Then("I should see {string}", async function (this: LibraryWorld, text: string) {
  await this.ui.until(() =>
    assert.ok(this.ui.frame().includes(text), `Expected visible text: ${text}`),
  );
});
Then("I should not see {string}", async function (this: LibraryWorld, text: string) {
  await this.ui.until(() =>
    assert.ok(!this.ui.frame().includes(text), `Unexpected visible text: ${text}`),
  );
});
Then("the control {string} should have focus", async function (this: LibraryWorld, id: string) {
  await this.ui.until(() => this.ui.focused(id));
});
Then("the snippet {string} should be selected", async function (this: LibraryWorld, name: string) {
  await this.ui.until(() => {
    assert.ok(
      this.ui.state.selected?.endsWith(`/${name}.md`),
      `Expected selected snippet: ${name}`,
    );
    assert.ok(this.ui.frame().includes(`› #${name}`), "Selected row must be visible");
  });
});
Then("the library should remain open", function (this: LibraryWorld) {
  assert.equal(this.ui.host.closed, false);
});
Then("the library should be closed", async function (this: LibraryWorld) {
  await this.ui.until(() => assert.equal(this.ui.host.closed, true));
});
Then("the source editor should be closed", function (this: LibraryWorld) {
  assert.ok(!this.ui.frame().includes("Markdown + YAML"));
});
