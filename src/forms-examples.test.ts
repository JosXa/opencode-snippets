import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { assembleMessage, expandHashtags } from "./expander.js";
import { getSnippetForm, validateFields } from "./fields.js";
import { serializeInvocation } from "./invocation.js";
import { loadSnippets } from "./loader.js";

const registry = await loadSnippets(undefined, `${import.meta.dir}/../examples/forms`);

function render(name: string, values: Record<string, string | number | boolean> = {}) {
  return assembleMessage(expandHashtags(serializeInvocation(name, values), registry)).trim();
}

describe("approved form migrations", () => {
  it("retains review preset defaults and permits explicit outer overrides", () => {
    const presets = [
      ["review", 1, false, 1],
      ["review-with-three", 3, false, 1],
      ["review-and-fix", 1, true, 1],
      ["review-and-fix-with-three", 3, true, 1],
      ["review-and-fix-loop", 1, true, 3],
      ["review-and-fix-with-three-loop", 3, true, 3],
    ] as const;
    for (const [name, reviewers, fix, cycles] of presets) {
      expect(getSnippetForm(name, registry).values).toMatchObject({ reviewers, fix, cycles });
      expect(render(name)).toBe(render("review", { reviewers, fix, cycles }));
      expect(render(name, { reviewers: 2, fix: false, cycles: 1 })).toBe(
        render("review", { reviewers: 2, fix: false, cycles: 1 }),
      );
    }
  });

  // Zero suppresses the whole directive; one omits unnecessary parallelism/repetition.
  for (const reviewers of [0, 1, 3]) {
    for (const cycles of [0, 1, 3]) {
      for (const fix of [false, true]) {
        it(`renders ${reviewers} reviewers, ${cycles} cycles, fix=${fix}`, () => {
          const text = render("review", { reviewers, cycles, fix });
          if (reviewers === 0 || cycles === 0) {
            expect(text).toBe("");
            return;
          }
          expect(text).toContain("Do not perform the review yourself.");
          expect(text).toContain("zero context");
          expect(text).toContain("exact review target and worktree path");
          expect(text).toContain("intent behind the changes");
          expect(text).toContain("every user-requested review focus");
          expect(text.includes("parallel")).toBe(reviewers > 1);
          expect(text.includes("Repeat until")).toBe(cycles > 1);
          expect(text.includes("red unit/integration test")).toBe(fix);
          expect(text.includes("smallest correct fix")).toBe(fix);
          expect(text.includes("confirm green")).toBe(fix);
          expect(text.includes("relevant regression check")).toBe(fix);
          expect(text).not.toContain("#red-green-repro");
          if (reviewers === 1) expect(text).toContain("the `review` subagent");
          if (reviewers > 1) {
            expect(text).toContain("exactly 3 parallel `review` subtasks");
            expect(text).toContain("3 reviewers");
            expect(text).toContain("different area");
          }
          if (cycles > 1) {
            expect(text).toContain("no more actionable or relevant findings");
            expect(text).toContain("Limit the number of cycles to 3");
            expect(text).toContain(`${reviewers} reviewer${reviewers === 1 ? "" : "s"} per cycle`);
          }
        });
      }
    }
  }

  it("omits blank review clauses and preserves an explicit target and focus", () => {
    const blank = render("review", { target: "", focus: "" });
    expect(blank).not.toContain("Exact review target:");
    expect(blank).not.toContain("Review focus:");
    const selected = render("review", {
      target_type: "files",
      target: "src/parser.ts",
      focus: "Unicode\nQuoted values",
    });
    expect(selected).toContain("Review target type: files.");
    expect(selected).toContain("Exact review target: src/parser.ts.");
    expect(selected).toContain("Review focus: Unicode\nQuoted values");
    expect(selected).not.toContain("Determine which type");
  });

  it("preserves options aliases, presets, and inherited naming counts", () => {
    for (const [name, alias, count] of [
      ["five-options", "five", 5],
      ["ten-options", "ten", 10],
      ["twenty-options", "twenty", 20],
    ] as const) {
      expect(render(name)).toBe(`give me ${count} options to choose from`);
      expect(render(alias)).toBe(render(name));
      expect(render(alias, { count: 2 })).toBe("give me 2 options to choose from");
    }
    expect(render("options", { count: 0 })).toBe("");
    expect(render("options", { count: 1 })).toBe("give me 1 option to choose from");
    expect(render("suggest-name", { count: 0, constraint: "short" })).toBe("");
    const single = render("suggest-name", { count: 1 });
    expect(single).toContain("(suggest a better name)");
    expect(single).toContain("give me 1 option to choose from");
    expect(single).not.toContain("constraint:");
    const many = render("suggest-name", { count: 7, constraint: "lowercase, no spaces" });
    expect(many).toContain("(suggest better names; naming constraint: lowercase, no spaces)");
    expect(many).toContain("give me 7 options to choose from");
    expect(getSnippetForm("suggest-name", registry).fields.map((field) => field.name)).toEqual([
      "count",
      "constraint",
    ]);
  });

  it("keeps reword shortcuts and distinguishes choose-one from suggestions", () => {
    expect(render("reword-now")).toBe(
      "reword (choose a better way to phrase this, it doesn't quite fit)",
    );
    expect(render("reword-three")).toBe(
      "reword (give me 3 suggestions for how to phrase this differently)",
    );
    expect(render("reword-five")).toBe(
      "reword (give me 5 suggestions for how to phrase this differently)",
    );
    expect(render("reword-five", { count: 0 })).toBe("");
    expect(render("reword-five", { count: 1, tone: "warm" })).toBe(
      "reword (choose a better way to phrase this, it doesn't quite fit; tone: warm)",
    );
    expect(render("reword", { count: 2, tone: "" })).not.toContain("tone:");
    expect(getSnippetForm("reword", registry).fields.map((field) => field.name)).toEqual([
      "count",
      "tone",
    ]);
  });

  it("keeps MyApps navigation and places the reminder in final-reply instructions", () => {
    expect(render("myapps", { app: "Payroll" })).toBe(
      "MyApps (use the browser to navigate to myapps.microsoft.com and search for Payroll)",
    );
    const reminder = render("remindme", { text: "Read the draft\nAsk Alice" });
    expect(reminder).toContain(
      "When you are done with the other task, remind me in your final message: Read the draft\nAsk Alice",
    );
    expect(reminder).not.toMatch(/calendar|schedule/i);
  });

  it("preserves handover semantics with and without an explicit branch", () => {
    const blank = render("push-handover", { branch: "" });
    expect(blank).toStartWith("Commit and push all relevant changes to a branch.");
    const explicit = render("push-handover", { branch: "handover/forms" });
    expect(explicit).toStartWith("Commit and push all relevant changes to branch handover/forms.");
    for (const text of [blank, explicit]) {
      expect(text).toContain(
        'The last sentence of the handover file must read: "Delete this handover.md file after reading it and continue where the other agent left off."',
      );
      expect(text).toContain("potentially incomplete or broken state");
      expect(text).toContain("you may skip pre-commit hooks");
      expect(text).toContain("identify the remote repository and branch");
      expect(text).toContain("output the completion promise");
    }
  });

  it("preserves prompt defaults, its alias, and context-based optional clauses", () => {
    const form = getSnippetForm("generate-prompt", registry);
    expect(form.fields.map((field) => field.name)).toEqual([
      "outcome",
      "extra",
      "platform",
      "opencode",
      "file",
      "path",
    ]);
    expect(form.values).toMatchObject({ platform: "From context", opencode: false, file: true });
    expect(form.fields.every((field) => !field.required)).toBe(true);
    const text = render("generate-prompt");
    expect(render("prompt")).toBe(text);
    expect(text).toContain("Infer the requested outcome from the surrounding message");
    expect(text).toContain("~/prompts/{kebab-topic}.prompt.md");
    expect(text).toContain("If file writing is unavailable");
    expect(text).toContain("depending on your OS");
    expect(text).toContain("fresh session with no prior context assumed");
    expect(text).not.toContain("Additional instructions for the generated prompt:");
    expect(text).not.toContain("opencode.json(c)");
    expect(text).not.toContain("permachine");
    expect(text).toEndWith("generate a prompt");
  });

  it("prints explicit prompt instructions and the OpenCode section without a hedge", () => {
    const text = render("prompt", {
      outcome: "Install the tools\nVerify the setup",
      extra: "Use concise prose\nInclude commands",
      opencode: true,
      file: true,
      path: "prompts/setup.md",
    });
    expect(text).toContain(
      "The receiving agent should achieve this outcome:\nInstall the tools\nVerify the setup",
    );
    expect(text).not.toContain("Infer the requested outcome");
    expect(text).toContain(
      "Additional instructions for the generated prompt:\nUse concise prose\nInclude commands",
    );
    expect(text).toContain("Write the generated prompt to this output path: prompts/setup.md.");
    expect(text).not.toContain("~/prompts/");
    expect(text).toContain("only a single plain `opencode.json(c)` file");
    expect(text).toContain(
      "must not mention permachine or machine-specific generated configs at all",
    );
    expect(text).not.toMatch(/if (?:this |the (?:task|prompt) )?(?:involves|concerns) OpenCode/i);
  });

  it("omits file instructions and the path when prompt output is a reply", () => {
    const text = render("generate-prompt", {
      file: false,
      path: "ignored.md",
      extra: "",
      outcome: "",
    });
    expect(text).toContain("codefence in the reply. Do not write a file.");
    expect(text).toContain("~~~markdown");
    expect(text).not.toContain("ignored.md");
    expect(text).not.toContain("~/prompts/");
    expect(text).not.toContain("If file writing is unavailable");
    expect(text).not.toContain("Additional instructions for the generated prompt:");
  });

  it("renders direct platform choices for generated prompts", () => {
    expect(getSnippetForm("prompt", registry).fields[2]?.options).toEqual([
      "From context",
      "Cross-platform",
      "Linux",
      "macOS",
      "Windows",
    ]);
    for (const platform of ["Linux", "macOS", "Windows"]) {
      const text = render("prompt", { platform });
      expect(text).toContain(`Target ${platform}. Adapt installation, paths`);
      expect(text).not.toContain("depending on your OS");
    }
    expect(render("prompt", { platform: "Cross-platform" })).toContain(
      "Make the instructions cross-platform and distinguish OS-specific steps where necessary.",
    );
  });
});

