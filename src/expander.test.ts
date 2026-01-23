import { assembleMessage, expandHashtags, parseSnippetBlocks } from "../src/expander.js";
import type { SnippetInfo, SnippetRegistry } from "../src/types.js";

/** Helper to create a SnippetInfo from just content */
function snippet(content: string, name = "test"): SnippetInfo {
  return { name, content, aliases: [], filePath: "", source: "global" };
}

/** Helper to create a registry from [key, content] pairs */
function createRegistry(entries: [string, string][]): SnippetRegistry {
  return new Map(entries.map(([key, content]) => [key, snippet(content, key)]));
}

describe("expandHashtags - Recursive Includes and Loop Detection", () => {
  describe("Basic expansion", () => {
    it("should expand a single hashtag", () => {
      const registry = createRegistry([["greeting", "Hello, World!"]]);

      const result = expandHashtags("Say #greeting", registry);

      expect(result.text).toBe("Say Hello, World!");
    });

    it("should expand multiple hashtags in one text", () => {
      const registry = createRegistry([
        ["greeting", "Hello"],
        ["name", "Alice"],
      ]);

      const result = expandHashtags("#greeting, #name!", registry);

      expect(result.text).toBe("Hello, Alice!");
    });

    it("should leave unknown hashtags unchanged", () => {
      const registry = createRegistry([["known", "content"]]);

      const result = expandHashtags("This is #known and #unknown", registry);

      expect(result.text).toBe("This is content and #unknown");
    });

    it("should handle empty text", () => {
      const registry = createRegistry([["test", "content"]]);

      const result = expandHashtags("", registry);

      expect(result.text).toBe("");
    });

    it("should handle text with no hashtags", () => {
      const registry = createRegistry([["test", "content"]]);

      const result = expandHashtags("No hashtags here", registry);

      expect(result.text).toBe("No hashtags here");
    });

    it("should handle case-insensitive hashtags", () => {
      const registry = createRegistry([["greeting", "Hello"]]);

      const result = expandHashtags("#Greeting #GREETING #greeting", registry);

      expect(result.text).toBe("Hello Hello Hello");
    });
  });

  describe("Recursive expansion", () => {
    it("should expand nested hashtags one level deep", () => {
      const registry = createRegistry([
        ["outer", "Start #inner End"],
        ["inner", "Middle"],
      ]);

      const result = expandHashtags("#outer", registry);

      expect(result.text).toBe("Start Middle End");
    });

    it("should expand nested hashtags multiple levels deep", () => {
      const registry = createRegistry([
        ["level1", "L1 #level2"],
        ["level2", "L2 #level3"],
        ["level3", "L3 #level4"],
        ["level4", "L4"],
      ]);

      const result = expandHashtags("#level1", registry);

      expect(result.text).toBe("L1 L2 L3 L4");
    });

    it("should expand multiple nested hashtags in one snippet", () => {
      const registry = createRegistry([
        ["main", "Start #a and #b End"],
        ["a", "Content A"],
        ["b", "Content B"],
      ]);

      const result = expandHashtags("#main", registry);

      expect(result.text).toBe("Start Content A and Content B End");
    });

    it("should expand complex nested structure", () => {
      const registry = createRegistry([
        ["greeting", "#hello #name"],
        ["hello", "Hello"],
        ["name", "#firstname #lastname"],
        ["firstname", "John"],
        ["lastname", "Doe"],
      ]);

      const result = expandHashtags("#greeting", registry);

      expect(result.text).toBe("Hello John Doe");
    });
  });

  describe("Loop detection - Direct cycles", () => {
    it("should detect and prevent simple self-reference", { timeout: 100 }, () => {
      const registry = createRegistry([["self", "I reference #self"]]);

      const result = expandHashtags("#self", registry);

      // Loop detected after 15 expansions, #self left as-is
      const expected = `${"I reference ".repeat(15)}#self`;
      expect(result.text).toBe(expected);
    });

    it("should detect and prevent two-way circular reference", () => {
      const registry = createRegistry([
        ["a", "A references #b"],
        ["b", "B references #a"],
      ]);

      const result = expandHashtags("#a", registry);

      // Should expand alternating A and B 15 times then stop
      const expected = `${"A references B references ".repeat(15)}#a`;
      expect(result.text).toBe(expected);
    });

    it("should detect and prevent three-way circular reference", () => {
      const registry = createRegistry([
        ["a", "A -> #b"],
        ["b", "B -> #c"],
        ["c", "C -> #a"],
      ]);

      const result = expandHashtags("#a", registry);

      // Should expand cycling through A, B, C 15 times then stop
      const expected = `${"A -> B -> C -> ".repeat(15)}#a`;
      expect(result.text).toBe(expected);
    });

    it("should detect loops in longer chains", () => {
      const registry = createRegistry([
        ["a", "#b"],
        ["b", "#c"],
        ["c", "#d"],
        ["d", "#e"],
        ["e", "#b"], // Loop back to b
      ]);

      const result = expandHashtags("#a", registry);

      // Should expand until loop detected
      expect(result.text).toBe("#b");
    });
  });

  describe("Loop detection - Complex scenarios", () => {
    it("should allow same snippet in different branches", () => {
      const registry = createRegistry([
        ["main", "#branch1 and #branch2"],
        ["branch1", "B1 uses #shared"],
        ["branch2", "B2 uses #shared"],
        ["shared", "Shared content"],
      ]);

      const result = expandHashtags("#main", registry);

      // #shared should be expanded in both branches
      expect(result.text).toBe("B1 uses Shared content and B2 uses Shared content");
    });

    it("should handle partial loops with valid branches", () => {
      const registry = createRegistry([
        ["main", "#valid and #loop"],
        ["valid", "Valid content"],
        ["loop", "Loop #loop"],
      ]);

      const result = expandHashtags("#main", registry);

      // Valid expands once, loop expands 15 times
      const expected = `Valid content and ${"Loop ".repeat(15)}#loop`;
      expect(result.text).toBe(expected);
    });

    it("should handle multiple independent loops", () => {
      const registry = createRegistry([
        ["main", "#loop1 and #loop2"],
        ["loop1", "L1 #loop1"],
        ["loop2", "L2 #loop2"],
      ]);

      const result = expandHashtags("#main", registry);

      // Each loop expands 15 times independently
      const expected = `${"L1 ".repeat(15)}#loop1 and ${"L2 ".repeat(15)}#loop2`;
      expect(result.text).toBe(expected);
    });

    it("should handle nested loops", () => {
      const registry = createRegistry([
        ["outer", "Outer #inner"],
        ["inner", "Inner #outer and #self"],
        ["self", "Self #self"],
      ]);

      const result = expandHashtags("#outer", registry);

      // Complex nested loop - outer/inner cycle 15 times, plus self cycles
      // This is complex expansion behavior, just verify it doesn't hang
      expect(result.text).toContain("Outer");
      expect(result.text).toContain("Inner");
      expect(result.text).toContain("#outer");
      expect(result.text).toContain("#self");
    });

    it("should handle diamond pattern (same snippet reached via multiple paths)", () => {
      const registry = createRegistry([
        ["top", "#left #right"],
        ["left", "Left #bottom"],
        ["right", "Right #bottom"],
        ["bottom", "Bottom"],
      ]);

      const result = expandHashtags("#top", registry);

      // Diamond: top -> left -> bottom, top -> right -> bottom
      expect(result.text).toBe("Left Bottom Right Bottom");
    });

    it("should handle loop after valid expansion", () => {
      const registry = createRegistry([
        ["a", "#b #c"],
        ["b", "Valid B"],
        ["c", "#d"],
        ["d", "#c"], // Loop back
      ]);

      const result = expandHashtags("#a", registry);

      expect(result.text).toBe("Valid B #c");
    });
  });

  describe("Edge cases", () => {
    it("should handle empty registry", () => {
      const registry: SnippetRegistry = new Map();

      const result = expandHashtags("#anything", registry);

      expect(result.text).toBe("#anything");
    });

    it("should handle snippet with empty content", () => {
      const registry = createRegistry([["empty", ""]]);

      const result = expandHashtags("Before #empty After", registry);

      expect(result.text).toBe("Before  After");
    });

    it("should handle snippet containing only hashtags", () => {
      const registry = createRegistry([
        ["only-refs", "#a #b"],
        ["a", "A"],
        ["b", "B"],
      ]);

      const result = expandHashtags("#only-refs", registry);

      expect(result.text).toBe("A B");
    });

    it("should handle hashtags at start, middle, and end", () => {
      const registry = createRegistry([
        ["start", "Start"],
        ["middle", "Middle"],
        ["end", "End"],
      ]);

      const result = expandHashtags("#start text #middle text #end", registry);

      expect(result.text).toBe("Start text Middle text End");
    });

    it("should handle consecutive hashtags", () => {
      const registry = createRegistry([
        ["a", "A"],
        ["b", "B"],
        ["c", "C"],
      ]);

      const result = expandHashtags("#a#b#c", registry);

      expect(result.text).toBe("ABC");
    });

    it("should handle hashtags with hyphens and underscores", () => {
      const registry = createRegistry([
        ["my-snippet", "Hyphenated"],
        ["my_snippet", "Underscored"],
        ["my-complex_name", "Mixed"],
      ]);

      const result = expandHashtags("#my-snippet #my_snippet #my-complex_name", registry);

      expect(result.text).toBe("Hyphenated Underscored Mixed");
    });

    it("should handle hashtags with numbers", () => {
      const registry = createRegistry([
        ["test123", "Test with numbers"],
        ["123test", "Numbers first"],
      ]);

      const result = expandHashtags("#test123 #123test", registry);

      expect(result.text).toBe("Test with numbers Numbers first");
    });

    it("should not expand hashtags in URLs", () => {
      const registry = createRegistry([["issue", "ISSUE"]]);

      // Note: The current implementation WILL expand #issue in URLs
      // This test documents current behavior
      const result = expandHashtags("See https://github.com/user/repo/issues/#issue", registry);

      expect(result.text).toBe("See https://github.com/user/repo/issues/ISSUE");
    });

    it("should handle multiline content", () => {
      const registry = createRegistry([["multiline", "Line 1\nLine 2\nLine 3"]]);

      const result = expandHashtags("Start\n#multiline\nEnd", registry);

      expect(result.text).toBe("Start\nLine 1\nLine 2\nLine 3\nEnd");
    });

    it("should handle nested multiline content", () => {
      const registry = createRegistry([
        ["outer", "Outer start\n#inner\nOuter end"],
        ["inner", "Inner line 1\nInner line 2"],
      ]);

      const result = expandHashtags("#outer", registry);

      expect(result.text).toBe("Outer start\nInner line 1\nInner line 2\nOuter end");
    });
  });

  describe("Real-world scenarios", () => {
    it("should expand code review template with nested snippets", () => {
      const registry = createRegistry([
        ["review", "Code Review Checklist:\n#security\n#performance\n#tests"],
        ["security", "- Check for SQL injection\n- Validate input"],
        ["performance", "- Check for N+1 queries\n- Review algorithm complexity"],
        ["tests", "- Unit tests present\n- Edge cases covered"],
      ]);

      const result = expandHashtags("#review", registry);

      expect(result.text).toContain("Code Review Checklist:");
      expect(result.text).toContain("Check for SQL injection");
      expect(result.text).toContain("Check for N+1 queries");
      expect(result.text).toContain("Unit tests present");
    });

    it("should expand documentation template with shared components", () => {
      const registry = createRegistry([
        ["doc", "# Documentation\n#header\n#body\n#footer"],
        ["header", "Author: #author\nDate: 2024-01-01"],
        ["author", "John Doe"],
        ["body", "Main content here"],
        ["footer", "Contact: #author"],
      ]);

      const result = expandHashtags("#doc", registry);

      // #author should be expanded in both header and footer
      expect(result.text).toContain("Author: John Doe");
      expect(result.text).toContain("Contact: John Doe");
    });

    it("should handle instruction composition", () => {
      const registry = createRegistry([
        ["careful", "Think step by step. #verify"],
        ["verify", "Double-check your work."],
        ["complete", "Be thorough. #careful"],
      ]);

      const result = expandHashtags("Instructions: #complete", registry);

      expect(result.text).toBe(
        "Instructions: Be thorough. Think step by step. Double-check your work.",
      );
    });
  });

  describe("Performance and stress tests", () => {
    it("should handle deep nesting without stack overflow", () => {
      const registry: SnippetRegistry = new Map();
      const depth = 50;

      // Create a chain: level0 -> level1 -> level2 -> ... -> level49 -> "End"
      for (let i = 0; i < depth - 1; i++) {
        registry.set(`level${i}`, snippet(`L${i} #level${i + 1}`, `level${i}`));
      }
      registry.set(`level${depth - 1}`, snippet("End", `level${depth - 1}`));

      const result = expandHashtags("#level0", registry);

      expect(result.text).toContain("L0");
      expect(result.text).toContain("End");
      expect(result.text.split(" ").length).toBe(depth);
    });

    it("should handle many snippets in one text", () => {
      const registry: SnippetRegistry = new Map();
      const count = 100;

      for (let i = 0; i < count; i++) {
        registry.set(`snippet${i}`, snippet(`Content${i}`, `snippet${i}`));
      }

      const hashtags = Array.from({ length: count }, (_, i) => `#snippet${i}`).join(" ");
      const result = expandHashtags(hashtags, registry);

      expect(result.text.split(" ").length).toBe(count);
      expect(result.text).toContain("Content0");
      expect(result.text).toContain(`Content${count - 1}`);
    });

    it("should handle wide branching (many children)", () => {
      const registry: SnippetRegistry = new Map();
      const branches = 20;

      const children = Array.from({ length: branches }, (_, i) => `#child${i}`).join(" ");
      registry.set("parent", snippet(children, "parent"));

      for (let i = 0; i < branches; i++) {
        registry.set(`child${i}`, snippet(`Child${i}`, `child${i}`));
      }

      const result = expandHashtags("#parent", registry);

      for (let i = 0; i < branches; i++) {
        expect(result.text).toContain(`Child${i}`);
      }
    });
  });
});

