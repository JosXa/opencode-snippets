# Non-Jinja template languages for snippet fields

## Recommendation

**Keep the snippet grammar and add the smallest field/call grammar it needs.**
Of the five JS/TS choices examined, none supplies stock
`#func(arg=1, arg2=2)` with named-argument semantics. Velocity looks closest;
Handlebars supplies the closest named-argument behavior. Neither gives both.
Changing delimiters does not change argument semantics.

The existing requirements already define much of the language: nested
`#other-snippet`, `#skill(...)` in the composer and bodies, XML
`<append>/<prepend>/<inject>` blocks, and the existing shell syntax. A whole
template language is justified if general conditionals, iteration, or template
inheritance become requirements. Inline form metadata alone does not require it.
If an established body template language is wanted, **Handlebars is the best
candidate here**: named helper options and a parseable AST work well together,
while ordinary hashes and XML remain text. It would still introduce a second
syntax for body fields and require the application's own composer-call parser.

This is a language comparison, not a grammar migration. The examples below use
an **application-defined `field` helper/tag**, which each engine would need to be
given. None ships form controls, field validation, or a `field` builtin.

## At a glance

| Language and actual JS package | Valid inline declaration using an app-defined helper | Relationship to `#func(arg=1, arg2=2)` | Discover fields before rendering? |
| --- | --- | --- | --- |
| Velocity / `velocityjs` | `#field("branch", {"label":"Branch name","maxLength":20})` | Same hash and parentheses; positional arguments with a map instead of keywords | Yes: exported `parse`, `macro_call` and literal/map nodes |
| Handlebars / `handlebars` | `{{field "branch" label="Branch name" maxLength=20}}` | Native named hash arguments; braces and spaces instead of hash/parenthesized comma calls | Yes: exported `parse`, `MustacheStatement`, `HashPair`, literal nodes |
| Liquid / `liquidjs` | `{% field name:"branch", label:"Branch name", maxLength:20 %}` | Named options via its `Hash` utility; colon syntax inside a custom tag | Yes: custom tag parse hook and token/hash structures |
| Eta / `eta` | `<%~ it.field("branch", {label:"Branch name", maxLength:20}) %>` | JavaScript call with an options object | Template parser exposes code strings; JS call analysis needs more parsing/restrictions |
| EJS / `ejs` | `<%- field("branch", {label:"Branch name", maxLength:20}) %>` | JavaScript call with an options object | Documented API compiles/renders; no documented semantic field-call AST |

The language-specific sections below cite the grammar and API sources. This is
a selection of established template-language families and a TypeScript-oriented
EJS alternative, not a popularity or maintenance ranking.

## Velocity: closest appearance, significant collisions

Apache's [VTL reference](https://velocity.apache.org/engine/2.3/vtl-reference.html#macro-allows-users-to-define-a-velocimacro-vm-a-repeated-segment-of-a-vtl-template-as-required)
defines macros as `#macro(name $arg1 $arg2) ... #end` and invokes them with
`#name($value1 $value2)`. These arguments bind by position. Defaults in an Apache
macro *declaration* do not establish keyword arguments at a call site.

