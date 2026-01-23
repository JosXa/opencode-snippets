import { describe, expect, it } from "bun:test";
import { parseAddOptions } from "./commands.js";

describe("parseAddOptions", () => {
  // Alias variations - all 4 must work per PR #13 requirements
  describe("alias parameter variations", () => {
    it("parses --alias=a,b", () => {
      expect(parseAddOptions(["--alias=a,b"])).toEqual({
        aliases: ["a", "b"],
        description: undefined,
        isProject: false,
      });
    });

    it("parses --alias a,b (space-separated)", () => {
      expect(parseAddOptions(["--alias", "a,b"])).toEqual({
        aliases: ["a", "b"],
        description: undefined,
        isProject: false,
      });
    });

    it("parses --aliases=a,b", () => {
      expect(parseAddOptions(["--aliases=a,b"])).toEqual({
        aliases: ["a", "b"],
        description: undefined,
        isProject: false,
      });
    });

    it("parses --aliases a,b (space-separated)", () => {
      expect(parseAddOptions(["--aliases", "a,b"])).toEqual({
        aliases: ["a", "b"],
        description: undefined,
        isProject: false,
      });
    });

    it("parses single alias", () => {
      expect(parseAddOptions(["--alias=foo"])).toEqual({
        aliases: ["foo"],
        description: undefined,
        isProject: false,
      });
    });

    it("handles multiple alias values with spaces", () => {
      expect(parseAddOptions(["--aliases=hello, world, foo"])).toEqual({
        aliases: ["hello", "world", "foo"],
        description: undefined,
        isProject: false,
      });
    });
  });

  // Description variations - all must work
  describe("description parameter variations", () => {
    it("parses --desc=value", () => {
      expect(parseAddOptions(["--desc=hello"])).toEqual({
        aliases: [],
        description: "hello",
        isProject: false,
      });
    });

    it("parses --desc value (space-separated)", () => {
      expect(parseAddOptions(["--desc", "hello"])).toEqual({
        aliases: [],
        description: "hello",
        isProject: false,
      });
    });

    it("parses --desc with apostrophe (main bug)", () => {
      expect(parseAddOptions(["--desc=don't break"])).toEqual({
        aliases: [],
        description: "don't break",
        isProject: false,
      });
    });

    it("parses --description=value", () => {
      expect(parseAddOptions(["--description=test"])).toEqual({
        aliases: [],
        description: "test",
        isProject: false,
      });
    });

    it("parses --description value (space-separated)", () => {
      expect(parseAddOptions(["--description", "test"])).toEqual({
        aliases: [],
        description: "test",
        isProject: false,
      });
    });

    it("parses --desc with multiline content", () => {
      expect(parseAddOptions(["--desc=line1\nline2"])).toEqual({
        aliases: [],
        description: "line1\nline2",
        isProject: false,
      });
    });
  });

  // Project flag
  describe("--project flag", () => {
    it("parses --project flag", () => {
      expect(parseAddOptions(["--project"])).toEqual({
        aliases: [],
        description: undefined,
        isProject: true,
      });
    });

    it("parses --project in any position", () => {
      expect(parseAddOptions(["--desc=test", "--project"])).toEqual({
        aliases: [],
        description: "test",
        isProject: true,
      });
    });
  });

  // Combined options
  describe("combined options", () => {
    it("parses multiple options together", () => {
      expect(parseAddOptions(["--alias=a,b", "--desc=hello", "--project"])).toEqual({
        aliases: ["a", "b"],
        description: "hello",
        isProject: true,
      });
    });

    it("parses all space-separated options together", () => {
      expect(parseAddOptions(["--alias", "a,b", "--desc", "hello", "--project"])).toEqual({
        aliases: ["a", "b"],
        description: "hello",
        isProject: true,
      });
    });

    it("handles mixed = and space syntax", () => {
      expect(parseAddOptions(["--alias=a,b", "--desc", "hello"])).toEqual({
        aliases: ["a", "b"],
        description: "hello",
        isProject: false,
      });
    });
  });

  // Edge cases
  describe("edge cases", () => {
    it("returns defaults for empty args", () => {
      expect(parseAddOptions([])).toEqual({
        aliases: [],
        description: undefined,
        isProject: false,
      });
    });

    it("ignores unknown options", () => {
      expect(parseAddOptions(["--unknown=value", "--desc=hello"])).toEqual({
        aliases: [],
        description: "hello",
        isProject: false,
      });
    });

    it("ignores positional args (non-option)", () => {
      expect(parseAddOptions(["positional", "--desc=hello"])).toEqual({
        aliases: [],
        description: "hello",
        isProject: false,
      });
    });

    it("does not consume value after --project", () => {
      // --project is a flag, should not consume next arg
      expect(parseAddOptions(["--project", "--desc=hello"])).toEqual({
        aliases: [],
        description: "hello",
        isProject: true,
      });
    });
  });
});