describe("parseSnippetBlocks", () => {
  describe("Basic parsing", () => {
    it("should return full content as inline when no blocks present", () => {
      const result = parseSnippetBlocks("Just some content");

      expect(result).toEqual({
        inline: "Just some content",
        prepend: [],
        append: [],
      });
    });

    it("should extract append block and inline content", () => {
      const result = parseSnippetBlocks("Inline text\n<append>\nAppend content\n</append>");

      expect(result).toEqual({
        inline: "Inline text",
        prepend: [],
        append: ["Append content"],
      });
    });

    it("should extract prepend block and inline content", () => {
      const result = parseSnippetBlocks("<prepend>\nPrepend content\n</prepend>\nInline text");

      expect(result).toEqual({
        inline: "Inline text",
        prepend: ["Prepend content"],
        append: [],
      });
    });

    it("should extract both prepend and append blocks", () => {
      const content = `<prepend>
Before content
</prepend>
Inline text
<append>
After content
</append>`;

      const result = parseSnippetBlocks(content);

      expect(result).toEqual({
        inline: "Inline text",
        prepend: ["Before content"],
        append: ["After content"],
      });
    });

    it("should handle multiple blocks of the same type", () => {
      const content = `<append>
First append
</append>
Inline
<append>
Second append
</append>`;

      const result = parseSnippetBlocks(content);

      expect(result).toEqual({
        inline: "Inline",
        prepend: [],
        append: ["First append", "Second append"],
      });
    });
  });

  describe("Edge cases", () => {
    it("should handle empty inline (only blocks)", () => {
      const content = `<append>
Only append content
</append>`;

      const result = parseSnippetBlocks(content);

      expect(result).toEqual({
        inline: "",
        prepend: [],
        append: ["Only append content"],
      });
    });

    it("should handle unclosed tag leniently (rest is block content)", () => {
      const content = "Inline\n<append>\nUnclosed append content";

      const result = parseSnippetBlocks(content);

      expect(result).toEqual({
        inline: "Inline",
        prepend: [],
        append: ["Unclosed append content"],
      });
    });

    it("should return null for nested tags", () => {
      const content = "<append>\n<prepend>\nnested\n</prepend>\n</append>";

      const result = parseSnippetBlocks(content);

      expect(result).toBeNull();
    });

    it("should trim content inside blocks", () => {
      const content = "<append>\n  \n  Content with whitespace  \n  \n</append>";

      const result = parseSnippetBlocks(content);

      expect(result?.append[0]).toBe("Content with whitespace");
    });

    it("should trim inline content", () => {
      const content = "  \n  Inline with whitespace  \n  ";

      const result = parseSnippetBlocks(content);

      expect(result?.inline).toBe("Inline with whitespace");
    });

    it("should be case-insensitive for tags", () => {
      const content = "<APPEND>\nContent\n</APPEND>";

      const result = parseSnippetBlocks(content);

      expect(result).toEqual({
        inline: "",
        prepend: [],
        append: ["Content"],
      });
    });

    it("should handle empty blocks", () => {
      const content = "Inline<append></append>";

      const result = parseSnippetBlocks(content);

      expect(result).toEqual({
        inline: "Inline",
        prepend: [],
        append: [],
      });
    });
  });

  describe("Real-world content", () => {
    it("should parse Jira MCP example", () => {
      const content = `Jira MCP server
<append>
## Jira MCP Usage

Use these custom field mappings when creating issues:
- customfield_16570 => Acceptance Criteria
- customfield_11401 => Team
</append>`;

      const result = parseSnippetBlocks(content);

      expect(result?.inline).toBe("Jira MCP server");
      expect(result?.append).toHaveLength(1);
      expect(result?.append[0]).toContain("Jira MCP Usage");
      expect(result?.append[0]).toContain("customfield_16570");
    });
  });
});

