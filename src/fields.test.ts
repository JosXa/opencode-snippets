import { describe, expect, test } from "bun:test";
import { assembleMessage, expandHashtags } from "./expander.js";
import { getSnippetForm, validateFields } from "./fields.js";
import { type Invocation, parseInvocation, serializeInvocation } from "./invocation.js";
import type { SnippetInfo, SnippetRegistry } from "./types.js";

type Body = string | Pick<SnippetInfo, "content" | "fields">;
const registry = (entries: Record<string, Body>): SnippetRegistry =>
  new Map(
    Object.entries(entries).map(([name, body]) => [
      name,
      {
        name,
        aliases: [],
        filePath: "",
        source: "project",
        ...(typeof body === "string" ? { content: body } : body),
      },
    ]),
  );
const render = (body: Body, values = {}) =>
  assembleMessage(
    expandHashtags(
      Object.keys(values).length ? serializeInvocation("form", values) : "#form",
      registry({ form: body }),
    ),
  );

describe("frontmatter form discovery", () => {
  test("all ten authoring scenarios use typed metadata and ordinary variables", () => {
    const cases: Array<
      [
        Pick<SnippetInfo, "content" | "fields">,
        Record<string, string | number | boolean>,
        Record<string, string | number | boolean>,
      ]
    > = [
      [
        { fields: { branch: { maxLength: 20 } }, content: "{{branch}}" },
        { branch: "feature" },
        { branch: "a".repeat(21) },
      ],
      [
        {
          fields: { bug: { type: "textarea" }, steps: { type: "textarea" } },
          content: "{{bug}}\n{{steps}}",
        },
        { bug: "first\nsecond", steps: "α\nβ" },
        { steps: false },
      ],
      [
        { fields: { task: {}, goal: { type: "checkbox" } }, content: "{{task}}/{{goal}}" },
        { task: "Ship", goal: false },
        { goal: "false" },
      ],
      [
        {
          fields: { mode: { type: "select", options: ["quick", "normal", "thorough"] } },
          content: "{{mode}}",
        },
        { mode: "normal" },
        { mode: "fast" },
      ],
      [
        { fields: { branch: { default: "main" } }, content: "{{branch}}" },
        { branch: "dev" },
        { branch: true },
      ],
      [
        { fields: { task: { required: true }, context: {} }, content: "{{task}}/{{context}}" },
        { task: "Ship", context: "" },
        { task: "  " },
      ],
      [
        {
          fields: { count: { type: "number", integer: true, min: 3, max: 10 } },
          content: "{{count}}",
        },
        { count: 3 },
        { count: 2 },
      ],
      [
        { fields: { version: { required: true } }, content: "{{version}} {{version}}" },
        { version: "v2" },
        { version: "" },
      ],
      [
        {
          fields: { package: { pattern: "^[a-z0-9-]+$", label: "Package name" } },
          content: "{{package}}",
        },
        { package: "package-2" },
        { package: "UPPER" },
      ],
      [
        { fields: { goal: { type: "checkbox", default: true } }, content: "{{goal}}" },
        { goal: false },
        { goal: 1 },
      ],
    ];
    for (const [body, good, bad] of cases) {
      const form = getSnippetForm("form", registry({ form: body }));
      expect(validateFields(form.fields, { ...form.values, ...good })).toEqual({});
      expect(
        Object.keys(validateFields(form.fields, { ...form.values, ...bad })).length,
      ).toBeGreaterThan(0);
      expect(() => render(body, good)).not.toThrow();
    }
    expect(getSnippetForm("form", registry({ form: cases[4][0] })).values.branch).toBe("main");
    expect(getSnippetForm("form", registry({ form: cases[9][0] })).values.goal).toBe(true);
  });

  test("unused metadata creates fields without evaluating branches, skills or shell", () => {
    const body = {
      fields: { hidden: { required: true }, toggle: { type: "checkbox" } },
      content: '{{#if false}}{{unknown}}{{/if}} {{skill "missing"}} !`exit 99`',
    };
    const form = getSnippetForm("form", registry({ form: body }));
    expect(form.fields.map((field) => field.name)).toEqual(["hidden", "toggle"]);
    expect(validateFields(form.fields, form.values).hidden).toContain("required");
    expect(form.values.toggle).toBe(false);
  });
  test.each(
    [
      null,
      undefined,
      [],
      "text",
      42,
      true,
      new Date(),
      { x: null },
      { x: [] },
      { x: "text" },
      { "bad-key": {} },
      { constructor: {} },
      JSON.parse('{"__proto__":{}}'),
      { x: { type: "invalid" } },
      { x: { pattern: "[" } },
      { x: { required: "yes" } },
      { x: { min: 1 } },
      { x: { type: "number", default: "1" } },
      { x: { default: null } },
      { x: { default: {} } },
      { x: { type: "number", default: Infinity } },
      { x: { maxLength: -1 } },
      { x: { type: "select" } },
      { x: { options: ["a"] } },
      { x: { type: "number", min: 3, max: 2 } },
      { x: { type: "select", options: "a,b" } },
      { x: { type: "select", options: [] } },
      { x: { type: "select", options: ["a", 1] } },
      { x: { render: false } },
      { x: { surprise: true } },
      { x: { label: false } },
      { x: { min: Infinity } },
      { x: { integer: "true" } },
    ].map((fields) => ({ fields })),
  )("rejects invalid schemas and metadata: %j", ({ fields }) => {
    expect(() => getSnippetForm("form", registry({ form: { fields, content: "body" } }))).toThrow();
  });
  test("repeated variables reuse one field and Unicode bounds count code points", () => {
    const body = { fields: { name: { maxLength: 2 } }, content: "{{name}} {{name}}" };
    expect(getSnippetForm("form", registry({ form: body })).fields).toHaveLength(1);
    expect(render(body, { name: "🙂🙂" })).toBe("🙂🙂 🙂🙂");
    expect(() => render(body, { name: "🙂🙂🙂" })).toThrow("2 characters");
  });
  test("nested presets, outer overrides, aliases and independent top-level answers", () => {
    const snippets = registry({
      base: {
        fields: { count: { type: "number", default: 1 }, tone: {} },
        content: "{{count}}/{{tone}}",
      },
      preset: '#base(count=3, tone="brief")',
      outer: "#preset(count=5)",
    });
    snippets.set("alias", snippets.get("outer") as SnippetInfo);
    expect(getSnippetForm("alias", snippets).values).toEqual({ count: 5, tone: "brief" });
    expect(
      expandHashtags('#alias(count=0) #preset(tone="long") #base(count=2)', snippets).text,
    ).toBe("0/brief 3/long 2/");
  });
  test("nested schema conflicts and unknown arguments fail", () => {
    expect(() =>
      getSnippetForm(
        "root",
        registry({
          root: "#a #b",
          a: { fields: { x: { type: "number" } }, content: "" },
          b: { fields: { x: { type: "checkbox" } }, content: "" },
        }),
      ),
    ).toThrow("Conflicting");
    expect(() => render({ fields: { x: {} }, content: "{{x}}" }, { unknown: "oops" })).toThrow(
      "unknown field",
    );
  });
  test("own authored order precedes nested body order and preset text is never traversed", () => {
    const snippets = registry({
      root: { fields: { first: {}, last: {} }, content: '#child(text="#trap") {{last}} #second' },
      child: { fields: { text: {} }, content: "{{text}}" },
      second: { fields: { after: {} }, content: "{{after}}" },
      trap: { fields: { unexpected: { required: true } }, content: "BAD" },
    });
    expect(getSnippetForm("root", snippets).fields.map((field) => field.name)).toEqual([
      "first",
      "last",
      "text",
      "after",
    ]);
    expect(expandHashtags("#root", snippets).text).toBe("#trap  ");
  });
  test("nested forms never activate a legacy parent and references never declare fields", () => {
    const snippets = registry({
      root: "{{session_id}} {{answer}} #child",
      child: { fields: { answer: { default: "Ada" } }, content: "{{answer}} {{undeclared}}" },
    });
    expect(getSnippetForm("root", snippets).fields.map((field) => field.name)).toEqual(["answer"]);
    expect(expandHashtags("#root", snippets).text).toBe("{{session_id}} {{answer}} Ada");
    expect(render({ fields: {}, content: "{{undeclared}}" })).toBe("");
  });
});

