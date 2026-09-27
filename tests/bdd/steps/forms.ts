import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import type { LibraryWorld } from "../world";

const raw = [
  "---",
  "fields:",
  "  target: {type: text, required: true}",
  "  notes: {type: textarea}",
  "  mode: {type: select, options: [Quick, Thorough], required: true}",
  "  enabled: {type: checkbox}",
  "  count: {type: number, min: 1, default: 2}",
  "---",
  "Review {{target}} {{notes}} {{mode}} {{enabled}} {{count}}",
].join("\n");

Given(
  "review has text, multiline, select, checkbox and number fields",
  function (this: LibraryWorld) {
    this.seeds = [{ name: "review", raw }];
  },
);
When("I open the test form", async function (this: LibraryWorld) {
  await this.ui.click("library-action-more");
  await this.ui.choose("Actions for #review", "Test form");
  await this.ui.until(() => assert.ok(this.ui.frame().includes("Fields for #review")));
});
When("I cancel the test form using {string}", async function (this: LibraryWorld, method: string) {
  if (method === "Escape") return this.ui.press("Escape");
  if (method === "Cancel mouse") return this.ui.click("snippet-field-6");
  assert.ok(["Cancel Space", "Cancel Enter"].includes(method));
  for (const _ of Array.from({ length: 6 })) await this.ui.press("Tab");
  await this.ui.press(method.endsWith("Space") ? "Space" : "Enter");
});
Then("no form invocation should be copied or submitted", function (this: LibraryWorld) {
  assert.deepEqual(this.ui.clipboard, []);
  assert.equal(this.ui.host.submits, 0);
});
Then("exactly one form invocation should be copied", function (this: LibraryWorld) {
  assert.equal(this.ui.clipboard.length, 1);
  assert.equal(this.ui.host.submits, 0);
});
Then("one invocation should contain all the entered field values", function (this: LibraryWorld) {
  assert.equal(this.ui.clipboard.length, 1);
  for (const part of [
    'target="src"',
    'notes="First\\n中😀 second"',
    'mode="Thorough"',
    "enabled=yes",
    "count=2",
  ]) {
    assert.ok(this.ui.clipboard[0].includes(part), `Missing ${part} in ${this.ui.clipboard[0]}`);
  }
  assert.equal(this.ui.host.submits, 0);
});
Then("the form source file should be unchanged", async function (this: LibraryWorld) {
  assert.equal(await Bun.file(this.ui.path("review")).text(), raw);
});
Then(
  "the form source draft should end with {string}",
  function (this: LibraryWorld, suffix: string) {
    assert.ok(this.ui.editor().plainText.endsWith(suffix));
  },
);
Then("no library dialog or reload should start behind the form", function (this: LibraryWorld) {
  assert.equal(this.ui.host.dialog, undefined);
  assert.equal(this.ui.host.reloads, 0);
  assert.ok(this.ui.frame().includes("Fields for #review"));
});
Given("the terminal clipboard is unavailable", function (this: LibraryWorld) {
  this.ui.host.clipboard = false;
});
When("I request a reference copy", async function (this: LibraryWorld) {
  await this.ui.click("library-action-more");
  await this.ui.choose("Actions for #review", "Copy reference");
});