const reference = await Bun.file(
  `${import.meta.dir}/../skill/snippets/references/fields-and-forms.md`,
).text();
const bodies = [...reference.matchAll(/```markdown\n([\s\S]*?)\n```/g)].map(
  (match) => match[1] ?? "",
);
const directory = resolve(import.meta.dir, "../examples/forms");
// Load the documentation through the production Markdown/frontmatter parser.
const examples = await loadSnippets(
  undefined,
  directory,
  new Map(bodies.map((content, index) => [`${directory}/example${index + 1}.md`, content])),
);

describe("natural-language authoring acceptance examples", () => {
  function form(index: number, values: Record<string, string | number | boolean> = {}) {
    return getSnippetForm(`example${index}`, examples, values);
  }

  function output(index: number, values: Record<string, string | number | boolean>) {
    return assembleMessage(
      expandHashtags(serializeInvocation(`example${index}`, values), examples),
    ).trim();
  }

  it("1: limits branch names to 20 Unicode code points", () => {
    const definition = form(1);
    expect(validateFields(definition.fields, { branch: "😀".repeat(20) })).toEqual({});
    expect(validateFields(definition.fields, { branch: "😀".repeat(21) })).toHaveProperty("branch");
    expect(output(1, { branch: "feature" })).toBe("Branch: feature");
  });

  it("2: preserves multiline bug descriptions and reproduction steps", () => {
    expect(form(2).fields.map((field) => field.type)).toEqual(["textarea", "textarea"]);
    expect(output(2, { bug: "First\nSecond", steps: "One\nTwo" })).toBe(
      "Bug:\nFirst\nSecond\nReproduction steps:\nOne\nTwo",
    );
  });

  it("3: combines text with a checkbox printed as yes/no", () => {
    expect(form(3).fields.map((field) => field.type)).toEqual(["text", "checkbox"]);
    expect(output(3, { task: "a parser", goal: true })).toBe("Build a parser.\nUse a goal: yes");
    expect(output(3, { task: "a parser", goal: false })).toBe("Build a parser.\nUse a goal: no");
  });

  it("4: accepts exactly the three requested review choices", () => {
    const definition = form(4);
    expect(definition.fields[0]?.options).toEqual(["quick", "normal", "thorough"]);
    for (const depth of ["quick", "normal", "thorough"]) {
      expect(output(4, { depth })).toBe(`Review depth: ${depth}`);
    }
    expect(validateFields(definition.fields, { depth: "extra" })).toHaveProperty("depth");
  });

  it("5: supplies an editable main default", () => {
    expect(form(5).values.branch).toBe("main");
    expect(output(5, {})).toBe("Target branch: main");
    expect(output(5, { branch: "dev" })).toBe("Target branch: dev");
  });

  it("6: requires the task and omits blank optional context", () => {
    expect(validateFields(form(6).fields, { task: "  ", context: "" })).toHaveProperty("task");
    expect(validateFields(form(6).fields, { task: "Build", context: "" })).toEqual({});
    expect(output(6, { task: "Build", context: "" })).toBe("Task: Build");
    expect(output(6, { task: "Build", context: "Use Bun" })).toBe(
      "Task: Build\nExtra context: Use Bun",
    );
  });

  it("7: accepts integers from 3 through 10 inclusively", () => {
    const definition = form(7);
    for (const count of [3, 10]) {
      expect(validateFields(definition.fields, { count })).toEqual({});
      expect(output(7, { count })).toBe(`Give me ${count} ideas.`);
    }
    for (const count of [2, 11, 3.5]) {
      expect(validateFields(definition.fields, { count })).toHaveProperty("count");
    }
  });

  it("8: asks for a version once and reuses it at every occurrence", () => {
    expect(form(8).fields).toHaveLength(1);
    expect(output(8, { version: "v2.3" })).toBe(
      "Release v2.3.\nTag the release v2.3 and mention v2.3 in the announcement.",
    );
  });

  it("9: validates package characters without silently rewriting", () => {
    const definition = form(9);
    expect(validateFields(definition.fields, { package: "my-package-2" })).toEqual({});
    expect(validateFields(definition.fields, { package: "Wrong_Name" })).toHaveProperty("package");
    expect(output(9, { package: "my-package-2" })).toBe("Package: my-package-2");
  });

  it("10: starts the goal checkbox checked and allows it to be cleared", () => {
    expect(form(10).values.goal).toBe(true);
    expect(output(10, {})).toBe("Use a goal: yes");
    expect(output(10, { goal: false })).toBe("Use a goal: no");
  });

  it("preserves the documented escaped literal Handlebars expression", () => {
    expect(output(13, { name: "Ada" })).toBe("Name: Ada\nLiteral example: {{example}}");
    expect(form(13).fields.map((field) => field.name)).toEqual(["name"]);
  });
});