describe("typed Handlebars rendering", () => {
  const review = {
    fields: {
      count: { type: "number", min: 0, default: 1 },
      cycles: { type: "number", min: 0, default: 1 },
      fix: { type: "checkbox" },
    },
    content:
      '{{#if (gt count 0)}}{{#if (gt cycles 0)}}{{count}} {{plural count "reviewer" "reviewers"}}{{#if (gt count 1)}} in parallel{{/if}}{{#if fix}} fix{{/if}}{{#if (gt cycles 1)}} for {{cycles}} cycles{{/if}}{{/if}}{{/if}}',
  };
  test.each([false, true])("zero/one/many retain number and checkbox semantics fix=%s", (fix) => {
    expect(render(review, { count: 0, fix })).toBe("");
    expect(render(review, { cycles: 0, fix })).toBe("");
    expect(render(review, { count: 1, fix })).toBe(`1 reviewer${fix ? " fix" : ""}`);
    expect(render(review, { count: 3, cycles: 3, fix })).toBe(
      `3 reviewers in parallel${fix ? " fix" : ""} for 3 cycles`,
    );
  });
  test("checkbox output, required false, subexpressions and whitespace control", () => {
    expect(
      render(
        {
          fields: { yes: { type: "checkbox", required: true } },
          content: "{{yes}}/{{yes}}/{{#if (eq yes false)}}off{{/if}}",
        },
        { yes: false },
      ),
    ).toBe("no/no/off");
    expect(render({ fields: { x: {} }, content: "a {{~x~}} b" }, { x: "<b>\n&" })).toBe("a<b>\n&b");
  });
  test.each([
    "{{session_id}}",
    '{{field "x"}}',
    '{{field "broken"',
    'Keep {{example "field"}} for later.',
    'Keep {{example "skill"}} and {{session_id}}.',
    'Keep {{example "field" broken=}}.',
    'Keep {{example "skill" for later.',
    "{{this.field}} {{this.skill}}",
    "{{! field and (skill) }} {{session_id}}",
    '{{!-- {{skill "example"}} --}} {{session_id}}',
  ])("fieldless legacy templates stay literal: %s", (content) => {
    const snippets = registry({ legacy: content });
    expect(getSnippetForm("legacy", snippets)).toEqual({ fields: [], values: {} });
    expect(expandHashtags("#legacy", snippets).text).toBe(content);
  });
  test("explicit empty schema opts in, obsolete helpers are unavailable, invalid templates fail", () => {
    expect(
      expandHashtags("#form()", registry({ form: { fields: {}, content: "{{missing}}" } })).text,
    ).toBe("");
    expect(render({ fields: {}, content: "{{#if true}}YES{{/if}}" })).toBe("YES");
    expect(() => render({ fields: {}, content: '{{field "x"}}' })).toThrow(
      'Missing helper: "field"',
    );
    expect(() => render({ fields: {}, content: '{{choices "x"}}' })).toThrow(
      'Missing helper: "choices"',
    );
    expect(() =>
      getSnippetForm("form", registry({ form: { fields: {}, content: "{{#if broken" } })),
    ).toThrow();
    expect(() => getSnippetForm("form", registry({ form: '{{skill "name"' }))).toThrow();
  });
  test("escaping, trimmed comments and ordinary prose retain their boundaries", () => {
    expect(render({ fields: { name: {} }, content: "\\{{name}} {{name}}" }, { name: "Ada" })).toBe(
      "{{name}} Ada",
    );
    expect(render({ fields: { name: {} }, content: "\\\\{{name}}" }, { name: "Ada" })).toBe(
      "\\Ada",
    );
    expect(
      render(
        { fields: { name: {} }, content: "{{~!-- {{ignored}} --~}} {{name}}" },
        { name: "Ada" },
      ),
    ).toBe("Ada");
    expect(
      expandHashtags(
        "ordinary {{name}} #_form",
        registry({ form: { fields: { name: {} }, content: "{{name}}" } }),
      ).text,
    ).toBe("ordinary {{name}} #_form");
  });
  test("printed answers remain literal through nested invocations and block syntax", () => {
    const value = '#nested(x="bad") #skill(secret) <append>extra</append> {{x}} !`exit 9`';
    const snippets = registry({
      form: {
        fields: { x: {} },
        content: "{{x}}/{{x}}<append>{{x}}</append><inject>{{x}}</inject>",
      },
      nested: "BAD",
    });
    const result = expandHashtags(serializeInvocation("form", { x: value }), snippets);
    expect(result.text).toBe(`${value}/${value}`);
    expect(result.append).toEqual([value]);
    expect(result.inject).toEqual([value]);
  });
  test("context lookups and helper output retain literal text", () => {
    const answer = "#child <append>untrusted</append> !`exit 99`";
    expect(
      render(
        {
          fields: { answer: {} },
          content: '{{this.answer}}/{{lookup this "answer"}}/{{#with answer}}{{this}}{{/with}}',
        },
        { answer },
      ),
    ).toBe(`${answer}/${answer}/${answer}`);
  });
  test("inline skills opt in alone and resolve only on expansion", () => {
    const snippets = registry({ form: '{{skill "review"}}', legacy: "old" });
    expect(getSnippetForm("form", snippets).fields).toEqual([]);
    expect(
      expandHashtags("#form #legacy(please)", snippets, new Map(), { skill: () => "BODY" }).text,
    ).toBe("BODY old(please)");
  });
  test("helper-name fields use explicit context paths without implicitly declaring fields", () => {
    expect(render("{{skill}} {{field}} {{choices}} {{eq}}")).toBe(
      "{{skill}} {{field}} {{choices}} {{eq}}",
    );
    expect(
      render(
        {
          fields: { skill: {}, field: {}, choices: {}, eq: {} },
          content: "{{this.skill}}/{{field}}/{{choices}}/{{this.eq}}",
        },
        { skill: "s", field: "f", choices: "c", eq: "e" },
      ),
    ).toBe("s/f/c/e");
  });
});

