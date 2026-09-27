import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { ScrollBoxRenderable } from "@opentui/core";
import type { LibraryWorld } from "../world";

const positions = new WeakMap<LibraryWorld, { row: number; height: number }>();

function pane(world: LibraryWorld, id: string) {
  const node = world.ui.node(id);
  assert.ok(node instanceof ScrollBoxRenderable);
  return node;
}

function row(world: LibraryWorld) {
  const path = world.ui.state.selected;
  const name = path?.split("/").at(-1)?.replace(/\.md$/, "");
  assert.ok(name);
  return Number(name.replace("item", ""));
}

Given("the library has {int} numbered snippets", function (this: LibraryWorld, count: number) {
  this.seeds = Array.from({ length: count }, (_, index) => ({
    name: `item${String(index + 1).padStart(2, "0")}`,
    raw: `Snippet ${index + 1}`,
  }));
  this.options = { ...this.options, selected: "item01" };
});

When("I remember the list position", function (this: LibraryWorld) {
  positions.set(this, { row: row(this), height: pane(this, "library-list").viewport.height });
});

Then(
  "the list selection should advance by a {string} page",
  function (this: LibraryWorld, size: string) {
    const before = positions.get(this);
    assert.ok(before);
    assert.equal(
      row(this) - before.row,
      size === "half" ? Math.floor(before.height / 2) : before.height,
    );
  },
);

Then(
  "the selected row should be at the {string} of the list viewport",
  function (this: LibraryWorld, position: string) {
    const list = pane(this, "library-list");
    const offset = row(this) - 1 - list.scrollTop;
    const expected =
      position === "top"
        ? 0
        : position === "bottom"
          ? list.viewport.height - 1
          : Math.floor((list.viewport.height - 1) / 2);
    assert.equal(offset, expected);
  },
);

Then(
  "the pane {string} should be scrolled to line {int}",
  function (this: LibraryWorld, id: string, line: number) {
    assert.equal(pane(this, id).scrollTop, line);
  },
);

Then("the pane {string} should have scrolled down", function (this: LibraryWorld, id: string) {
  assert.ok(pane(this, id).scrollTop > 0);
});

Then("the pane {string} should be at its end", function (this: LibraryWorld, id: string) {
  const box = pane(this, id);
  assert.equal(box.scrollTop, box.scrollHeight - box.viewport.height);
});
