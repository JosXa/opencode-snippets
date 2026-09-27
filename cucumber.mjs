import { resolve } from "node:path";

const artifacts = resolve(process.env.SNIPPETS_BDD_ARTIFACTS ?? ".tmp/bdd");

export default {
  paths: ["tests/bdd/features/*.feature"],
  import: ["tests/bdd/world.ts", "tests/bdd/steps/*.ts"],
  format: ["progress", ["html", `${artifacts}/report.html`], ["junit", `${artifacts}/junit.xml`]],
  // Renderers and global terminal input must not share a process concurrently.
  parallel: 0,
  retry: 0,
  strict: true,
  publish: false,
};