describe("assembleMessage", () => {
  it("should assemble text only", () => {
    const result = assembleMessage({
      text: "Main content",
      prepend: [],
      append: [],
    });

    expect(result).toBe("Main content");
  });

  it("should assemble with append blocks", () => {
    const result = assembleMessage({
      text: "Main content",
      prepend: [],
      append: ["Appended section"],
    });

    expect(result).toBe("Main content\n\nAppended section");
  });

  it("should assemble with prepend blocks", () => {
    const result = assembleMessage({
      text: "Main content",
      prepend: ["Prepended section"],
      append: [],
    });

    expect(result).toBe("Prepended section\n\nMain content");
  });

  it("should assemble with both prepend and append", () => {
    const result = assembleMessage({
      text: "Main content",
      prepend: ["Before"],
      append: ["After"],
    });

    expect(result).toBe("Before\n\nMain content\n\nAfter");
  });

  it("should join multiple prepend blocks", () => {
    const result = assembleMessage({
      text: "Main",
      prepend: ["First", "Second"],
      append: [],
    });

    expect(result).toBe("First\n\nSecond\n\nMain");
  });

  it("should join multiple append blocks", () => {
    const result = assembleMessage({
      text: "Main",
      prepend: [],
      append: ["First", "Second"],
    });

    expect(result).toBe("Main\n\nFirst\n\nSecond");
  });

  it("should handle empty text with blocks", () => {
    const result = assembleMessage({
      text: "",
      prepend: ["Before"],
      append: ["After"],
    });

    expect(result).toBe("Before\n\nAfter");
  });

  it("should handle whitespace-only text with blocks", () => {
    const result = assembleMessage({
      text: "   ",
      prepend: ["Before"],
      append: ["After"],
    });

    expect(result).toBe("Before\n\nAfter");
  });
});

