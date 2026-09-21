// Public packages keep registry-relative lock entries so corporate registry
// settings on a maintainer's machine do not become a release prerequisite.
const file = Bun.file(new URL("../bun.lock", import.meta.url));
const input = await file.text();
const output = input.replace(
  /"https:\/\/artifactory01\.tvcorp\.org(?::443)?\/artifactory\/api\/npm\/npm\/[^"\r\n]+\.tgz"/g,
  '""',
);
if (Bun.argv.includes("--check")) {
  if (input !== output) throw new Error("Run bun scripts/normalize-lockfile.ts before committing.");
} else {
  await Bun.write(file, output);
}
