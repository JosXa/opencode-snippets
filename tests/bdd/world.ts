import {
  After,
  BeforeStep,
  Status,
  setDefaultTimeout,
  setWorldConstructor,
  World,
} from "@cucumber/cucumber";
import { type Driver, type open, type Seed, snippets } from "./driver";

export class LibraryWorld extends World {
  ui!: Driver;
  seeds: Seed[] = snippets.map((seed) => ({ ...seed }));
  options: Parameters<typeof open>[0] = {};
}

setWorldConstructor(LibraryWorld);
setDefaultTimeout(10_000);

BeforeStep(function (this: LibraryWorld, { pickleStep }) {
  this.ui?.record(pickleStep.text);
});

After(async function (this: LibraryWorld, { pickle, result }) {
  if (!this.ui) return;
  try {
    if (result?.status === Status.FAILED) {
      await this.attach(this.ui.frame(), "text/plain");
      await this.ui.artifacts(`${pickle.name}-${pickle.id}`, result.message);
    }
  } finally {
    await this.ui.dispose();
  }
});
