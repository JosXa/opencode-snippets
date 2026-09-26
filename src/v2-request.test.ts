import { describe, expect, test } from "bun:test";
import {
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  mkdtemp as temporary,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "@opencode/plugin";
import { Effect, Queue, Stream } from "effect";
import { serializeInvocation } from "./invocation.js";
import type { SnippetRegistry } from "./types.js";
import { expandRequestMessages, setupV2Snippets, setupV2SnippetsEffect } from "./v2-request.js";
import { DurableStore } from "./v2-state.js";

// macOS exposes /var as a symlink. Use the host's canonical project identity
// in both mock expectations and durable storage paths.
const mkdtemp = async (prefix: string) => realpath(await temporary(prefix));

const snippets: SnippetRegistry = new Map([
  [
    "proof",
    {
      name: "proof",
      description: "V2 request proof",
      content: "EXPANDED_BY_V2_REQUEST_HOOK",
      source: "project",
      filePath: "/tmp/proof.md",
      aliases: [],
    },
  ],
]);

// Mirrors OC2 session/runner/to-llm-message.ts: native skills precede nonempty
// prompt text; text attachments follow it, and message metadata survives intact.
function nativeUser(
  submission: { messageID: string; prompt: { text: string }; metadata?: Record<string, unknown> },
  skills: string[] = [],
) {
  return {
    id: submission.messageID,
    role: "user",
    metadata: structuredClone(submission.metadata),
    content: [
      ...skills.map((text) => ({ type: "text", text })),
      ...(submission.prompt.text === "" ? [] : [{ type: "text", text: submission.prompt.text }]),
      {
        type: "text",
        text: "\n\nAttached file: notes.txt\n\nATTACHMENT #chosen",
        metadata: {
          attachment: { source: { type: "inline" }, name: "notes.txt", description: undefined },
        },
      },
    ],
  };
}

async function submissionFixture() {
  const directory = await mkdtemp(join(tmpdir(), "snippets-native-submission-"));
  const snippetDirectory = join(directory, ".opencode", "snippet");
  const skillDirectory = join(directory, "skills");
  await mkdir(snippetDirectory, { recursive: true });
  await mkdir(join(skillDirectory, "hidden"), { recursive: true });
  await writeFile(join(snippetDirectory, "chosen.md"), "CHOSEN_TEXT");
  await writeFile(
    join(snippetDirectory, "queued.md"),
    "queued visible <inject>QUEUED_INJECTION</inject>",
  );
  await writeFile(
    join(snippetDirectory, "config.jsonc"),
    JSON.stringify({ experimental: { injectBlocks: true, skillLoading: true } }),
  );
  await writeFile(
    join(skillDirectory, "hidden", "SKILL.md"),
    "---\nname: hidden\ndescription: Hidden skill\n---\nDURABLE_HIDDEN_SKILL",
  );
  const hooks = new Map<string, (input: never) => Promise<void>>();
  const registration = { dispose: async () => {} };
  const skills = [
    {
      id: "hidden",
      name: "hidden",
      description: "Hidden skill",
      location: join(skillDirectory, "hidden", "SKILL.md"),
      content: "DURABLE_HIDDEN_SKILL",
    },
  ];
  const context = {
    session: {
      get: async () => ({ location: { directory } }),
      hook: async (name: string, callback: (input: never) => Promise<void>) => {
        hooks.set(name, callback);
        return registration;
      },
    },
    skill: {
      transform: async () => registration,
      list: async ({ location }: { location: { directory: string } }) => {
        expect(location.directory).toBe(directory);
        return { data: skills };
      },
    },
    tool: {
      hook: async (name: string, callback: (input: never) => Promise<void>) => {
        hooks.set(name, callback);
        return registration;
      },
    },
    event: { subscribe: () => ({ async *[Symbol.asyncIterator]() {} }) },
  };
  const start = () =>
    setupV2Snippets(context as never, {
      directory,
      skillDirectory,
      globalDirectory: join(directory, "global"),
      homeDirectory: join(directory, "home"),
      dataDirectory: join(directory, "data"),
    });
  let cleanup = await start();
  return {
    directory,
    skills,
    invoke: async (name: string, input: unknown) => {
      const hook = hooks.get(name);
      if (hook) await hook(input as never);
    },
    restart: async () => {
      await cleanup();
      cleanup = await start();
    },
    dispose: async () => {
      await cleanup();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

describe("native OC2 submitted messages", () => {
  test("a broken nested snippet leaves skill tool output intact", async () => {
    const host = await submissionFixture();
    try {
      await Bun.write(
        join(host.directory, ".opencode", "snippet", "broken.md"),
        "---\nfields:\n  extra: {type: textarea}\n---\n{{extra}}",
      );
      const event = {
        sessionID: "tool-failure",
        tool: "skill",
        status: "completed",
        result: { content: [{ text: "#chosen" }, { text: '#broken(extra="bad\nJSON")' }] },
      };
      const original = structuredClone(event.result);
      await host.invoke("execute.after", event);
      expect(event.result).toEqual(original);
    } finally {
      await host.dispose();
    }
  });

  test.each([
    false,
    true,
  ])("multipart global symlink writes and reverse reads persist with a linked directory=%s", async (linkedDir) => {
    const host = await submissionFixture();
    try {
      const globalDir = join(host.directory, "global");
      const targetDir = linkedDir ? join(host.directory, "dotfiles", "snippets") : globalDir;
      await Bun.write(join(targetDir, "bar.md"), "OLD");
      if (linkedDir) await symlink(targetDir, globalDir);
      await symlink(linkedDir ? join(targetDir, "bar.md") : "bar.md", join(globalDir, "foo.md"));
      const texts = [
        '/snippets add foo "NEW"',
        "#bar #foo",
        '/snippets add bar "REVERSE"',
        "#foo #bar",
        "/snippets delete foo",
        "#foo #bar",
      ];
      const original = {
        sessionID: "linked-write",
        messages: [
          { id: "multipart", role: "user", content: texts.map((text) => ({ type: "text", text })) },
        ],
      };
      const request = structuredClone(original);
      await host.invoke("context", request);
      expect(request.messages[0].content[1].text).toBe("NEW NEW");
      expect(request.messages[0].content[3].text).toBe("REVERSE REVERSE");
      expect(request.messages[0].content[5].text).toBe("#foo REVERSE");
      expect(await Bun.file(join(globalDir, "bar.md")).text()).toBe("REVERSE");
      await host.restart();
      const replay = structuredClone(original);
      await host.invoke("context", replay);
      expect(replay.messages[0].content).toEqual(request.messages[0].content);
    } finally {
      await host.dispose();
    }
  });
  test("a created inline skill template resolves before reservation with legacy flags disabled", async () => {
    const host = await submissionFixture();
    try {
      await Bun.write(join(host.directory, ".opencode", "snippet", "config.jsonc"), "{}");
      const body = '{{skill "hidden"}}';
      const request = {
        sessionID: "planned-skill",
        messages: [
          {
            id: "multipart",
            role: "user",
            content: [
              { type: "text", text: `/snippets add inline ${JSON.stringify(body)} --project` },
              { type: "text", text: "#inline" },
            ],
          },
        ],
      };
      await host.invoke("context", request);
      expect(request.messages[0].content[1].text).toBe("DURABLE_HIDDEN_SKILL");
      expect(await Bun.file(join(host.directory, ".opencode", "snippet", "inline.md")).text()).toBe(
        body,
      );
    } finally {
      await host.dispose();
    }
  });
  test("multipart commands preserve sequential creation, overwrite, aliases and deletion fallbacks", async () => {
    const host = await submissionFixture();
    try {
      const texts = [
        '/snippets add created "CREATED #chosen" --project --aliases fresh --desc "Created description"',
        "#created #fresh",
        '/snippets add created "UPDATED" --project --aliases newest',
        "#created #fresh #newest",
        '/snippets add victim "GLOBAL" --aliases lower',
        '/snippets add victim "!`printf BAD >> deleted-ran`" --project --aliases upper',
        "/snippets delete victim",
        "#victim #lower #upper",
        "/snippets delete victim",
        "#victim #lower",
        '/snippets add unexpanded "#chosen !`printf BAD >> body-ran`" --project',
      ];
      const original = {
        sessionID: "command-order",
        messages: [
          { id: "multipart", role: "user", content: texts.map((text) => ({ type: "text", text })) },
        ],
      };
      const request = structuredClone(original);
      await host.invoke("context", request);
      const output = request.messages[0].content;
      expect(output[1].text).toBe("CREATED CHOSEN_TEXT CREATED CHOSEN_TEXT");
      expect(output[3].text).toBe("UPDATED #fresh UPDATED");
      expect(output[7].text).toBe("GLOBAL GLOBAL #upper");
      expect(output[9].text).toBe("#victim #lower");
      expect(await Bun.file(join(host.directory, "deleted-ran")).exists()).toBe(false);
      expect(await Bun.file(join(host.directory, "body-ran")).exists()).toBe(false);
      expect(
        await Bun.file(join(host.directory, ".opencode", "snippet", "unexpanded.md")).text(),
      ).toBe("#chosen !`printf BAD >> body-ran`");
      await host.restart();
      const replay = structuredClone(original);
      await host.invoke("context", replay);
      expect(replay.messages[0].content).toEqual(output);
    } finally {
      await host.dispose();
    }
  });

  test("deletion exposes the plural-directory definition and its aliases without executing the removed body", async () => {
    const host = await submissionFixture();
    try {
      await Bun.write(
        join(host.directory, ".opencode", "snippets", "layer.md"),
        "---\naliases: [lower]\n---\nFALLBACK",
      );
      await Bun.write(
        join(host.directory, ".opencode", "snippet", "layer.md"),
        "---\naliases: [upper]\n---\n!`printf BAD >> removed-body`",
      );
      const request = {
        sessionID: "plural-fallback",
        messages: [
          {
            id: "multipart",
            role: "user",
            content: [
              { type: "text", text: "/snippets delete layer" },
              { type: "text", text: "#layer #lower #upper" },
            ],
          },
        ],
      };
      await host.invoke("context", request);
      expect(request.messages[0].content[1].text).toBe("FALLBACK FALLBACK #upper");
      expect(await Bun.file(join(host.directory, "removed-body")).exists()).toBe(false);
    } finally {
      await host.dispose();
    }
  });

  test("planned definitions validate later parts before creating, overwriting, deleting or running shell", async () => {
    const host = await submissionFixture();
    try {
      const directory = join(host.directory, ".opencode", "snippet");
      await Bun.write(join(directory, "victim.md"), "KEEP");
      const field = "---\nfields:\n  target:\n    required: true\n---\n{{target}}";
      const original = {
        sessionID: "planned-validation",
        messages: [
          {
            id: "same",
            role: "user",
            content: [
              { type: "text", text: '/snippets add chosen "OVERWRITTEN" --project' },
              { type: "text", text: "/snippets delete victim" },
              {
                type: "text",
                text: `/snippets add required "${field}" --project --aliases need`,
              },
              { type: "text", text: "!`printf BAD >> planned-effects`" },
              { type: "text", text: "#need" },
            ],
          },
        ],
      };
      const unchanged = structuredClone(original);
      await host.invoke("context", unchanged);
      expect(unchanged.messages[0].content).toEqual(original.messages[0].content);
      expect(await Bun.file(join(directory, "chosen.md")).text()).toBe("CHOSEN_TEXT");
      expect(await Bun.file(join(directory, "victim.md")).text()).toBe("KEEP");
      expect(await Bun.file(join(directory, "required.md")).exists()).toBe(false);
      expect(await Bun.file(join(host.directory, "planned-effects")).exists()).toBe(false);
    } finally {
      await host.dispose();
    }
  });
  test("multipart validation precedes commands and shell, and the exact failed key can retry after correction", async () => {
    const host = await submissionFixture();
    try {
      const directory = join(host.directory, ".opencode", "snippet");
      await Bun.write(join(directory, "review.md"), "Old review definition");
      const original = {
        sessionID: "retry-context",
        messages: [
          {
            id: "same-message",
            role: "user",
            content: [
              { type: "text", text: '/snippets add created "CREATED" --project' },
              { type: "text", text: "!`printf x >> retry-effects; printf EFFECT`" },
              { type: "text", text: "#review(reviewers=3)" },
            ],
          },
        ],
      };
      const unknown = structuredClone(original);
      await host.invoke("context", unknown);
      expect(unknown.messages[0].content).toEqual(original.messages[0].content);
      expect(await Bun.file(join(directory, "created.md")).exists()).toBe(false);
      expect(await Bun.file(join(host.directory, "retry-effects")).exists()).toBe(false);
      await Bun.write(
        join(directory, "review.md"),
        '---\nfields:\n  reviewers:\n    type: number\n---\n{{reviewers}} {{skill "missing"}}',
      );
      await host.restart();
      const missing = structuredClone(original);
      await host.invoke("context", missing);
      expect(missing.messages[0].content).toEqual(original.messages[0].content);
      expect(await Bun.file(join(directory, "created.md")).exists()).toBe(false);
      expect(await Bun.file(join(host.directory, "retry-effects")).exists()).toBe(false);
      host.skills.push({ ...host.skills[0], id: "missing", name: "missing", content: "RESOLVED" });
      await host.restart();
      const corrected = structuredClone(original);
      await host.invoke("context", corrected);
      expect(corrected.messages[0].content[2].text).toBe("3 RESOLVED");
      expect(await Bun.file(join(directory, "created.md")).exists()).toBe(true);
      expect(await Bun.file(join(host.directory, "retry-effects")).text()).toBe("x");
      await Bun.write(join(directory, "review.md"), "---\nfields: null\n---\nBroken");
      await host.restart();
      const replay = structuredClone(original);
      await host.invoke("context", replay);
      expect(replay.messages[0].content).toEqual(corrected.messages[0].content);
      expect(await Bun.file(join(host.directory, "retry-effects")).text()).toBe("x");
    } finally {
      await host.dispose();
    }
  });

  test("a failed prompt with unchanged identity can retry when its required default is corrected", async () => {
    const host = await submissionFixture();
    try {
      const path = join(host.directory, ".opencode", "snippet", "retry.md");
      await Bun.write(
        path,
        "---\nfields:\n  target:\n    required: true\n---\n{{target}} !`printf x >> prompt-retry`",
      );
      const original = { sessionID: "retry-prompt", messageID: "same", prompt: { text: "#retry" } };
      const unchanged = structuredClone(original);
      await host.invoke("prompt", unchanged);
      expect(unchanged.prompt.text).toBe(original.prompt.text);
      await Bun.write(
        path,
        "---\nfields:\n  target:\n    required: true\n    default: fixed\n---\n{{target}} !`printf x >> prompt-retry`",
      );
      await host.restart();
      const corrected = structuredClone(original);
      await host.invoke("prompt", corrected);
      expect(corrected.prompt.text).toContain("fixed");
      await host.restart();
      await host.invoke("prompt", structuredClone(original));
      expect(await Bun.file(join(host.directory, "prompt-retry")).text()).toBe("x");
    } finally {
      await host.dispose();
    }
  });
  test("field answers remain literal through XML, hidden skill, shell, injection and durable replay", async () => {
    const host = await submissionFixture();
    try {
      const directory = join(host.directory, ".opencode", "snippet");
      await Bun.write(
        join(directory, "config.jsonc"),
        JSON.stringify({
          experimental: { injectBlocks: true, skillLoading: true, skillRendering: true },
        }),
      );
      await Bun.write(
        join(directory, "form.md"),
        '---\nfields:\n  text:\n    type: textarea\n    required: true\n---\n{{text}}/{{text}}<append>{{text}}</append><inject>{{text}}</inject> !`printf x >> effects; printf EFFECT` {{skill "hidden"}} #skill(hidden)',
      );
      const answer =
        '#chosen #skill(hidden) <skill name="hidden" /> <append>INJECTED</append> <inject>INJECTED</inject> {{field "oops"}} !`printf BAD >> hostile`\n"🙂"';
      const raw = serializeInvocation("form", { text: answer });
      const submission = { sessionID: "literal", messageID: "first", prompt: { text: raw } };
      await host.invoke("prompt", submission);
      expect(submission.prompt.text).toBe(
        `${answer}/${answer} EFFECT DURABLE_HIDDEN_SKILL ↳ Loaded hidden\n\n${answer}`,
      );
      expect(await Bun.file(join(host.directory, "hostile")).exists()).toBe(false);
      expect(await Bun.file(join(host.directory, "effects")).text()).toBe("x");
      const request = { sessionID: "literal", messages: [nativeUser(submission)] };
      await host.invoke("context", request);
      expect(request.messages[0].content[0].text).toBe(answer);
      expect(request.messages[2].content[0].text.match(/<skill_content /g)).toHaveLength(1);
      await host.restart();
      const replay = { sessionID: "literal", messageID: "first", prompt: { text: raw } };
      await host.invoke("prompt", replay);
      expect(replay.prompt.text).toBe(submission.prompt.text);
      expect(await Bun.file(join(host.directory, "effects")).text()).toBe("x");
      const edited = {
        sessionID: "literal",
        messageID: "first",
        prompt: { text: serializeInvocation("form", { text: "edited" }) },
      };
      await host.invoke("prompt", edited);
      expect(edited.prompt.text).toStartWith("edited/edited EFFECT");
      expect(await Bun.file(join(host.directory, "effects")).text()).toBe("xx");
    } finally {
      await host.dispose();
    }
  });

  test("headless field errors preserve input without shell effects; zero admits empty text", async () => {
    const host = await submissionFixture();
    try {
      const directory = join(host.directory, ".opencode", "snippet");
      await Bun.write(
        join(directory, "required.md"),
        "---\nfields:\n  target:\n    label: Review target\n    required: true\n---\n{{target}} !`printf BAD >> invalid-effect`",
      );
      await Bun.write(
        join(directory, "zero.md"),
        "---\nfields:\n  count:\n    type: number\n    min: 0\n    default: 1\n---\n{{#if (gt count 0)}}Review{{/if}}",
      );
      for (const text of [
        "#required",
        '#required(target="  ")',
        "#required(target=3)",
        '#required(target="broken)',
        "#required(unknown=yes)",
      ]) {
        const submission = { sessionID: "validation", messageID: text, prompt: { text } };
        await host.invoke("prompt", submission);
        expect(submission.prompt.text).toBe(text);
      }
      expect(await Bun.file(join(host.directory, "invalid-effect")).exists()).toBe(false);
      const zero = {
        sessionID: "validation",
        messageID: "zero",
        prompt: { text: "#zero(count=0)" },
      };
      await host.invoke("prompt", zero);
      expect(zero.prompt.text).toBe("");
      await host.restart();
      const replay = {
        sessionID: "validation",
        messageID: "zero",
        prompt: { text: "#zero(count=0)" },
      };
      await host.invoke("prompt", replay);
      expect(replay.prompt.text).toBe("");
    } finally {
      await host.dispose();
    }
  });
  test("invalid YAML schemas preserve input before multipart effects and remain retryable", async () => {
    const host = await submissionFixture();
    try {
      const path = join(host.directory, ".opencode", "snippet", "schema.md");
      const original = {
        sessionID: "schema-retry",
        messages: [
          {
            id: "same",
            role: "user",
            content: [
              { type: "text", text: "!`printf x >> schema-effect`" },
              { type: "text", text: "#schema" },
            ],
          },
        ],
      };
      for (const fields of [
        "null",
        "[]",
        "{x: {render: false}}",
        "{x: {type: select, options: [one, false]}}",
        "{x: null}",
      ]) {
        await Bun.write(path, `---\nfields: ${fields}\n---\n{{x}}`);
        const unchanged = structuredClone(original);
        await host.invoke("context", unchanged);
        expect(unchanged.messages[0].content).toEqual(original.messages[0].content);
        expect(await Bun.file(join(host.directory, "schema-effect")).exists()).toBe(false);
        await host.restart();
      }
      for (const yaml of ["fields:\n  x: {}\n  x: {default: duplicate}", "fields: [unclosed"]) {
        await Bun.write(path, `---\n${yaml}\n---\n!\`printf x >> schema-body-effect\``);
        for (let attempt = 0; attempt < 3; attempt++) {
          const unchanged = structuredClone(original);
          await host.invoke("context", unchanged);
          expect(unchanged.messages[0].content).toEqual(original.messages[0].content);
          expect(await Bun.file(join(host.directory, "schema-effect")).exists()).toBe(false);
          expect(await Bun.file(join(host.directory, "schema-body-effect")).exists()).toBe(false);
          await host.restart();
        }
      }
      await Bun.write(path, "---\nfields:\n  x:\n    default: fixed\n---\n{{x}}");
      const fixed = structuredClone(original);
      await host.invoke("context", fixed);
      expect(fixed.messages[0].content[1].text).toBe("fixed");
      expect(await Bun.file(join(host.directory, "schema-effect")).text()).toBe("x");
    } finally {
      await host.dispose();
    }
  });

  test("malformed YAML command metadata preserves input before writes or shell effects", async () => {
    const host = await submissionFixture();
    try {
      for (const yaml of ["fields:\n  x: {}\n  x: {}", "fields: [unclosed"]) {
        const original = {
          sessionID: "command-yaml-retry",
          messages: [
            {
              id: "same",
              role: "user",
              content: [
                { type: "text", text: "!`printf x >> command-yaml-effect`" },
                {
                  type: "text",
                  text: `/snippets add broken "---\n${yaml}\n---\nBODY" --project --aliases bad`,
                },
              ],
            },
          ],
        };
        for (let attempt = 0; attempt < 3; attempt++) {
          const unchanged = structuredClone(original);
          await host.invoke("context", unchanged);
          expect(unchanged.messages[0].content).toEqual(original.messages[0].content);
          expect(await Bun.file(join(host.directory, "command-yaml-effect")).exists()).toBe(false);
          expect(
            await Bun.file(join(host.directory, ".opencode", "snippet", "broken.md")).exists(),
          ).toBe(false);
          await host.restart();
        }
      }
    } finally {
      await host.dispose();
    }
  });

  test("inline skills work without legacy experimental skill flags", async () => {
    const host = await submissionFixture();
    try {
      const directory = join(host.directory, ".opencode", "snippet");
      await Bun.write(join(directory, "config.jsonc"), "{}");
      await Bun.write(join(directory, "inline.md"), '{{skill "hidden"}}');
      const submission = { sessionID: "inline", messageID: "first", prompt: { text: "#inline" } };
      await host.invoke("prompt", submission);
      expect(submission.prompt.text).toBe("DURABLE_HIDDEN_SKILL");
    } finally {
      await host.dispose();
    }
  });

  test("keeps mixed direct, recursive and block skill payloads in visible order", async () => {
    const host = await submissionFixture();
    try {
      host.skills.push({ ...host.skills[0], id: "other-id", name: "Other", content: "OTHER_BODY" });
      const directory = join(host.directory, ".opencode", "snippet");
      await Bun.write(join(directory, "leaf.md"), "#skill(hidden)");
      await Bun.write(
        join(directory, "outer.md"),
        '<prepend>#leaf</prepend>BODY<append>#skill("other-id")</append>',
      );
      await Bun.write(join(directory, "skill.md"), "WRONG_SNIPPET");
      const submission = {
        sessionID: "ordered",
        messageID: "ordered-message",
        prompt: { text: '#outer #skill("Other") #leaf' },
      };
      await host.invoke("prompt", submission);
      expect(submission.prompt.text).toBe(
        "↳ Loaded hidden\n\nBODY ↳ Loaded Other ↳ Loaded hidden\n\n↳ Loaded Other",
      );
      const request = { sessionID: "ordered", messages: [nativeUser(submission)] };
      await host.invoke("context", request);
      expect(
        [...request.messages[1].content[0].text.matchAll(/<skill_content name="([^"]+)">/g)].map(
          (match) => match[1],
        ),
      ).toEqual(["hidden", "Other", "hidden", "Other"]);
    } finally {
      await host.dispose();
    }
  });

  test("refreshes nested files and completed drafts without changing durable results", async () => {
    const host = await submissionFixture();
    try {
      const directory = join(host.directory, ".opencode", "snippet");
      await Bun.write(join(directory, "parent.md"), "#child #draft");
      await Bun.write(join(directory, "child.md"), "OLD");
      await Bun.write(join(directory, "draft.md"), "");
      const first = { sessionID: "refresh", messageID: "first", prompt: { text: "#parent" } };
      await host.invoke("prompt", first);
      expect(first.prompt.text).toBe("OLD #draft");
      await Bun.write(join(directory, "child.md"), "NEW !`printf x >> refresh-count; printf ONCE`");
      await Bun.write(join(directory, "draft.md"), "#skill(hidden)");
      const second = { sessionID: "refresh", messageID: "second", prompt: { text: "#parent" } };
      await host.invoke("prompt", second);
      expect(second.prompt.text).toBe("NEW ONCE ↳ Loaded hidden");
      await host.restart();
      // Retry the original admission, including its raw text, after files changed.
      const replay = { sessionID: "refresh", messageID: "first", prompt: { text: "#parent" } };
      await host.invoke("prompt", replay);
      expect(replay.prompt.text).toBe("OLD #draft");
      await host.invoke("context", {
        sessionID: "refresh",
        messages: [nativeUser(first), nativeUser(second)],
      });
      expect(await Bun.file(join(host.directory, "refresh-count")).text()).toBe("x");
      await rm(join(directory, "child.md"));
      const third = { sessionID: "refresh", messageID: "third", prompt: { text: "#parent" } };
      await host.invoke("prompt", third);
      expect(third.prompt.text).toBe("#child ↳ Loaded hidden");
    } finally {
      await host.dispose();
    }
  });

  test("uses native skill IDs and refreshed host content rather than a second filesystem registry", async () => {
    const host = await submissionFixture();
    try {
      const directory = join(host.directory, ".opencode", "snippet");
      await Bun.write(join(directory, "native.md"), '#skill("plugin:remote")');
      host.skills.push({
        ...host.skills[0],
        id: "plugin:remote",
        name: "Remote",
        content: "HOST_ONLY",
      });
      const submission = {
        sessionID: "native-registry",
        messageID: "first",
        prompt: { text: "#native" },
      };
      await host.invoke("prompt", submission);
      expect(submission.prompt.text).toBe("↳ Loaded Remote");
      host.skills[1].content = "HOST_UPDATED";
      const next = {
        sessionID: "native-registry",
        messageID: "second",
        prompt: { text: "#native" },
      };
      await host.invoke("prompt", next);
      const request = {
        sessionID: "native-registry",
        messages: [nativeUser(submission), nativeUser(next)],
      };
      await host.invoke("context", request);
      expect(request.messages[1].content[0].text).toContain("HOST_ONLY");
      expect(request.messages[3].content[0].text).toContain("HOST_UPDATED");
    } finally {
      await host.dispose();
    }
  });

  test("restores injection order and measures recency using real messages after restart", async () => {
    const host = await submissionFixture();
    try {
      const directory = join(host.directory, ".opencode", "snippet");
      await Bun.write(
        join(directory, "config.jsonc"),
        JSON.stringify({
          experimental: { injectBlocks: true, skillLoading: true },
          injectRecencyMessages: 2,
        }),
      );
      await Bun.write(
        join(directory, "first.md"),
        "FIRST<inject>OLD_CONTEXT</inject>#skill(hidden)",
      );
      await Bun.write(
        join(directory, "second.md"),
        "SECOND<inject>NEW_CONTEXT</inject>#skill(hidden)",
      );
      const first = { sessionID: "recency", messageID: "first", prompt: { text: "#first" } };
      const second = { sessionID: "recency", messageID: "second", prompt: { text: "#second" } };
      await host.invoke("prompt", first);
      await host.invoke("prompt", second);
      for (const restart of [false, true]) {
        if (restart) await host.restart();
        const request = {
          sessionID: "recency",
          messages: [
            nativeUser(first),
            { id: "reply", role: "assistant", content: [{ type: "text", text: "REPLY" }] },
            nativeUser(second),
          ],
        };
        await host.invoke("context", request);
        await host.invoke("context", request);
        expect(
          request.messages.map((message) =>
            message.content[0].text.replace(/<skill_content[\s\S]*/, "SKILL"),
          ),
        ).toEqual([
          "FIRST↳ Loaded hidden",
          "SKILL",
          "OLD_CONTEXT",
          "NEW_CONTEXT",
          "REPLY",
          "SECOND↳ Loaded hidden",
          "SKILL",
        ]);
      }
    } finally {
      await host.dispose();
    }
  });

  // These boundaries match the V1 pipeline:
  // XML renders before hashtags, hidden skill bodies expand snippets and shell,
  // and injection blocks only recurse through snippet references.
  test("preserves V1 expansion boundaries around skill bodies, XML and injections", async () => {
    const host = await submissionFixture();
    try {
      const directory = join(host.directory, ".opencode", "snippet");
      await Bun.write(
        join(directory, "config.jsonc"),
        JSON.stringify({
          experimental: { injectBlocks: true, skillLoading: true, skillRendering: true },
        }),
      );
      await Bun.write(join(directory, "xml.md"), '<skill name="hidden" />');
      await Bun.write(
        join(directory, "parent.md"),
        "#chosen<inject>#chosen #skill(hidden) !`printf NEVER`</inject>",
      );
      host.skills[0].content = "#chosen #skill(hidden) !`printf NEVER`";
      const submission = {
        sessionID: "boundaries",
        messageID: "first",
        prompt: { text: "#xml #parent #skill(hidden) #_chosen #missing" },
      };
      await host.invoke("prompt", submission);
      expect(submission.prompt.text).toBe(
        '<skill name="hidden" /> CHOSEN_TEXT ↳ Loaded hidden #_chosen #missing',
      );
      const request = { sessionID: "boundaries", messages: [nativeUser(submission)] };
      await host.invoke("context", request);
      expect(request.messages[0].content[0].text).toBe(
        "CHOSEN_TEXT #skill(hidden) !`printf NEVER`",
      );
      expect(request.messages[2].content[0].text).toContain("CHOSEN_TEXT #skill(hidden) NEVER");
    } finally {
      await host.dispose();
    }
  });

  test.each([
    true,
    false,
  ])("matches V1 recursive skill-tool expansion with injectBlocks=%s", async (injectBlocks) => {
    const host = await submissionFixture();
    try {
      const directory = join(host.directory, ".opencode", "snippet");
      await Bun.write(
        join(directory, "config.jsonc"),
        JSON.stringify({
          experimental: { injectBlocks, skillRendering: true, skillLoading: true },
        }),
      );
      await Bun.write(join(directory, "inner.md"), "#chosen");
      await Bun.write(
        join(directory, "outer.md"),
        "BODY #inner <prepend>PRE #inner</prepend><append>POST #inner</append><inject>INJECT #inner</inject> #skill(hidden) !`printf NEVER`",
      );
      const event = {
        sessionID: "tool",
        tool: "skill",
        status: "completed",
        result: { content: [{ type: "text", text: "#outer" }] },
      };
      await host.invoke("execute.after", event);
      const text = event.result.content[0].text;
      expect(text).toContain("PRE CHOSEN_TEXT");
      expect(text).toContain("BODY CHOSEN_TEXT");
      expect(text).toContain("POST CHOSEN_TEXT");
      expect(text).toContain("#skill(hidden) !`printf NEVER`");
      expect(text.includes("INJECT CHOSEN_TEXT")).toBe(!injectBlocks);
      await Bun.write(join(directory, "inner.md"), "UPDATED");
      event.result.content[0].text = "#outer";
      await host.invoke("execute.after", event);
      expect(event.result.content[0].text).toContain("BODY UPDATED");
      for (const overrides of [{ tool: "read" }, { status: "error" }]) {
        const untouched = {
          ...event,
          ...overrides,
          result: { content: [{ type: "text", text: "#outer" }] },
        };
        await host.invoke("execute.after", untouched);
        expect(untouched.result.content[0].text).toBe("#outer");
      }
    } finally {
      await host.dispose();
    }
  });

  test.each([
    "#skill(hidden)",
    "#oct",
    "#octui",
    "#nested",
  ])("loads skills introduced by %s and retains their hidden context after restart", async (text) => {
    const host = await submissionFixture();
    try {
      const directory = join(host.directory, ".opencode", "snippet");
      await Bun.write(
        join(directory, "oct.md"),
        "---\naliases: [octui]\n---\nMake sure to test it thoroughly through the TUI or opencode run: #skill(hidden)",
      );
      await Bun.write(join(directory, "nested.md"), "#octui");
      await Bun.write(join(directory, "skill.md"), "PLAIN_SKILL_SNIPPET");
      const submission = {
        sessionID: "recursive",
        messageID: "recursive-message",
        prompt: { text },
        delivery: "queue",
      };
      await host.invoke("prompt", submission);
      expect(submission.prompt.text).toContain("↳ Loaded hidden");
      expect(submission.prompt.text).not.toContain("#skill(");
      expect(submission.prompt.text).not.toContain("PLAIN_SKILL_SNIPPET");
      expect(submission.prompt.text).not.toContain("DURABLE_HIDDEN_SKILL");
      for (const restart of [false, true]) {
        if (restart) await host.restart();
        await host.invoke("prompt", submission);
        const message = nativeUser(submission);
        const request = { sessionID: submission.sessionID, messages: [message] };
        await host.invoke("context", request);
        await host.invoke("context", request);
        expect(request.messages[0]).toEqual(message);
        expect(request.messages).toHaveLength(2);
        expect(request.messages[1].content[0].text).toContain('<skill_content name="hidden">');
        expect(request.messages[1].content[0].text).toContain("DURABLE_HIDDEN_SKILL");
      }
    } finally {
      await host.dispose();
    }
  });

  test.each([
    { text: "#chosen", skills: ["NATIVE_SKILL_A #chosen", "NATIVE_SKILL_B"] },
    { text: "", skills: [] },
  ])("preserves native skills and attachments around submitted '$text'", async ({
    text,
    skills,
  }) => {
    const host = await submissionFixture();
    try {
      const submission = {
        sessionID: "native",
        messageID: "native-message",
        prompt: { text },
        metadata: { unrelated: "keep" },
        delivery: "queue",
      };
      await host.invoke("prompt", submission);
      expect(submission.prompt.text).toBe(text ? "CHOSEN_TEXT" : "");
      const message = nativeUser(submission, skills);
      const expected = structuredClone(message.content);
      await host.invoke("context", { sessionID: submission.sessionID, messages: [message] });
      expect(message.content).toEqual(expected);
      expect(message.metadata?.unrelated).toBe("keep");
    } finally {
      await host.dispose();
    }
  });

  test("queued snippet injections activate only when their message enters model context", async () => {
    const host = await submissionFixture();
    try {
      const submission = {
        sessionID: "queue",
        messageID: "queued-message",
        prompt: { text: "#queued" },
        delivery: "queue",
      };
      await host.invoke("prompt", submission);
      const running = {
        sessionID: "queue",
        messages: [
          { id: "current", role: "user", content: [{ type: "text", text: "Running turn" }] },
        ],
      };
      await host.invoke("context", running);
      expect(JSON.stringify(running.messages)).not.toContain("QUEUED_INJECTION");
      const consumed = { sessionID: "queue", messages: [nativeUser(submission)] };
      await host.invoke("context", consumed);
      expect(
        consumed.messages.flatMap((message) => message.content.map((part) => part.text)),
      ).toContain("QUEUED_INJECTION");
    } finally {
      await host.dispose();
    }
  });

  test("retains hidden skills and one-shot shell output across restart with native multipart metadata", async () => {
    const host = await submissionFixture();
    try {
      const submission = {
        sessionID: "restart",
        messageID: "restart-message",
        prompt: { text: "#chosen #skill(hidden) !`printf x >> count.txt; wc -c < count.txt`" },
        delivery: "queue",
      };
      await host.invoke("prompt", submission);
      expect(submission.prompt.text).toContain("CHOSEN_TEXT");
      expect(submission.prompt.text).toContain("1");
      const persisted = nativeUser(submission, ["NATIVE_SKILL"]);
      for (const restart of [false, true]) {
        if (restart) {
          await host.restart();
          // Re-submitting retained prompt metadata must not lose hidden payloads
          // or execute the shell again, either.
          await host.invoke("prompt", submission);
        }
        const message = nativeUser(submission, ["NATIVE_SKILL"]);
        const request = { sessionID: "restart", messages: [message] };
        await host.invoke("context", request);
        expect(message.content).toEqual(persisted.content);
        expect(
          request.messages.filter((item) =>
            item.content.some((part) => part.text.includes("DURABLE_HIDDEN_SKILL")),
          ),
        ).toHaveLength(1);
        expect(await readFile(join(host.directory, "count.txt"), "utf8")).toBe("x");
      }
    } finally {
      await host.dispose();
    }
  });
});

describe("V2 request expansion", () => {
  test("chosen hashtags are replaced in submitted text as well as model context", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-snippets-v2-submission-"));
    const skillDirectory = join(directory, "skills");
    await mkdir(join(directory, ".opencode", "snippet"), { recursive: true });
    await mkdir(skillDirectory);
    await writeFile(join(directory, ".opencode", "snippet", "chosen.md"), "CHOSEN_TEXT");
    const hooks = new Map<string, (input: never) => Effect.Effect<void>>();
    const registration = Effect.succeed({ dispose: () => Effect.void });
    const context = {
      skill: { transform: () => registration },
      session: {
        get: () => Effect.succeed({ location: { directory } }),
        hook: (name: string, callback: (input: never) => Effect.Effect<void>) => {
          hooks.set(name, callback);
          return registration;
        },
      },
      tool: { hook: () => registration },
      event: { subscribe: () => Stream.empty },
    };
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            yield* setupV2SnippetsEffect(context as never, {
              directory,
              skillDirectory,
              globalDirectory: join(directory, "global"),
              homeDirectory: join(directory, "home"),
              dataDirectory: join(directory, "data"),
            });
            const submission = {
              sessionID: "submission-session",
              messageID: "submission-message",
              prompt: { text: "Please #chosen and #unknown" },
              delivery: "queue",
            };
            // OC2 submits PromptInput.text; context-only expansion cannot replace the visible submission.
            yield* hooks.get("prompt")?.(submission as never) ?? Effect.void;
            expect(submission.prompt.text).toBe("Please CHOSEN_TEXT and #unknown");
            const request = {
              sessionID: submission.sessionID,
              messages: [
                {
                  id: submission.messageID,
                  role: "user",
                  content: [{ type: "text", text: submission.prompt.text }],
                },
              ],
            };
            yield* hooks.get("context")?.(request as never) ?? Effect.void;
            expect(request.messages[0].content[0].text).toBe("Please CHOSEN_TEXT and #unknown");
            // Historical/raw messages still need the model-context fallback independently of submission.
            const historical = {
              sessionID: "history-session",
              messages: [
                {
                  id: "history-message",
                  role: "user",
                  content: [{ type: "text", text: "#chosen" }],
                },
              ],
            };
            yield* hooks.get("context")?.(historical as never) ?? Effect.void;
            expect(historical.messages[0].content[0].text).toBe("CHOSEN_TEXT");
            const shellSubmission = {
              sessionID: "shell-submission-session",
              messageID: "shell-submission-message",
              prompt: {
                text: "#chosen !`printf x >> submitted-count.txt; wc -c < submitted-count.txt`",
              },
              delivery: "queue",
            };
            yield* hooks.get("prompt")?.(shellSubmission as never) ?? Effect.void;
            expect(shellSubmission.prompt.text).toBe("CHOSEN_TEXT 1");
            const shellContext = {
              sessionID: shellSubmission.sessionID,
              messages: [
                {
                  id: shellSubmission.messageID,
                  role: "user",
                  content: [{ type: "text", text: shellSubmission.prompt.text }],
                },
              ],
            };
            yield* hooks.get("context")?.(shellContext as never) ?? Effect.void;
            expect(shellContext.messages[0].content[0].text).toBe("CHOSEN_TEXT 1");
            expect(
              yield* Effect.promise(() => readFile(join(directory, "submitted-count.txt"), "utf8")),
            ).toBe("x");
          }),
        ),
      );
      // A restarted server sees the persisted, already-expanded text, not the original hashtag.
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            yield* setupV2SnippetsEffect(context as never, {
              directory,
              skillDirectory,
              globalDirectory: join(directory, "global"),
              homeDirectory: join(directory, "home"),
              dataDirectory: join(directory, "data"),
            });
            const restored = {
              sessionID: "submission-session",
              messages: [
                {
                  id: "submission-message",
                  role: "user",
                  content: [{ type: "text", text: "Please CHOSEN_TEXT and #unknown" }],
                },
              ],
            };
            yield* hooks.get("context")?.(restored as never) ?? Effect.void;
            expect(restored.messages[0].content[0].text).toBe("Please CHOSEN_TEXT and #unknown");
          }),
        ),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("expands the latest AI SDK user message in place", async () => {
    const messages = [
      { role: "user", content: "old #proof" },
      { role: "assistant", content: "reply" },
      { role: "user", content: [{ type: "text", text: "new #proof" }] },
    ];

    expect(await expandRequestMessages(messages, snippets)).toBe(true);
    expect(messages[0].content).toBe("old #proof");
    expect(messages[2].content).toEqual([
      { type: "text", text: "new EXPANDED_BY_V2_REQUEST_HOOK" },
    ]);
  });

  test("supports the V2 schema user text shape", async () => {
    const messages = [{ type: "user", text: "#proof" }];

    expect(await expandRequestMessages(messages, snippets)).toBe(true);
    expect(messages[0].text).toBe("EXPANDED_BY_V2_REQUEST_HOOK");
  });

  test("leaves non-user messages unchanged", async () => {
    const messages = [{ role: "system", content: "#proof" }];

    expect(await expandRequestMessages(messages, snippets)).toBe(false);
    expect(messages[0].content).toBe("#proof");
  });

  test("expands shell substitutions after snippets", async () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "#proof !`printf _SHELL`" }] },
    ];
    expect(await expandRequestMessages(messages, snippets)).toBe(true);
    expect(messages[0].content[0].text).toBe("EXPANDED_BY_V2_REQUEST_HOOK _SHELL");
  });

  test("registers the native skill, context, and tool hooks and expands context", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-snippets-v2-native-"));
    const snippetDirectory = join(directory, ".opencode", "snippet");
    const skillDirectory = join(directory, "skill", "snippets");
    await mkdir(snippetDirectory, { recursive: true });
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(join(snippetDirectory, "proof.md"), "native V2 expansion");
    await writeFile(
      join(skillDirectory, "SKILL.md"),
      "---\nname: snippets\ndescription: test\n---\ntest",
    );

    let source: unknown;
    let contextHook: ((request: Record<string, unknown>) => Promise<void>) | undefined;
    let toolHook: ((event: Record<string, unknown>) => Promise<void>) | undefined;
    let disposed = 0;
    const registration = { dispose: async () => void disposed++ };
    const context = {
      skill: {
        transform: async (callback: (draft: { add: (value: unknown) => void }) => void) => {
          callback({
            add: (value) => {
              source = value;
            },
          });
          return registration;
        },
      },
      session: {
        get: async () => ({ location: { directory } }),
        hook: async (_name: string, callback: typeof contextHook) => {
          contextHook = callback;
          return registration;
        },
      },
      tool: {
        hook: async (_name: string, callback: typeof toolHook) => {
          toolHook = callback;
          return registration;
        },
      },
      event: {
        subscribe: () => ({
          async *[Symbol.asyncIterator]() {
            await new Promise(() => {});
          },
        }),
      },
    } as unknown as Plugin.Context;

    try {
      const cleanup = await setupV2Snippets(context, {
        directory,
        globalDirectory: join(directory, "global-snippets"),
        homeDirectory: join(directory, "home"),
        skillDirectory,
      });
      const request = {
        sessionID: "session-test",
        messages: [{ role: "user", content: [{ type: "text", text: "use #proof" }] }],
      };
      await contextHook?.(request);

      expect(source).toMatchObject({
        id: "snippets",
        path: join(skillDirectory, "SKILL.md"),
        name: "snippets",
      });
      expect(request.messages[0].content[0].text).toBe("use native V2 expansion");
      expect(toolHook).toBeFunction();
      await cleanup();
      expect(disposed).toBe(4);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("runs shell substitutions and management commands once across request rebuilding", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-snippets-v2-once-"));
    const snippetDirectory = join(directory, ".opencode", "snippet");
    const skillDirectory = join(directory, "skill", "snippets");
    await mkdir(snippetDirectory, { recursive: true });
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(join(snippetDirectory, "delete-me.md"), "temporary");
    await writeFile(join(snippetDirectory, "replay.md"), "EXPANDED");

    let contextHook: ((request: Record<string, unknown>) => Promise<void>) | undefined;
    const registration = { dispose: async () => {} };
    const context = {
      skill: { transform: async () => registration },
      session: {
        get: async () => ({ location: { directory } }),
        hook: async (_name: string, callback: typeof contextHook) => {
          contextHook = callback;
          return registration;
        },
      },
      tool: { hook: async () => registration },
      event: {
        subscribe: () => ({
          async *[Symbol.asyncIterator]() {
            await new Promise(() => {});
          },
        }),
      },
    } as unknown as Plugin.Context;

    try {
      const cleanup = await setupV2Snippets(context, {
        directory,
        globalDirectory: join(directory, "global-snippets"),
        homeDirectory: join(directory, "home"),
        skillDirectory,
      });
      const rawShell = "!`printf x >> count.txt; wc -c < count.txt`";
      const buildShellRequest = () => ({
        sessionID: "shell-session",
        messages: [
          { id: "shell-message", role: "user", content: [{ type: "text", text: rawShell }] },
        ],
      });
      const firstShell = buildShellRequest();
      const rebuiltShell = buildShellRequest();
      await contextHook?.(firstShell);
      await contextHook?.(rebuiltShell);
      expect(firstShell.messages[0].content[0].text).toBe("1");
      expect(rebuiltShell.messages[0].content[0].text).toBe("1");
      expect(await Bun.file(join(directory, "count.txt")).text()).toBe("x");

      const idlessShell = "!`printf y >> idless.txt; wc -c < idless.txt`";
      const idlessRequest = {
        sessionID: "shell-session",
        messages: [{ role: "user", content: [{ type: "text", text: idlessShell }] }],
      };
      await contextHook?.(idlessRequest);
      expect(idlessRequest.messages[0].content[0].text).toBe("1");
      await contextHook?.(idlessRequest);
      expect(idlessRequest.messages[0].content[0].text).toBe("1");
      expect(await Bun.file(join(directory, "idless.txt")).text()).toBe("y");

      const buildDurableHistory = (includeNew: boolean) => ({
        sessionID: "durable-session",
        messages: [
          {
            id: "durable-old",
            role: "user",
            content: [
              { type: "text", text: "!`printf a >> durable-old.txt; wc -c < durable-old.txt`" },
            ],
          },
          { id: "reply", role: "assistant", content: [{ type: "text", text: "ok" }] },
          ...(includeNew
            ? [
                {
                  id: "durable-new",
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: "!`printf b >> durable-new.txt; wc -c < durable-new.txt`",
                    },
                  ],
                },
              ]
            : []),
        ],
      });
      const firstHistory = buildDurableHistory(false);
      const rebuiltHistory = buildDurableHistory(true);
      await contextHook?.(firstHistory);
      await contextHook?.(rebuiltHistory);
      const rebuiltAgain = buildDurableHistory(true);
      await contextHook?.(rebuiltAgain);
      expect(firstHistory.messages[0].content[0].text).toBe("1");
      expect(rebuiltHistory.messages[0].content[0].text).toBe("1");
      expect(rebuiltHistory.messages[2].content[0].text).toBe("1");
      expect(rebuiltAgain.messages[0].content[0].text).toBe("1");
      expect(rebuiltAgain.messages[2].content[0].text).toBe("1");
      expect(await Bun.file(join(directory, "durable-old.txt")).text()).toBe("a");
      expect(await Bun.file(join(directory, "durable-new.txt")).text()).toBe("b");

      const replayHistory = {
        sessionID: "replay-session",
        messages: [
          { id: "replay-1", role: "user", content: [{ type: "text", text: "one #replay" }] },
        ],
      };
      await contextHook?.(replayHistory);
      expect(replayHistory.messages[0].content[0].text).toBe("one EXPANDED");
      const rebuiltReplayHistory = {
        sessionID: "replay-session",
        messages: [
          { id: "replay-1", role: "user", content: [{ type: "text", text: "one #replay" }] },
          { id: "replay-2", role: "user", content: [{ type: "text", text: "two #replay" }] },
          { id: "replay-3", role: "user", content: [{ type: "text", text: "three #replay" }] },
        ],
      };
      await contextHook?.(rebuiltReplayHistory);
      expect(rebuiltReplayHistory.messages.map((message) => message.content[0].text)).toEqual([
        "one EXPANDED",
        "two EXPANDED",
        "three EXPANDED",
      ]);

      const buildCommandRequest = () => ({
        sessionID: "command-session",
        messages: [
          {
            id: "command-message",
            role: "user",
            content: [{ type: "text", text: "/snippets delete delete-me" }],
          },
        ],
      });
      const firstCommand = buildCommandRequest();
      const rebuiltCommand = buildCommandRequest();
      await contextHook?.(firstCommand);
      await contextHook?.(rebuiltCommand);
      expect(firstCommand.messages[0].content[0].text).toContain("Deleted snippet #delete-me");
      expect(rebuiltCommand.messages[0].content[0].text).toBe(
        firstCommand.messages[0].content[0].text,
      );
      const globalCommand = {
        sessionID: "global-command-session",
        messages: [
          {
            id: "global-command-message",
            role: "user",
            content: [{ type: "text", text: '/snippets add isolated "GLOBAL_ONLY"' }],
          },
        ],
      };
      await contextHook?.(globalCommand);
      expect(await readFile(join(directory, "global-snippets", "isolated.md"), "utf8")).toBe(
        "GLOBAL_ONLY",
      );
      await cleanup();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("uses project-scoped registries for sessions served by one plugin instance", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-snippets-v2-projects-"));
    const projectA = join(root, "a");
    const projectB = join(root, "b");
    const skillDirectory = join(root, "skill", "snippets");
    for (const [directory, content] of [
      [projectA, "PROJECT_A"],
      [projectB, "PROJECT_B"],
    ]) {
      const snippetsDir = join(directory, ".opencode", "snippet");
      await mkdir(snippetsDir, { recursive: true });
      await writeFile(join(snippetsDir, "proof.md"), content);
    }
    await mkdir(skillDirectory, { recursive: true });

    let contextHook: ((request: Record<string, unknown>) => Promise<void>) | undefined;
    const registration = { dispose: async () => {} };
    const context = {
      skill: { transform: async () => registration },
      session: {
        get: async ({ sessionID }: { sessionID: string }) => ({
          location: { directory: sessionID === "a" ? projectA : projectB },
        }),
        hook: async (_name: string, callback: typeof contextHook) => {
          contextHook = callback;
          return registration;
        },
      },
      tool: { hook: async () => registration },
      event: {
        subscribe: () => ({
          async *[Symbol.asyncIterator]() {
            await new Promise(() => {});
          },
        }),
      },
    } as unknown as Plugin.Context;

    try {
      const cleanup = await setupV2Snippets(context, {
        globalDirectory: join(root, "global-snippets"),
        homeDirectory: join(root, "home"),
        skillDirectory,
      });
      const requestA = {
        sessionID: "a",
        messages: [{ id: "a1", role: "user", content: [{ type: "text", text: "#proof" }] }],
      };
      const requestB = {
        sessionID: "b",
        messages: [{ id: "b1", role: "user", content: [{ type: "text", text: "#proof" }] }],
      };
      await contextHook?.(requestA);
      await contextHook?.(requestB);
      expect(requestA.messages[0].content[0].text).toBe("PROJECT_A");
      expect(requestB.messages[0].content[0].text).toBe("PROJECT_B");
      await cleanup();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("accumulates and deduplicates injections, then clears session state on deletion", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-snippets-v2-inject-"));
    const snippetDirectory = join(directory, ".opencode", "snippet");
    const skillDirectory = join(directory, "skill", "snippets");
    await mkdir(snippetDirectory, { recursive: true });
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(
      join(snippetDirectory, "config.jsonc"),
      '{"experimental":{"injectBlocks":true}}',
    );
    await writeFile(join(snippetDirectory, "a.md"), "<inject>INJECT_A</inject>");
    await writeFile(join(snippetDirectory, "b.md"), "<inject>INJECT_B</inject>");

    let contextHook: ((request: Record<string, unknown>) => Promise<void>) | undefined;
    let deleteSession: ((event: unknown) => void) | undefined;
    const registration = { dispose: async () => {} };
    const context = {
      skill: { transform: async () => registration },
      session: {
        get: async () => ({ location: { directory } }),
        hook: async (_name: string, callback: typeof contextHook) => {
          contextHook = callback;
          return registration;
        },
      },
      tool: { hook: async () => registration },
      event: {
        subscribe: () => ({
          async *[Symbol.asyncIterator]() {
            const event = await new Promise((resolve) => {
              deleteSession = resolve;
            });
            yield event;
            await new Promise(() => {});
          },
        }),
      },
    } as unknown as Plugin.Context;

    try {
      const cleanup = await setupV2Snippets(context, {
        directory,
        globalDirectory: join(directory, "global-snippets"),
        homeDirectory: join(directory, "home"),
        skillDirectory,
      });
      await Bun.sleep(0);
      const build = (latest: string, id: string) => ({
        sessionID: "inject-session",
        messages: [
          { id: "m1", role: "user", content: [{ type: "text", text: "#a" }] },
          ...(id === "m1" ? [] : [{ id, role: "user", content: [{ type: "text", text: latest }] }]),
        ],
      });
      await contextHook?.(build("#a", "m1"));
      const both = build("#b", "m2");
      await contextHook?.(both);
      const rebuilt = build("#b", "m2");
      await contextHook?.(rebuilt);
      const injections = rebuilt.messages.filter(
        (message) => message.metadata?.["opencode-snippets:generated"] === "injection",
      );
      expect(injections.map((message) => message.content[0].text).sort()).toEqual([
        "INJECT_A",
        "INJECT_B",
      ]);
      const durableStore = new DurableStore(directory, {
        homeDirectory: join(directory, "home"),
      });
      expect(
        Object.keys(JSON.parse(await readFile(durableStore.path, "utf8")).sessions),
      ).toHaveLength(1);

      deleteSession?.({ type: "session.deleted", data: { sessionID: "inject-session" } });
      for (let attempt = 0; attempt < 50; attempt++) {
        if (
          Object.keys(JSON.parse(await readFile(durableStore.path, "utf8")).sessions).length === 0
        )
          break;
        await Bun.sleep(10);
      }
      expect(JSON.parse(await readFile(durableStore.path, "utf8")).sessions).toEqual({});
      const afterDeletion = {
        sessionID: "inject-session",
        messages: [{ id: "fresh", role: "user", content: [{ type: "text", text: "nothing" }] }],
      };
      await contextHook?.(afterDeletion);
      expect(
        afterDeletion.messages.some(
          (message) => message.metadata?.["opencode-snippets:generated"] === "injection",
        ),
      ).toBe(false);
      await cleanup();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("the exported Effect adapter prunes durable state from the real deletion stream", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-snippets-v2-effect-delete-"));
    const snippetDirectory = join(directory, ".opencode", "snippet");
    const skillDirectory = join(directory, "skill", "snippets");
    await mkdir(snippetDirectory, { recursive: true });
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(join(snippetDirectory, "proof.md"), "EFFECT_EXPANDED");

    try {
      const events = await Effect.runPromise(Queue.unbounded<unknown>());
      let contextHook: ((request: never) => Effect.Effect<void>) | undefined;
      const registration = { dispose: () => Effect.void };
      const context = {
        options: {},
        skill: {
          transform: (callback: (draft: { add: (value: unknown) => void }) => void) => {
            callback({ add: () => undefined });
            return Effect.succeed(registration);
          },
        },
        session: {
          get: () => Effect.succeed({ location: { directory } }),
          hook: (_name: string, callback: typeof contextHook) => {
            contextHook = callback;
            return Effect.succeed(registration);
          },
        },
        tool: { hook: () => Effect.succeed(registration) },
        event: { subscribe: () => Stream.fromQueue(events) },
      };

      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            yield* setupV2SnippetsEffect(context as never, {
              directory,
              globalDirectory: join(directory, "global-snippets"),
              homeDirectory: join(directory, "home"),
              skillDirectory,
            });
            const request = {
              sessionID: "effect-session",
              messages: [
                { id: "effect-message", role: "user", content: [{ type: "text", text: "#proof" }] },
              ],
            };
            yield* contextHook?.(request as never) ?? Effect.void;
            expect(request.messages[0].content[0].text).toBe("EFFECT_EXPANDED");

            const store = new DurableStore(directory, {
              homeDirectory: join(directory, "home"),
            });
            expect(
              Object.keys(
                JSON.parse(yield* Effect.promise(() => readFile(store.path, "utf8"))).sessions,
              ),
            ).toHaveLength(1);
            yield* Queue.offer(events, {
              type: "session.deleted",
              data: { sessionID: "effect-session" },
              location: { directory },
            });
            for (let attempt = 0; attempt < 50; attempt++) {
              const state = JSON.parse(yield* Effect.promise(() => readFile(store.path, "utf8")));
              if (Object.keys(state.sessions).length === 0) break;
              yield* Effect.sleep("10 millis");
            }
            expect(
              JSON.parse(yield* Effect.promise(() => readFile(store.path, "utf8"))).sessions,
            ).toEqual({});
          }),
        ),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("clears memory after a failed deletion and continues with a later successful deletion", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-snippets-v2-delete-resilience-"));
    const snippetDirectory = join(directory, ".opencode", "snippet");
    const skillDirectory = join(directory, "skill", "snippets");
    const homeDirectory = join(directory, "home");
    await mkdir(snippetDirectory, { recursive: true });
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(
      join(snippetDirectory, "config.jsonc"),
      '{"experimental":{"injectBlocks":true}}',
    );
    await writeFile(join(snippetDirectory, "inject.md"), "<inject>ACTIVE</inject>");

    const queued: { event: unknown; done: () => void }[] = [];
    let wake: (() => void) | undefined;
    const emit = (event: unknown) => {
      const handled = new Promise<void>((done) => queued.push({ event, done }));
      wake?.();
      wake = undefined;
      return handled;
    };
    let contextHook: ((request: Record<string, unknown>) => Promise<void>) | undefined;
    const registration = { dispose: async () => {} };
    const context = {
      skill: { transform: async () => registration },
      session: {
        get: async () => ({ location: { directory } }),
        hook: async (_name: string, callback: typeof contextHook) => {
          contextHook = callback;
          return registration;
        },
      },
      tool: { hook: async () => registration },
      event: {
        subscribe: ({ signal }: { signal: AbortSignal }) => ({
          async *[Symbol.asyncIterator]() {
            while (!signal.aborted) {
              if (queued.length === 0) {
                await new Promise<void>((resolve) => {
                  wake = resolve;
                  signal.addEventListener("abort", resolve, { once: true });
                });
              }
              if (signal.aborted) return;
              const event = queued.shift();
              if (event) {
                yield event.event;
                event.done();
              }
            }
          },
        }),
      },
    } as unknown as Plugin.Context;

    try {
      const cleanup = await setupV2Snippets(context, {
        directory,
        globalDirectory: join(directory, "global-snippets"),
        homeDirectory,
        skillDirectory,
      });
      const activate = async (sessionID: string, id: string) => {
        await contextHook?.({
          sessionID,
          messages: [{ id, role: "user", content: [{ type: "text", text: "#inject" }] }],
        });
      };
      await activate("failed-session", "failed-message");
      const store = new DurableStore(directory, { homeDirectory });
      const dataBackup = `${store.directory}.backup`;
      await Bun.sleep(0);
      await Bun.file(store.path).exists();
      await import("node:fs/promises").then(({ rename }) => rename(store.directory, dataBackup));
      await writeFile(store.directory, "blocks durable cleanup");
      const deletion = emit({ type: "session.deleted", data: { sessionID: "failed-session" } });

      let cleared = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        const request = {
          sessionID: "failed-session",
          messages: [{ role: "assistant", content: [{ type: "text", text: "observe" }] }],
        };
        await contextHook?.(request);
        cleared = !request.messages.some(
          (message) => message.metadata?.["opencode-snippets:generated"] === "injection",
        );
        if (cleared) break;
        await Bun.sleep(10);
      }
      expect(cleared).toBe(true);

      // Memory clears before filesystem cleanup settles. Keep the failure in
      // place until the event consumer finishes handling the deletion.
      await deletion;
      await rm(store.directory, { force: true });
      await import("node:fs/promises").then(({ rename }) => rename(dataBackup, store.directory));
      await activate("successful-session", "successful-message");
      await emit({ type: "session.deleted", data: { sessionID: "successful-session" } });
      expect(Object.keys(JSON.parse(await readFile(store.path, "utf8")).sessions)).toHaveLength(1);
      await cleanup();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
