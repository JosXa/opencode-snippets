import assert from "node:assert/strict";
import { type DataTable, Given, Then, When } from "@cucumber/cucumber";
import type { LibraryWorld } from "../world";

Given("I have unsaved drafts in review and base", async function (this: LibraryWorld) {
  await this.ui.click("library-action-edit");
  await this.ui.press("Ctrl+End");
  await this.ui.paste("\nReview draft");
  await this.ui.click("library-file-1");
  await this.ui.click("library-action-edit");
  await this.ui.press("Ctrl+End");
  await this.ui.paste("\nBase draft");
  assert.equal(this.ui.state.drafts.size, 2);
});

When(
  "an external edit replaces {string} in {string} scope with {string}",
  async function (this: LibraryWorld, name: string, scope: string, content: string) {
    await Bun.write(this.ui.path(name, scope), content);
  },
);

When(
  "a project snippet {string} appears with content {string}",
  async function (this: LibraryWorld, name: string, content: string) {
    await Bun.write(this.ui.path(name), content);
  },
);

Then(
  "the host dialog {string} should offer:",
  async function (this: LibraryWorld, title: string, table: DataTable) {
    const pending = await this.ui.dialog(title);
    assert.deepEqual(
      pending.options?.map((option) => option.title),
      table.raw().map((row) => row[0]),
    );
  },
);

Then(
  "the host dialog {string} should offer an option {string}",
  async function (this: LibraryWorld, title: string, label: string) {
    const pending = await this.ui.dialog(title);
    assert.ok(pending.options?.some((option) => option.title === label));
  },
);

Then(
  "the host dialog {string} should mention {string}",
  async function (this: LibraryWorld, title: string, text: string) {
    const pending = await this.ui.dialog(title);
    assert.ok(pending.message?.includes(text), `Dialog ${title} should mention ${text}`);
  },
);

Then(
  "the host dialog {string} should suggest {string}",
  async function (this: LibraryWorld, title: string, placeholder: string) {
    assert.equal((await this.ui.dialog(title)).placeholder, placeholder);
  },
);

Then(
  "the host dialog {string} should have confirm label {string}",
  async function (this: LibraryWorld, title: string, label: string) {
    assert.equal((await this.ui.dialog(title)).label?.confirm, label);
  },
);

When(
  "I answer host dialog {string} with {string}",
  async function (this: LibraryWorld, title: string, value: string) {
    assert.equal((await this.ui.dialog(title)).kind, "prompt");
    await this.ui.answer(title, value);
  },
);

When("I cancel host dialog {string}", async function (this: LibraryWorld, title: string) {
  const pending = await this.ui.dialog(title);
  assert.notEqual(pending.kind, "confirm", "Use reject for a host confirmation");
  await this.ui.answer(title, undefined);
});

When("I reject host dialog {string}", async function (this: LibraryWorld, title: string) {
  assert.equal((await this.ui.dialog(title)).kind, "confirm");
  await this.ui.answer(title, false);
});

When("I confirm host dialog {string}", async function (this: LibraryWorld, title: string) {
  assert.equal((await this.ui.dialog(title)).kind, "confirm");
  await this.ui.answer(title, true);
});

When(
  "I choose {string} in host dialog {string}",
  async function (this: LibraryWorld, option: string, title: string) {
    assert.equal((await this.ui.dialog(title)).kind, "select");
    await this.ui.choose(title, option);
  },
);

Then(
  "the source editor should end with {string}",
  async function (this: LibraryWorld, text: string) {
    await this.ui.until(() => assert.ok(this.ui.editor().plainText.endsWith(text)));
  },
);

Then("the source editor should not contain {string}", function (this: LibraryWorld, text: string) {
  assert.ok(!this.ui.editor().plainText.includes(text));
});

Then("the draft count should be {int}", async function (this: LibraryWorld, count: number) {
  await this.ui.until(() =>
    assert.equal(
      [...this.ui.state.drafts.values()].filter((draft) => draft.raw !== draft.file.raw).length,
      count,
    ),
  );
});

Then(
  "the draft for {string} in {string} scope should remain",
  function (this: LibraryWorld, name: string, scope: string) {
    assert.ok(this.ui.state.drafts.has(this.ui.path(name, scope)));
  },
);

Then(
  "the draft for {string} in {string} scope should be removed",
  function (this: LibraryWorld, name: string, scope: string) {
    assert.equal(this.ui.state.drafts.has(this.ui.path(name, scope)), false);
  },
);

Then(
  "the file {string} in {string} scope should match its original source",
  async function (this: LibraryWorld, name: string, scope: string) {
    const seed =
      this.seeds.find((item) => item.name === name && (item.source ?? "project") === scope) ??
      this.seeds.find((item) => item.name === name);
    assert.ok(seed, `Missing original ${scope} seed: ${name}`);
    await this.ui.until(async () =>
      assert.equal(await Bun.file(this.ui.path(name, scope)).text(), seed.raw),
    );
  },
);

Then(
  "the file {string} in {string} scope should contain {string}",
  async function (this: LibraryWorld, name: string, scope: string, text: string) {
    await this.ui.until(async () =>
      assert.ok((await Bun.file(this.ui.path(name, scope)).text()).includes(text)),
    );
  },
);

Then(
  "the file {string} in {string} scope should end with {string}",
  async function (this: LibraryWorld, name: string, scope: string, text: string) {
    await this.ui.until(async () =>
      assert.ok((await Bun.file(this.ui.path(name, scope)).text()).endsWith(text)),
    );
  },
);

Then(
  "the file {string} in {string} scope should not exist",
  async function (this: LibraryWorld, name: string, scope: string) {
    await this.ui.until(async () =>
      assert.equal(await Bun.file(this.ui.path(name, scope)).exists(), false),
    );
  },
);

Then(
  "the host should have reloaded the library {int} time",
  async function (this: LibraryWorld, count: number) {
    await this.ui.until(() => assert.equal(this.ui.host.reloads, count));
  },
);

Then(
  "the host should have received {int} prompt submissions",
  function (this: LibraryWorld, count: number) {
    assert.equal(this.ui.host.submits, count);
  },
);