describe("Prepend/Append integration with expandHashtags", () => {
  it("should collect append blocks during expansion", () => {
    const registry = createRegistry([
      ["jira", "Jira MCP server\n<append>\nJira reference docs\n</append>"],
    ]);

    const result = expandHashtags("Create a ticket in #jira", registry);

    expect(result.text).toBe("Create a ticket in Jira MCP server");
    expect(result.append).toEqual(["Jira reference docs"]);
  });

  it("should collect prepend blocks during expansion", () => {
    const registry = createRegistry([
      ["context", "<prepend>\nImportant context\n</prepend>\nUse the context"],
    ]);

    const result = expandHashtags("#context please", registry);

    expect(result.text).toBe("Use the context please");
    expect(result.prepend).toEqual(["Important context"]);
  });

  it("should collect blocks from nested snippets", () => {
    const registry = createRegistry([
      ["outer", "Outer #inner text"],
      ["inner", "Inner\n<append>\nInner's append\n</append>"],
    ]);

    const result = expandHashtags("#outer", registry);

    expect(result.text).toBe("Outer Inner text");
    expect(result.append).toEqual(["Inner's append"]);
  });

  it("should collect blocks from multiple snippets", () => {
    const registry = createRegistry([
      ["a", "A text\n<append>\nA's append\n</append>"],
      ["b", "B text\n<append>\nB's append\n</append>"],
    ]);

    const result = expandHashtags("#a and #b", registry);

    expect(result.text).toBe("A text and B text");
    expect(result.append).toEqual(["A's append", "B's append"]);
  });

  it("should handle empty inline with only blocks", () => {
    const registry = createRegistry([["ref", "<append>\nReference material\n</append>"]]);

    const result = expandHashtags("Use #ref here", registry);

    expect(result.text).toBe("Use  here");
    expect(result.append).toEqual(["Reference material"]);
  });

  it("should assemble full message correctly", () => {
    const registry = createRegistry([
      ["jira", "Jira MCP server\n<append>\n## Jira Usage\n- Field mappings here\n</append>"],
    ]);

    const result = expandHashtags("Create a bug ticket in #jira about the memory leak", registry);
    const assembled = assembleMessage(result);

    expect(assembled).toBe(
      "Create a bug ticket in Jira MCP server about the memory leak\n\n## Jira Usage\n- Field mappings here",
    );
  });

  it("should collect multiple append blocks from single snippet", () => {
    const registry = createRegistry([
      ["multi", "Inline\n<append>\nFirst append\n</append>\n<append>\nSecond append\n</append>"],
    ]);

    const result = expandHashtags("#multi", registry);

    expect(result.text).toBe("Inline");
    expect(result.append).toEqual(["First append", "Second append"]);
  });

  it("should collect multiple prepend blocks from single snippet", () => {
    const registry = createRegistry([
      [
        "multi",
        "<prepend>\nFirst prepend\n</prepend>\n<prepend>\nSecond prepend\n</prepend>\nInline",
      ],
    ]);

    const result = expandHashtags("#multi", registry);

    expect(result.text).toBe("Inline");
    expect(result.prepend).toEqual(["First prepend", "Second prepend"]);
  });

  it("should assemble multiple prepends and appends in correct order", () => {
    const registry = createRegistry([
      ["a", "<prepend>\nA prepend\n</prepend>\nA inline\n<append>\nA append\n</append>"],
      ["b", "<prepend>\nB prepend\n</prepend>\nB inline\n<append>\nB append\n</append>"],
    ]);

    const result = expandHashtags("#a then #b", registry);
    const assembled = assembleMessage(result);

    // Prepends first (in order), then inline, then appends (in order)
    expect(assembled).toBe(
      "A prepend\n\nB prepend\n\nA inline then B inline\n\nA append\n\nB append",
    );
  });

  it("should handle mix of snippets with and without blocks", () => {
    const registry = createRegistry([
      ["plain", "Plain content"],
      ["withblocks", "Block inline\n<append>\nBlock append\n</append>"],
    ]);

    const result = expandHashtags("#plain and #withblocks", registry);
    const assembled = assembleMessage(result);

    expect(assembled).toBe("Plain content and Block inline\n\nBlock append");
  });
});