The actual JS implementation examined is
[`velocityjs`](https://registry.npmjs.org/velocityjs/2.1.7), from
[shepherdwind/velocity.js](https://github.com/shepherdwind/velocity.js).
Its [source package](https://github.com/shepherdwind/velocity.js/blob/master/package.json)
has TypeScript source, ESM/CJS entry points, and bundled declarations. This is a
JS port; the Apache Java engine itself is not a Bun dependency. Its README's
compatibility claim should not substitute for checking individual VTL features.

The [documented API](https://github.com/shepherdwind/velocity.js/blob/master/README.md#api-reference)
exports `parse` separately from `render`, and accepts JS macro callbacks.
The [macro implementation](https://github.com/shepherdwind/velocity.js/blob/master/src/compile/blocks.ts)
passes an ordered argument array to a JS callback and binds template macro
parameters by index. The declaration in the table successfully delivered a
string and a map to a callback in the Bun probe. That is an options map, not
`label=...` keyword syntax.

Field discovery can inspect `macro_call.id === "field"` and its literal args
without calling the helper. Double-quoted VTL strings can interpolate references;
a metadata collector would need literal-only rules or single-quoted strings,
rather than evaluating arbitrary metadata expressions.

**The hash overlap is a practical disadvantage for these snippets:**

- Bare `#other-snippet` and ordinary XML survived the focused probe.
- `#skill(review)` failed to parse because a bare word is not a VTL argument.
- `#skill("review")` parsed as a macro call but rendered to an empty string when
  no such macro was registered. Unknown calls are not reliably preserved text.
- Markdown `## Heading` is a VTL comment and disappears.
- VTL owns `$name` and `${name}`. The probe changed `$HOME` even inside
  `` !`echo $HOME` `` when a `HOME` context value existed. A literal `$ command`
  line survived, but shell payloads can contain variable-shaped tokens.
- Builtin hashes such as `#if`, `#set`, and `#end` already have meanings.

These behaviors follow the [VTL reference's references and comments grammar](https://velocity.apache.org/engine/2.3/vtl-reference.html)
and the probe below. Protecting existing constructs before running Velocity
would still require application parsing, while adding collisions that the
present snippet syntax does not have.

## Handlebars: best named options and metadata fit

[Helper calls](https://handlebarsjs.com/guide/expressions.html#helpers-with-hash-arguments)
accept positional arguments followed by named hash entries. The helper receives
the named values in `options.hash`, so `maxLength=20 label="Branch name"` has
the same meaning as the reverse order. This is genuine named-option support,
although Handlebars does not bind those options to JS formal parameter names.
Parentheses denote [subexpressions](https://handlebarsjs.com/guide/expressions.html#subexpressions),
for example `{{outer (inner "value")}}`; they are not JavaScript call punctuation.

The [`handlebars` package](https://registry.npmjs.org/handlebars/4.7.9) is JavaScript
with bundled TypeScript declarations. The [full engine entry point](https://github.com/handlebars-lang/handlebars.js/blob/master/lib/handlebars.js)
exports `parse`, `parseWithoutProcessing`, and AST support. The runtime-only build
is insufficient for discovery. In the published version probed, `parse` produced
a `MustacheStatement` with a string positional argument and `HashPair` nodes
containing typed literal values, without executing a helper.

This supports a collector that accepts direct `field` calls with literal
metadata, including calls inside block bodies. Calls that compute field names
or metadata through helpers would need restrictions; parsing is not evaluation.
Handlebars literals include strings, numbers, and booleans; it has no general JS
array/object literal syntax for helper arguments. Choice lists therefore need an
application convention, such as a literal JSON string or a separately specified
`choices` subexpression. That is additional field API design.

Ordinary `#other-snippet`, `#skill(review)`, all three XML blocks, Markdown
headings, and shell markers passed through unchanged in the probe. They remain
the snippet application's responsibility. New collisions would be with literal
Handlebars `{{...}}` text. [HTML escaping is enabled by default](https://handlebarsjs.com/guide/expressions.html#html-escaping);
prompt rendering should deliberately use triple braces or the documented
[`noEscape` compile option](https://handlebarsjs.com/api-reference/compilation.html).

## LiquidJS: viable parse hooks, less suitable visual grammar

[`liquidjs`](https://registry.npmjs.org/liquidjs/10.29.0) is the JS/TS implementation;
its [setup documentation](https://liquidjs.com/tutorials/setup.html) shows JS and
TypeScript imports with bundled definitions. Installing Ruby Liquid is not needed.

The table's `field` would be a [registered custom tag](https://liquidjs.com/tutorials/register-filters-tags.html).
Its parse hook receives raw arguments and can construct a `Hash`.
The documented [named-parameter syntax](https://liquidjs.com/tutorials/parse-parameters.html#Parse-Key-Value-Pairs-as-Named-Parameters)
is `{% random from:2, to:max %}`. The helper utility understands key/value pairs;
this is neither an arbitrary function-call expression nor `arg=...` syntax.
Filters instead look like `{{ value | helper: arg1, arg2 }}` and receive the
pipeline value followed by positional arguments.

The parse hook is a natural place to retain field metadata without running its
render hook. LiquidJS also documents [static analysis](https://liquidjs.com/tutorials/static-analysis.html),
including custom-tag traversal methods, but explicitly labels that API and its
returned structures experimental. Variable-use analysis does not itself discover
an application's form schema. Literal-only metadata rules remain necessary.

With stock `{%...%}` and `{{...}}` delimiters, hashes, shell markers, and ordinary
XML do not invoke Liquid syntax; existing literal Liquid examples would need
escaping. This is a grammar inference, not a Bun collision probe. It also retains
the curly-brace/tag appearance that motivated looking beyond Jinja. The custom
tag API is useful, but it offers little advantage for the desired `#` calls.

## Eta and EJS: direct JavaScript, extra work for static fields

Eta's [official site](https://eta.js.org/) identifies it as TypeScript, and the
[`eta` package](https://registry.npmjs.org/eta/4.6.0) publishes JS builds and
TypeScript declarations. Its [template grammar](https://eta.js.org/docs/4.x.x/syntax/template-syntax)
uses `it` for passed data and `<%~ ... %>` for unescaped output. Pass an
application function as `it.field` for the table's declaration.

Eta does have a parser: the [engine exposes `parse`](https://github.com/bgub/eta/blob/main/src/internal.ts),
but its [AST implementation](https://github.com/bgub/eta/blob/main/src/parse.ts)
returns text and `{t, val}` entries, where `val` is JavaScript source. This is
not a parsed JS call tree. Reliably finding literal `field` declarations would
require a JS parser or a constrained declaration grammar. Eta's
[async render API](https://eta.js.org/docs/4.x.x/api/overview#rendering-strings)
can await JS functions, but render-time discovery would execute code before the
form is available and does not satisfy the requirement.

EJS's [official documentation](https://ejs.co/) specifies plain JavaScript inside
`<% ... %>`, escaped output with `<%= ... %>`, raw output with `<%- ... %>`, and
functions supplied through data. The actual package is
[`ejs`](https://registry.npmjs.org/ejs/6.0.1), implemented in JavaScript; that
package metadata declares no bundled `types` entry. Its documented API centers
on `compile`, `render`, and `renderFile`, not a semantic template AST suitable
for field discovery. The official site explicitly documents Bun compatibility
for v6; this research did not run an EJS integration test.

In both engines, `field("branch", {maxLength:20})` passes an object. Writing
`field(arg=1, arg2=2)` uses JavaScript assignment expressions: it can assign
variables or throw, and still passes arguments positionally. It does not gain
named-argument semantics. Configurable delimiters do not fix this distinction.

Hashes, XML blocks, and shell text outside scriptlet tags are ordinary text by
these engines' documented grammars; this was not separately probe-tested.
Eta/EJS scriptlet markers become additional reserved text. Their JS flexibility
is useful for programmable templates, but makes discovery of static form
declarations harder than Handlebars or a dedicated snippet parser.

## Implications for the existing snippet design

Preserve readable composer references such as
`#worktree(branch="demo", goal=yes)` and expand the body only at send. Keep
`#other-snippet`, `#skill(...)`, the XML placement blocks, and shell interpolation
in their existing roles. Composer calls and field declarations are different
operations even if they share a small argument grammar.

For example, an app-defined declaration could eventually resemble
`#field(name="branch", label="Branch name", required=yes, maxLength=20)`.
This is an illustration of the desired **custom snippet syntax**, not stock
Velocity or a settled field API. It can remain inline without frontmatter.

Parse declarations and literal metadata first, build the form, validate its
values, and render/execute effects only at send. Text, multiline, checkboxes
serialized as `yes`/`no`, choices, defaults, requiredness, and length/numeric
constraints all belong to that field API regardless of the chosen engine.
Reserve or disambiguate the field helper name within the existing snippet
namespace. Define which literals are accepted rather than evaluating general
expressions to discover metadata. Document that compact contract in the snippets
skill so an agent can write valid declarations from a plain-language request.

## Focused Bun probe evidence

The isolated probe used Bun 1.3.14, `velocityjs@2.1.7`, and
`handlebars@4.7.9`. It called the exported parsers and rendered with deliberately
simple callbacks. No shell command embedded in a template was executed.

| Input | Exact rendered output or result |
| --- | --- |
| Velocity `#func(1, 2)` with callback JSON-encoding its args | `[1,2]` |
| Velocity `#field("branch", {"label":"Branch name","maxLength":20})` with the same callback | `["branch",{"label":"Branch name","maxLength":20}]` |
| Velocity `#skill("review")` with no registered skill macro | `""` (empty string) |
| Both engines: `#other-snippet <append>X</append> <prepend>Y</prepend> <inject>Z</inject>` | Input preserved exactly |
| Handlebars `#func(arg=1, arg2=2)` | Input preserved as text; no helper invoked |
| Handlebars `#skill(review)` | Input preserved exactly |
| Handlebars `{{field "branch" label="Branch name" maxLength=20}}`, callback JSON-encoding `{name, ...options.hash}`, `noEscape:true` | `{"name":"branch","maxLength":20,"label":"Branch name"}` |

Exact Velocity named-call failure:

```text
Parse error on line 1:
#func(arg=1, arg2=2)
------^
Expecting 'CLOSE_PARENTHESIS', 'DOLLAR', 'MAP_BEGIN', 'SPACE', '-', 'BOOL', 'BRACKET', 'INTEGER', 'STRING', 'EVAL_STRING', got 'ID'
```

`#skill(review)` produced the same expected-token list and `got 'ID'`, with the
pointer `-------^` under the start of `review`.

Exact Handlebars parenthesized-call failure:

```text
Parse error on line 1:
{{field("branch", labe
--^
Expecting 'ID', 'STRING', 'NUMBER', 'BOOLEAN', 'UNDEFINED', 'NULL', 'DATA', got 'INVALID'
```

For input ``"## Heading\n$HOME !`echo $HOME`\n$ command"``, Velocity with
`{HOME:"REPLACED"}` produced ``"REPLACED !`echo REPLACED`\n$ command"``.
Handlebars preserved the entire input. These probes establish the specific
syntax and collision results, not full plugin integration or compatibility with
every engine feature.
