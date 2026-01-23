/**
 * Shell-like argument parser that handles quoted strings correctly.
 *
 * Supports:
 * - Space-separated arguments
 * - Double-quoted strings (preserves spaces, allows single quotes inside)
 * - Single-quoted strings (preserves spaces, allows double quotes inside)
 * - --key=value syntax with quoted values
 * - Multiline content inside quotes
 * - Backslash escapes for quotes inside quoted strings
 *
 * @param input - The raw argument string to parse
 * @returns Array of parsed arguments with quotes stripped
 */
export function parseCommandArgs(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let state: "normal" | "double" | "single" = "normal";
  let hasQuotedContent = false; // Track if we've entered a quoted section
  let i = 0;

  while (i < input.length) {
    const char = input[i];

    if (state === "normal") {
      if (char === " " || char === "\t") {
        // Whitespace in normal mode: finish current token
        if (current.length > 0 || hasQuotedContent) {
          args.push(current);
          current = "";
          hasQuotedContent = false;
        }
      } else if (char === '"') {
        // Enter double-quote mode
        state = "double";
        hasQuotedContent = true;
      } else if (char === "'") {
        // Enter single-quote mode
        state = "single";
        hasQuotedContent = true;
      } else {
        current += char;
      }
    } else if (state === "double") {
      if (char === "\\") {
        // Check for escape sequences
        const next = input[i + 1];
        if (next === '"' || next === "\\") {
          current += next;
          i++; // Skip the escaped character
        } else {
          current += char;
        }
      } else if (char === '"') {
        // Exit double-quote mode
        state = "normal";
      } else {
        current += char;
      }
    } else if (state === "single") {
      if (char === "\\") {
        // Check for escape sequences
        const next = input[i + 1];
        if (next === "'" || next === "\\") {
          current += next;
          i++; // Skip the escaped character
        } else {
          current += char;
        }
      } else if (char === "'") {
        // Exit single-quote mode
        state = "normal";
      } else {
        current += char;
      }
    }

    i++;
  }

  // Handle any remaining content (including unclosed quotes or empty quoted strings)
  if (current.length > 0 || hasQuotedContent) {
    args.push(current);
  }

  return args;
}
