import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { text, withFixture } from "./v2-runtime.fixture";

describe.skipIf(process.env.SNIPPETS_TEST_V2 !== "1")("snippet forms in OpenCode V2", () => {
  test("malformed historical JSON cannot block a new prompt after restart", async () => {
    await withFixture(async (host) => {
      // Seed a pre-plugin message with no submitted metadata, as in migrated history.
      const path = join(host.root, "config/opencode/opencode.json");
      const config = await Bun.file(path).json();
      await Bun.write(path, JSON.stringify({ ...config, plugins: [] }));
      const malformed = '#generate-prompt(extra="first line\nsecond line")';
      const old = await host.submit(malformed);
      await host.write(
        "generate-prompt",
        "---\nfields:\n  extra: {type: textarea}\n---\n{{extra}} !`printf BAD >> malformed-effect`",
      );
      await Bun.write(path, JSON.stringify(config));
      await host.verify();
      for (const prompt of ["continue #chosen", "another turn"]) {
        const result = await host.submit(prompt, { session: old.session });
        expect(result.calls.at(-1)?.messages.some((message) => text(message) === malformed)).toBe(
          true,
        );
        expect(result.user.text).toBe(prompt.replace("#chosen", "PROJECT_CHOSEN"));
      }
      const fresh = await host.submit(malformed, { session: old.session });
      expect(fresh.user.text).toBe(malformed);
      expect(await Bun.file(join(host.directory, "malformed-effect")).exists()).toBe(false);
    });
  }, 120_000);

  test("invalid snippets allow continued conversation and corrected new submissions", async () => {
    await withFixture(async (host) => {
      const expectRetryable = async () => {
        // Prompt retries receive new host message IDs. Inspect the isolated
        // fixture state as well, so a poisoned earlier key cannot go unnoticed.
        for await (const path of new Bun.Glob("**/opencode-snippets/v2/*.json").scan({
          cwd: host.root,
          absolute: true,
          dot: true,
        })) {
          expect(JSON.stringify(await Bun.file(path).json())).not.toContain('"status":"pending"');
        }
      };
      const native = await host.start();
      const session = await native
        .request<{ data: { id: string } }>("/api/session", {
          location: { directory: host.directory },
          model: { providerID: "fixture", id: "fixture" },
        })
        .then((value) => value.data.id);
      await native.stop();
      await host.write("retry", "Old definition");
      const prompt = "#retry(reviewers=3)";
      expect((await host.submit(prompt, { session })).user.text).toBe(prompt);
      await expectRetryable();
      expect((await host.submit("continue", { session })).user.text).toBe("continue");
      await host.write(
        "retry",
        '---\nfields:\n  reviewers:\n    type: number\n---\n{{reviewers}} {{skill "missing"}} !`printf x >> retry-runs.txt`',
      );
      expect((await host.submit(prompt, { session })).user.text).toBe(prompt);
      await expectRetryable();
      expect(await Bun.file(join(host.directory, "retry-runs.txt")).exists()).toBe(false);
      await host.write(
        "retry",
        '---\nfields:\n  reviewers:\n    type: number\n---\n{{reviewers}} {{skill "local"}} !`printf x >> retry-runs.txt`',
      );
      const corrected = await host.submit(prompt, { session });
      expect(corrected.user.text).toContain("3 LOCAL_BODY");
      expect(await Bun.file(join(host.directory, "retry-runs.txt")).text()).toBe("x");
      await host.submit("continue", { session });
      expect(await Bun.file(join(host.directory, "retry-runs.txt")).text()).toBe("x");
    });
  }, 120_000);
  test("persists literal field answers and restores them without repeating effects", async () => {
    await withFixture(async (host) => {
      await host.write(
        "form",
        [
          "---",
          "fields:",
          "  prompt: {type: textarea, required: true}",
          "  limit: {type: number, default: 3, integer: true, min: 0}",
          "  goal: {type: checkbox, default: false}",
          "---",
          "{{prompt}}",
          "<append>Limit={{limit}}; Goal={{goal}}; Echo={{prompt}}</append>",
          "!`printf x >> form-runs.txt; printf FORM_EFFECT`",
        ].join("\n"),
      );
      const answer =
        '第一行 👩‍💻\n"quoted", (parentheses) #chosen #skill(local) <skill name="local" /> {{field "fake"}} <inject>ANSWER_ONLY</inject> !`printf BAD >> answer-ran.txt` & <html>';
      const first = await host.submit(`#form(prompt=${JSON.stringify(answer)}, limit=0, goal=no)`);
      expect(first.user.text).toContain(answer);
      expect(first.user.text).toContain("Limit=0; Goal=no");
      expect(first.user.text).toContain(`Echo=${answer}`);
      expect(first.user.text).toContain("FORM_EFFECT");
      expect(first.user.metadata?.["opencode-snippets:submitted"].hidden).toEqual([]);
      expect(first.user.metadata?.["opencode-snippets:submitted"].injections).toEqual([]);
      expect(first.calls.at(-1)?.messages.some((message) => text(message).includes(answer))).toBe(
        true,
      );
      expect(await Bun.file(join(host.directory, "answer-ran.txt")).exists()).toBe(false);
      expect(await Bun.file(join(host.directory, "form-runs.txt")).text()).toBe("x");

      await host.write("form", "DEFINITION_CHANGED");
      const resumed = await host.submit("continue", { session: first.session });
      expect(resumed.calls.at(-1)?.messages.some((message) => text(message).includes(answer))).toBe(
        true,
      );
      expect(JSON.stringify(resumed.calls)).not.toContain("DEFINITION_CHANGED");
      expect(await Bun.file(join(host.directory, "form-runs.txt")).text()).toBe("x");
    });
  }, 120_000);

  test("invalid invocations reach the model literally without shell effects", async () => {
    await withFixture(async (host) => {
      await host.write(
        "bounded",
        "---\nfields:\n  count: {type: number, integer: true, min: 0, max: 3, required: true}\n---\n{{count}} !`printf BAD >> invalid-ran.txt`",
      );
      for (const invocation of [
        "#bounded",
        "#bounded(count=4)",
        "#bounded(count=1.5)",
        '#bounded(count="2")',
        "#bounded(count=2, typo=yes)",
        "#bounded(count=2) #bounded(count=4)",
      ]) {
        const result = await host.submit(invocation);
        expect(result.user.text).toBe(invocation);
        expect(result.calls.at(-1)?.messages.some((message) => text(message) === invocation)).toBe(
          true,
        );
        expect(await Bun.file(join(host.directory, "invalid-ran.txt")).exists()).toBe(false);
      }
    });
  }, 120_000);

  test("keeps independent values and nested presets through the real prompt hook", async () => {
    await withFixture(async (host) => {
      await host.write(
        "words",
        '---\nfields:\n  count: {type: number, default: 1, integer: true, min: 0}\n  label: {default: base}\n---\n{{#if count}}{{label}}: {{count}} {{plural count "item" "items"}}{{/if}}',
      );
      await host.write("three", '#words(count=3, label="preset")');
      const result = await host.submit(
        '#three(count=1, label="first") | #three(label="second") | #words(count=0)',
      );
      expect(result.user.text).toBe("first: 1 item | second: 3 items | ");
      expect(
        result.calls.at(-1)?.messages.some((message) => text(message) === result.user.text),
      ).toBe(true);
    });
  }, 120_000);

  test("supports inline Handlebars skills alongside hidden skill loading", async () => {
    await withFixture(async (host) => {
      await host.write("inline", 'Inline: {{skill "local"}}');
      await host.write("hidden", "#skill(local)");
      const result = await host.submit("#inline #hidden");
      expect(result.user.text).toContain("Inline: LOCAL_BODY");
      expect(result.user.text).toContain("↳ Loaded local");
      const hidden = result.calls
        .at(-1)
        ?.messages.filter((message) => text(message).includes('<skill_content name="local">'));
      expect(hidden).toHaveLength(1);
    });
  }, 120_000);

  test("frontmatter is authoritative and unrelated legacy placeholders stay literal", async () => {
    await withFixture(async (host) => {
      await host.write("legacy", "Keep {{session_id}} for the next agent.");
      await host.write(
        "declared",
        "---\nfields:\n  enabled: {type: checkbox, default: true}\n---\n{{#if enabled}}ENABLED{{/if}} #legacy",
      );
      const result = await host.submit("#declared");
      expect(result.user.text).toBe("ENABLED Keep {{session_id}} for the next agent.");
      expect(
        result.calls.at(-1)?.messages.some((message) => text(message) === result.user.text),
      ).toBe(true);
      await host.write(
        "invalid-schema",
        "---\nfields:\n  value: {render: false}\n---\n!`printf BAD >> schema-ran.txt`",
      );
      expect((await host.submit("#invalid-schema")).user.text).toBe("#invalid-schema");
      expect(await Bun.file(join(host.directory, "schema-ran.txt")).exists()).toBe(false);
    });
  }, 120_000);
});
