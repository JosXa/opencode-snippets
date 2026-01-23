import { describe, expect, it } from "bun:test";
import { parseCommandArgs } from "./arg-parser.js";

describe("parseCommandArgs", () => {
  // Basic splitting
  describe("basic argument splitting", () => {
    it("splits simple space-separated args", () => {
      expect(parseCommandArgs("add test")).toEqual(["add", "test"]);
    });

    it("handles empty input", () => {
      expect(parseCommandArgs("")).toEqual([]);
    });

    it("handles whitespace-only input", () => {
      expect(parseCommandArgs("   ")).toEqual([]);
    });

    it("handles multiple spaces between args", () => {
      expect(parseCommandArgs("add   test")).toEqual(["add", "test"]);
    });

    it("handles leading and trailing spaces", () => {
      expect(parseCommandArgs("  add test  ")).toEqual(["add", "test"]);
    });

    it("handles tabs and mixed whitespace", () => {
      expect(parseCommandArgs("add\t\ttest")).toEqual(["add", "test"]);
    });
  });

  // Double quote handling
  describe("double quote handling", () => {
    it("preserves double-quoted strings with spaces", () => {
      expect(parseCommandArgs('add "hello world"')).toEqual(["add", "hello world"]);
    });

    it("handles single quote inside double quotes", () => {
      // THE MAIN BUG - apostrophe in description
      expect(parseCommandArgs('--desc="don\'t do this"')).toEqual(["--desc=don't do this"]);
    });

    it("handles empty double-quoted string", () => {
      expect(parseCommandArgs('add ""')).toEqual(["add", ""]);
    });

    it("handles double-quoted string at start", () => {
      expect(parseCommandArgs('"hello world" test')).toEqual(["hello world", "test"]);
    });

    it("handles multiple double-quoted strings", () => {
      expect(parseCommandArgs('"first" "second"')).toEqual(["first", "second"]);
    });
  });

  // Single quote handling
  describe("single quote handling", () => {
    it("preserves single-quoted strings with spaces", () => {
      expect(parseCommandArgs("add 'hello world'")).toEqual(["add", "hello world"]);
    });

    it("handles double quote inside single quotes", () => {
      expect(parseCommandArgs("--desc='say \"hello\"'")).toEqual(['--desc=say "hello"']);
    });

    it("handles empty single-quoted string", () => {
      expect(parseCommandArgs("add ''")).toEqual(["add", ""]);
    });
  });

  // --key=value syntax
  describe("--key=value syntax", () => {
    it("handles --key=value without quotes", () => {
      expect(parseCommandArgs("--desc=hello")).toEqual(["--desc=hello"]);
    });

    it('handles --key="value" with quotes stripped from value', () => {
      expect(parseCommandArgs('--desc="hello world"')).toEqual(["--desc=hello world"]);
    });

    it("handles --key='value' with quotes stripped from value", () => {
      expect(parseCommandArgs("--key='hello world'")).toEqual(["--key=hello world"]);
    });

    it("handles --key=value with special characters", () => {
      expect(parseCommandArgs("--desc=hello,world")).toEqual(["--desc=hello,world"]);
    });

    it("preserves = inside quoted value", () => {
      expect(parseCommandArgs('--desc="a=b"')).toEqual(["--desc=a=b"]);
    });
  });

  // Multiline content (critical for snippet bodies)
  describe("multiline content", () => {
    it("handles multiline content in double quotes", () => {
      expect(parseCommandArgs('add test "line1\nline2\nline3"')).toEqual([
        "add",
        "test",
        "line1\nline2\nline3",
      ]);
    });

    it("handles multiline content in single quotes", () => {
      expect(parseCommandArgs("add test 'line1\nline2'")).toEqual(["add", "test", "line1\nline2"]);
    });

    it("handles multiline content with --key=value syntax", () => {
      expect(parseCommandArgs('--desc="line1\nline2"')).toEqual(["--desc=line1\nline2"]);
    });

    it("preserves indentation in multiline content", () => {
      const input = 'add test "line1\n  indented\n    more indented"';
      expect(parseCommandArgs(input)).toEqual([
        "add",
        "test",
        "line1\n  indented\n    more indented",
      ]);
    });
  });

  // Mixed scenarios
  describe("mixed scenarios", () => {
    it("handles mixed quoted and unquoted args", () => {
      expect(parseCommandArgs('add test "hello world" --project')).toEqual([
        "add",
        "test",
        "hello world",
        "--project",
      ]);
    });

    it("handles complex command with all option types", () => {
      const input = 'add mysnippet "content here" --aliases=a,b --desc="don\'t forget" --project';
      expect(parseCommandArgs(input)).toEqual([
        "add",
        "mysnippet",
        "content here",
        "--aliases=a,b",
        "--desc=don't forget",
        "--project",
      ]);
    });

    it("handles --key value syntax (space-separated)", () => {
      expect(parseCommandArgs("--desc hello")).toEqual(["--desc", "hello"]);
    });

    it("handles --key followed by quoted value", () => {
      expect(parseCommandArgs('--desc "hello world"')).toEqual(["--desc", "hello world"]);
    });
  });

  // Edge cases
  describe("edge cases", () => {
    it("handles unclosed double quote by including rest of string", () => {
      // Graceful handling: treat unclosed quote as extending to end
      expect(parseCommandArgs('add "unclosed')).toEqual(["add", "unclosed"]);
    });

    it("handles unclosed single quote by including rest of string", () => {
      expect(parseCommandArgs("add 'unclosed")).toEqual(["add", "unclosed"]);
    });

    it("handles backslash-escaped quotes inside double quotes", () => {
      expect(parseCommandArgs('--desc="say \\"hello\\""')).toEqual(['--desc=say "hello"']);
    });

    it("handles backslash-escaped quotes inside single quotes", () => {
      expect(parseCommandArgs("--desc='it\\'s fine'")).toEqual(["--desc=it's fine"]);
    });

    it("handles literal backslash", () => {
      expect(parseCommandArgs('--path="C:\\\\Users"')).toEqual(["--path=C:\\Users"]);
    });
  });
});