describe("invocation grammar", () => {
  test("lossless quoted content and UTF-16 ranges", () => {
    const values = { text: 'a,(b) "c"\n\\ 🙂', number: -2.5, enabled: true };
    const text = `🙂 ${serializeInvocation("demo", values)} tail`;
    const parsed = parseInvocation(text, 3) as Invocation;
    expect(parsed.values).toEqual(values);
    expect(text.slice(parsed.end)).toBe(" tail");
    expect(serializeInvocation("demo", values)).toContain("enabled=yes");
  });
  test.each([
    '#x(a="open)',
    "#x(a=1,a=2)",
    "#x(a=Infinity)",
    "#x(a=NaN)",
    "#x(a=1e999)",
    "#x(a=01)",
    "#x(a=1,)",
    "#x(a=true",
    "#x(a=1 b=2)",
    "#x(a=one)",
    "#x(1)",
    "#x(constructor=1)",
  ])("rejects malformed %s", (text) => expect(() => parseInvocation(text, 0)).toThrow());
  test.each([
    '#form(x="open)',
    "#form(x=1,)",
    "#form(x=)",
    "#form(prose)",
  ])("known fields never partially expand %s", (text) =>
    expect(() =>
      expandHashtags(text, registry({ form: { fields: { x: {} }, content: "{{x}}" } })),
    ).toThrow());
});
