import { describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { text, withFixture } from "./v2-runtime.fixture";

// Real host tests are opt-in: they need the installed CLI and a built distribution.
// They capture provider requests rather than inferring hidden context from metadata.
describe.skipIf(process.env.SNIPPETS_TEST_V2 !== "1")("OpenCode 2 runtime", () => {
  test(
    "runs single-token CLI prompts and resumes their session",
    () =>
      withFixture(async (host) => {
        const first = await host.run("#nested");
        expect(first.user.text).toBe("PROJECT_CHOSEN");
        const second = await host.run("#skill(local)", { session: first.session });
        expect(second.user.text).toBe("↳ Loaded local");
        expect(second.session).toBe(first.session);
        expect(
          second.calls.at(-1)?.messages.some((message) => text(message).includes("LOCAL_BODY")),
        ).toBe(true);
      }),
    120_000,
  );

  test(
    "records CLI argument quoting independently of the snippets plugin",
    () =>
      withFixture(async (host) => {
        const prompt = "PLAIN WORDS";
        const installed = await host.run(prompt);
        // OC2 run serializes a multiword argv entry as a quoted string. Keep this
        // control explicit so CLI quoting is not mistaken for prompt-hook behavior.
        expect(installed.user.text).toBe(JSON.stringify(prompt));
        const path = join(host.root, "config", "opencode", "opencode.json");
        const config = await Bun.file(path).json();
        config.plugins = [];
        await Bun.write(path, JSON.stringify(config));
        const control = await host.run(prompt);
        expect(control.user.text).toBe(installed.user.text);
      }),
    120_000,
  );

  test(
    "records CLI text-file inlining before the prompt hook",
    () =>
      withFixture(async (host) => {
        const file = join(host.directory, "cli.txt");
        await Bun.write(file, "CLI_ATTACHMENT #chosen");
        const result = await host.run("#chosen", { file });
        expect(result.user.files).toHaveLength(0);
        expect(result.user.text).toContain('<file name="cli.txt">');
        expect(result.user.text).toContain("CLI_ATTACHMENT PROJECT_CHOSEN");
        expect(
          result.calls
            .at(-1)
            ?.messages.some((message) => text(message).includes("CLI_ATTACHMENT PROJECT_CHOSEN")),
        ).toBe(true);
      }),
    120_000,
  );

  test(
    "cancels queued input without activating its hidden skills or injections",
    () =>
      withFixture(async (host) => {
        const native = await host.start();
        try {
          const session = (
            await native.request<{ data: { id: string } }>("/api/session", {
              location: { directory: host.directory },
            })
          ).data.id;
          const queued = await native.request<{ data: { id: string } }>(
            `/api/session/${session}/prompt`,
            {
              text: "#persist #skill(local)",
              delivery: "queue",
              resume: false,
            },
          );
          expect(host.requests).toHaveLength(0);
          await native.request(
            `/api/session/${session}/inbox/${queued.data.id}`,
            undefined,
            "DELETE",
          );
          await native.request(`/api/session/${session}/prompt`, { text: "ACTIVE #chosen" });
          await native.request(`/api/session/${session}/wait`, {});
          const call = host.requests.findLast((request) => request.tools?.length);
          expect(call).toBeDefined();
          expect(JSON.stringify(call)).not.toContain("PERSISTENT_CONTEXT");
          expect(
            call?.messages.some((message) =>
              text(message).includes('<skill_content name="local">'),
            ),
          ).toBe(false);
          expect(call?.messages.some((message) => text(message) === "ACTIVE PROJECT_CHOSEN")).toBe(
            true,
          );
        } finally {
          await native.stop();
        }
      }),
    120_000,
  );

  test(
    "persists Unicode, escaped references, aliases and native skill loads",
    () =>
      withFixture(async (host) => {
        await host.verify();
        const result = await host.submit('👩‍💻 #nested #_chosen #unknown #skill("host:proof")');
        expect(result.user.text).toBe("👩‍💻 PROJECT_CHOSEN #_chosen #unknown ↳ Loaded Host proof");
        expect(result.user.text).not.toContain("HOST_BODY");
        const messages = result.calls.at(-1)?.messages ?? [];
        const visible = messages.findIndex(
          (message) => message.role === "user" && text(message) === result.user.text,
        );
        expect(visible).toBeGreaterThanOrEqual(0);
        expect(text(messages[visible + 1])).toContain('<skill_content name="Host proof">');
        expect(text(messages[visible + 1])).toContain("HOST_BODY #chosen");
        expect(JSON.stringify(messages)).not.toContain("DISK_BODY_MUST_NOT_LOAD");
        expect(result.user.metadata?.["opencode-snippets:submitted"].hidden).toHaveLength(1);
      }),
    120_000,
  );

  test(
    "keeps attached text literal beside an expanded prompt and hidden skill",
    () =>
      withFixture(async (host) => {
        const file = join(host.directory, "notes.txt");
        const attachment = "ATTACHED #chosen #skill(local) !`printf x >> attachment-ran.txt`";
        await Bun.write(file, attachment);
        const result = await host.submit("#chosen #skill(local)", { file, skills: ["host:proof"] });
        expect(result.user.text).toBe("PROJECT_CHOSEN ↳ Loaded local");
        expect(result.user.files).toHaveLength(1);
        const messages = result.calls.at(-1)?.messages ?? [];
        expect(messages.some((message) => text(message).includes(attachment))).toBe(true);
        expect(messages.some((message) => text(message).includes("HOST_BODY #chosen"))).toBe(true);
        expect(
          messages.filter((message) => text(message).includes('<skill_content name="local">')),
        ).toHaveLength(1);
        expect(await Bun.file(join(host.directory, "attachment-ran.txt")).exists()).toBe(false);
      }),
    120_000,
  );

  test(
    "accepts an attachment-only submission without expanding its contents",
    () =>
      withFixture(async (host) => {
        const file = join(host.directory, "only.txt");
        const attachment = "ATTACHMENT_ONLY #chosen #skill(local)";
        await Bun.write(file, attachment);
        const result = await host.submit("", { file });
        expect(result.user.text).toBe("");
        expect(result.user.files).toHaveLength(1);
        const messages = result.calls.at(-1)?.messages ?? [];
        expect(messages.some((message) => text(message).includes(attachment))).toBe(true);
        expect(
          messages.some((message) => text(message).includes('<skill_content name="local">')),
        ).toBe(false);
      }),
    120_000,
  );

  test(
    "restores context across process restart and fork without replaying shell commands",
    () =>
      withFixture(async (host) => {
        const first = await host.submit("#once #skill(local) #persist");
        expect(first.user.text).toBe("SHELL_PROOF ↳ Loaded local VISIBLE_PERSIST");
        await host.write("once", "CHANGED_SHELL_SNIPPET");
        await Bun.write(
          join(host.directory, ".opencode", "skills", "local", "SKILL.md"),
          "---\nname: local\ndescription: Edited fixture\n---\nCHANGED_SKILL_BODY",
        );
        const resumed = await host.submit("RESUMED #chosen", { session: first.session });
        const forked = await host.submit("FORKED #chosen", { session: first.session, fork: true });
        expect(resumed.session).toBe(first.session);
        expect(forked.session).not.toBe(first.session);
        for (const result of [first, resumed, forked]) {
          const messages = result.calls.at(-1)?.messages ?? [];
          expect(
            messages.filter((message) => text(message).includes('<skill_content name="local">')),
          ).toHaveLength(1);
          // The host may append system-update text to the same user message.
          expect(
            messages.filter((message) => text(message).includes("PERSISTENT_CONTEXT")),
          ).toHaveLength(1);
          expect(JSON.stringify(messages)).toContain("LOCAL_BODY #chosen");
          expect(JSON.stringify(messages)).not.toContain("CHANGED_SKILL_BODY");
          expect(await Bun.file(join(host.directory, "count.txt")).text()).toBe("x");
        }
        expect(forked.saved.messages.filter((message) => message.type === "user")).toHaveLength(3);
        const original = await host.exported(first.session);
        expect(original.messages.filter((message) => message.type === "user")).toHaveLength(2);
        expect(JSON.stringify(original)).not.toContain("FORKED");
      }),
    120_000,
  );

  test(
    "runs management commands once and expands aliases only when submitted",
    () =>
      withFixture(async (host) => {
        const added = await host.submit(
          '/snippets add made "#chosen !`printf x >> command-ran.txt`" --project --aliases mk',
        );
        expect(added.user.text).toContain("Added project snippet #made");
        expect(await Bun.file(join(host.directory, "command-ran.txt")).exists()).toBe(false);
        const listed = await host.submit("/snippets list");
        expect(listed.user.text).toContain("#made (aliases: mk)");
        expect(listed.user.text).toContain("#chosen !`printf x >> command-ran.txt`");
        expect(await Bun.file(join(host.directory, "command-ran.txt")).exists()).toBe(false);
        const reloaded = await host.submit("/snippets:reload");
        expect(reloaded.user.text).toMatch(/\nReloaded \d+ snippets\.$/);
        const expanded = await host.submit("#mk");
        expect(expanded.user.text).toContain("PROJECT_CHOSEN");
        expect(await Bun.file(join(host.directory, "command-ran.txt")).text()).toBe("x");
        await host.write("made", "EDITED_AFTER_ADD");
        await host.submit("continue", { session: added.session });
        expect(await Bun.file(join(host.snippets, "made.md")).text()).toBe("EDITED_AFTER_ADD");
        const deleted = await host.submit("/snippets delete made");
        expect(deleted.user.text).toContain("Deleted snippet #made");
        expect(await Bun.file(join(host.snippets, "made.md")).exists()).toBe(false);
        expect((await host.submit("#mk")).user.text).toBe("#mk");
      }),
    120_000,
  );

  test(
    "isolates project overrides and injections while sharing HOME and database",
    () =>
      withFixture(async (host) => {
        const other = join(host.root, "other");
        await mkdir(join(other, ".opencode", "snippet"), { recursive: true });
        await Bun.write(join(other, ".opencode", "snippet", "chosen.md"), "OTHER_PROJECT");
        const first = await host.submit("#chosen #persist");
        const second = await host.submit("#chosen", { directory: other });
        expect(first.user.text).toBe("PROJECT_CHOSEN VISIBLE_PERSIST");
        expect(second.user.text).toBe("OTHER_PROJECT");
        expect(JSON.stringify(second.calls)).not.toContain("PERSISTENT_CONTEXT");
        await rm(join(other, ".opencode", "snippet", "chosen.md"));
        expect((await host.submit("#chosen", { directory: other })).user.text).toBe(
          "GLOBAL_CHOSEN",
        );
        expect((await host.submit("#chosen", { session: first.session })).user.text).toBe(
          "PROJECT_CHOSEN",
        );
      }),
    120_000,
  );

  test(
    "respects disabled experimental flags without disabling ordinary expansion",
    () =>
      withFixture(async (host) => {
        await host.configure(false);
        await host.write("load", "#skill(local)");
        const result = await host.submit('#nested #load <skill name="local" /> #persist #once');
        expect(result.user.text).toBe(
          'PROJECT_CHOSEN #skill(local) <skill name="local" /> VISIBLE_PERSIST<inject>PERSISTENT_CONTEXT</inject> SHELL_PROOF',
        );
        const messages = result.calls.at(-1)?.messages ?? [];
        expect(messages.filter((message) => message.role === "user")).toHaveLength(1);
        expect(JSON.stringify(messages)).not.toContain("LOCAL_BODY");
      }),
    120_000,
  );

  test(
    "expands native skill-tool output and preserves hidden context through continuation",
    () =>
      withFixture(async (host) => {
        const result = await host.submit("#skill(local) #persist USE_NATIVE_TOOL");
        expect(result.calls).toHaveLength(2);
        for (const call of result.calls) {
          expect(
            call.messages.filter((message) =>
              text(message).includes('<skill_content name="local">'),
            ),
          ).toHaveLength(1);
          expect(
            call.messages.filter((message) => text(message) === "PERSISTENT_CONTEXT"),
          ).toHaveLength(1);
        }
        const tools = result.calls[1].messages.filter((message) => message.role === "tool");
        expect(tools).toHaveLength(1);
        expect(text(tools[0])).toContain("TOOL_BEGIN PROJECT_CHOSEN");
        expect(text(tools[0])).toContain("TOOL_END");
        expect(text(tools[0])).not.toContain("TOOL_INJECTION");
      }),
    120_000,
  );
});
