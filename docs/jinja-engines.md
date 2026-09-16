# Jinja engines for snippet fields

## Recommendation

**Nunjucks is the strongest initial candidate for this design.** It combines a
documented template language, loaders, macros, raw blocks, custom helpers and
filters, and an exported parser that can discover `field()` calls without
rendering. Two constraints need a deliberate design decision: its AST is not a
fully documented stable analysis API, and an ordinary `async shell()` helper is
not awaited. Async filters and extensions use a separate callback API.

**There is a real official MiniJinja JavaScript binding: `minijinja-js`.** It is
maintained in Armin Ronacher's MiniJinja repository and published by `mitsuhiko`.
It supports the proposed helper syntax, but its JavaScript API does not expose an
AST. That makes it less suitable when collecting fields before rendering is a
requirement. `@huggingface/jinja` exposes a useful typed AST, but its chat-template
subset omits raw blocks, includes/imports, and custom filters. These findings are
detailed and cited below; no engine has been selected or added to this project.

Use wording such as **“Snippets use Nunjucks, a Jinja-style template language”**
if Nunjucks is chosen. Saying “Python Jinja2 templates” would promise more than
these engines implement. Standard `{{ ... }}`, `{% ... %}`, and `{# ... #}`
delimiters can belong to the selected engine; `field()` and its metadata still
need application documentation. They are custom functions, not standard Jinja
built-ins. Nunjucks explicitly [does not aim for complete Jinja/Python
compatibility](https://mozilla.github.io/nunjucks/api.html#installjinjacompat).

## Feature comparison

| Requirement | Nunjucks | `@huggingface/jinja` | `minijinja-js` |
| --- | --- | --- | --- |
| JS/TS packaging | JavaScript/CommonJS; separate `@types/nunjucks` | TypeScript source; ESM/CommonJS and bundled declarations | Rust/WASM with Node, web and bundler builds; bundled declarations |
| Bun | Focused probe passed | Focused probe passed | Published Node/WASM entry passed |
| Python Jinja2 parity | Explicitly incomplete; optional experimental compatibility layer | Explicitly a minimal chat-template implementation | Broad compatibility with documented differences; JS binding is experimental and narrower than Rust |
| Includes and loaders | Filesystem, custom, web and asynchronous loaders | No include/import statements or loader API | Registered templates and synchronous custom loader |
| Macros/imports | Both | Local macros yes; imports no | Both, with MiniJinja compatibility differences |
| `{% raw %}` | Yes | No in tested version | Yes |
| Custom `field("key", label="...")` | Yes; trailing keyword object | Yes; trailing `Map` whose values are runtime wrappers | Yes; trailing `Map` with plain JS values |
| Custom filters | `addFilter`, including callback-based async filters | Explicitly unimplemented in source | `addFilter`, synchronous |
| AST before rendering | Exported `parser`, `nodes`, `findAll`; incomplete API documentation | Exported `parse`, `tokenize`, public `Template.parsed` | No exposed JS parser/AST API |
| Await an ordinary async JS function | No | No | No |

The table summarizes source inspection, official docs, and the focused probes
below. Bun success here establishes these specific calls, not full application
bundling or every engine feature.

## Nunjucks

- The [official API](https://mozilla.github.io/nunjucks/api.html) documents
  environments, `addGlobal`, `addFilter`, loaders, asynchronous filters and
  extensions. The [template reference](https://mozilla.github.io/nunjucks/templating.html)
  documents macros, imports, includes, raw blocks, and keyword arguments. Its
  [published package](https://registry.npmjs.org/nunjucks/3.2.4) is JavaScript;
  [TypeScript declarations](https://registry.npmjs.org/@types/nunjucks/3.2.6) are
  maintained separately in DefinitelyTyped.
- **Source-verified:** [the entry point exports `parser`, `nodes`, and
  `runtime`](https://github.com/mozilla/nunjucks/blob/2025c933fba374482ef97122514bb36de6bf9de4/nunjucks/index.js#L47-L61).
  [`FunCall`, `KeywordArgs`, and `findAll`](https://github.com/mozilla/nunjucks/blob/2025c933fba374482ef97122514bb36de6bf9de4/nunjucks/src/nodes.js)
  provide a practical way to identify direct field calls and literal arguments.
  The [custom-tag documentation](https://mozilla.github.io/nunjucks/api.html#custom-tags)
  exposes parser operations but explicitly says the parser API needs more
  documentation. Treat an AST collector as a version-sensitive integration;
  export availability is not a documented long-term AST schema guarantee.
- **Probe-verified:** the proposed `field()` call reaches a normal JS function
  with `"branch"` followed by
  `{ label: "Branch name", type: "text", max_length: 20, __keywords: true }`.
  The compiler [emits calls and keyword arguments](https://github.com/mozilla/nunjucks/blob/2025c933fba374482ef97122514bb36de6bf9de4/nunjucks/src/compiler.js#L475-L524).
  The adapter must account for the keyword marker; these are not Python's
  automatic named-to-positional argument bindings.
- **Async limitation:** [asynchronous support](https://mozilla.github.io/nunjucks/api.html#asynchronous-support)
  applies to registered async filters, extensions, and loaders. Returning a
  Promise from a global function does not pause rendering. A `shell()` function
  therefore needs a separately designed evaluation strategy if it performs
  asynchronous work. A documented async filter is an available engine feature,
  but changes the template expression shape.

## Hugging Face Jinja

- The [first-party README](https://github.com/huggingface/huggingface.js/blob/3edf1ba36fe9f2db1e920bf86d7ae89fb5d369c2/packages/jinja/README.md)
  calls this a minimalistic implementation specifically for ML chat templates.
  Its [package metadata](https://registry.npmjs.org/@huggingface/jinja/0.5.10)
  provides ESM/CommonJS entry points and TypeScript declarations; no Python
  runtime is involved.
- **Source-verified:** [`Template` parses in its constructor, stores a public
  `parsed: Program`, and renders separately](https://github.com/huggingface/huggingface.js/blob/3edf1ba36fe9f2db1e920bf86d7ae89fb5d369c2/packages/jinja/src/index.ts).
  `parse`, `tokenize`, `Environment`, and `Interpreter` are exported. A field
  invocation becomes a `CallExpression` with an identifier callee, positional
  literals, and `KeywordArgumentExpression` nodes. This is a convenient typed
  analysis surface, although the README does not promise a stable AST schema.
- **Source- and probe-verified:** [the parser's statement switch](https://github.com/huggingface/huggingface.js/blob/3edf1ba36fe9f2db1e920bf86d7ae89fb5d369c2/packages/jinja/src/parser.ts#L105-L200)
  accepts local macros but rejects `raw`, `include`, and `import`. The public
  template API has no template loader. This is a significant mismatch for the
  goal that authors can look up ordinary Jinja syntax, especially when they
  need raw blocks to quote template examples.
- **Source-verified:** [JS functions are wrapped by converting each runtime
  argument to its `.value`](https://github.com/huggingface/huggingface.js/blob/3edf1ba36fe9f2db1e920bf86d7ae89fb5d369c2/packages/jinja/src/runtime.ts#L2190-L2221).
  This conversion is shallow: keyword arguments reach the helper as a `Map`
  containing `StringValue`/`IntegerValue` wrappers. The proposed call works, but
  an adapter must unwrap metadata. The same synchronous conversion path does
  not await a Promise.
- **Source-verified:** [filter evaluation explicitly leaves user-defined
  filters as a TODO](https://github.com/huggingface/huggingface.js/blob/3edf1ba36fe9f2db1e920bf86d7ae89fb5d369c2/packages/jinja/src/runtime.ts#L1258-L1266).
  Supplying a context function is supported; registering a custom pipe filter
  through the public API is not.

## Official MiniJinja JavaScript/WASM binding

- **Ownership verified:** the [MiniJinja repository's binding](https://github.com/mitsuhiko/minijinja/tree/3d0b4043bf2ebf7ec752f3d79811f27c85c46a84/minijinja-js)
  is named `minijinja-js`. Its [published package metadata](https://registry.npmjs.org/minijinja-js/2.24.0)
  names Armin Ronacher as author, `mitsuhiko` as maintainer, and that repository
  and subdirectory as its source. This is an official **MiniJinja** binding,
  not an official Python Jinja2 JavaScript port.
- The [binding README](https://github.com/mitsuhiko/minijinja/blob/3d0b4043bf2ebf7ec752f3d79811f27c85c46a84/minijinja-js/README.md)
  labels it experimental with limited functionality compared with Rust. It
  documents Node usage, a web build with explicit initialization, registered
  templates, and synchronous loaders. The package includes TypeScript
  declarations and WASM assets; consumers need to preserve those assets when
  packaging the plugin.
- **Source-verified:** [the binding exposes](https://github.com/mitsuhiko/minijinja/blob/3d0b4043bf2ebf7ec752f3d79811f27c85c46a84/minijinja-js/src/lib.rs)
  `addTemplate`, `renderStr`, `renderTemplate`, `evalExpr`, `addGlobal`,
  `addFilter`, `setLoader`, and `setPathJoinCallback`. It converts JS functions
  to callable engine values. The callback bridge serializes arguments and
  immediately converts the return value; it has no Promise-awaiting path.
  `evalExpr` executes an expression; it does not return an AST. Neither this
  source nor the installed package's declarations exposes an AST/parser.
- **Probe-verified:** keyword metadata arrives as a `Map` with plain JS values.
  Includes, imported macros, and custom filters worked together through a
  synchronous JS loader. Raw blocks and local macros also worked.
- The [compatibility document](https://github.com/mitsuhiko/minijinja/blob/3d0b4043bf2ebf7ec752f3d79811f27c85c46a84/COMPATIBILITY.md)
  describes broad Jinja support with differences in runtime values, imports,
  include context modifiers, macro behavior, and filters. Those are upstream
  compatibility claims, not evidence of full Python parity. Source inspection
  used the pinned development revision linked here; the executable probe used
  published `2.24.0`, rather than its `3.0.0-alpha.0` development package.

## Focused Bun probe

A standalone probe used Bun `1.3.14` with published `nunjucks@3.2.4`,
`@huggingface/jinja@0.5.10`, and `minijinja-js@2.24.0`. Dependencies were installed
outside the project. These are observed results, distinct from upstream claims:

| Probe | Result |
| --- | --- |
| Render `{{ field("branch", label="Branch name", type="text", max_length=20) }}` with a JS helper returning `"demo"` | All three produced `demo`; keyword representations differ as detailed above |
| Render `{% raw %}{{ literal }}{% endraw %}` | Nunjucks and MiniJinja produced literal `{{ literal }}`; Hugging Face threw `Unknown statement type: raw` |
| Define a local macro and call it | All three produced `hi demo` |
| Render `{{ shell("echo") }}` where helper returns `Promise.resolve("ASYNC")` | Nunjucks produced `[object Promise]`; Hugging Face and MiniJinja produced `{}`; none awaited it |
| Parse `field(...)` followed by `shell(...)` without rendering | Nunjucks returned `FunCall` names `field`, `shell`; Hugging Face exposed the field call and keyword nodes through `Template.parsed` |
| Register a Nunjucks async filter backed by a Promise and callback | Render produced `ASYNC` |
| Register MiniJinja loader and custom filter; include a template and import its macro | Render produced `PART hi demo OK` |
| Parse Hugging Face include/import | Rejected both with `Unknown statement type` |

The helper/async probe can be reproduced in an isolated Bun project with each
engine's ordinary string-rendering API and the exact expressions above. It is
not a plugin integration test or a general compatibility suite.

## Decisions the engine cannot make

1. **Define statically discoverable declarations.** An AST walk can collect
   direct `field("key", ...)` calls without executing `shell()`. It cannot
   generally determine computed keys, dynamically selected includes, macro
   arguments, or branch-dependent metadata without evaluating expressions.
   Decide whether keys and metadata must be literals, where declarations may
   occur, and how included templates are inspected. Do not discover fields by
   rendering once with dummy answers: that can execute other helpers and only
   visits the branches selected by those answers.
2. **Define repeated-key semantics in the application.** None of these engines
   automatically shares an answer per snippet invocation or reconciles
   conflicting declarations. An invocation answer map and declaration policy
   remain application responsibilities.
3. **Resolve asynchronous `shell()` behavior before selecting an engine.** None
   of the tested engines awaits an ordinary Promise-returning function.
   Nunjucks has documented async extension/filter support; that does not make
   the proposed ordinary function automatically asynchronous.
4. **Choose the compatibility promise.** Name the engine and link its reference.
   If quoting Jinja syntax with raw blocks and using reusable templates matter,
   Nunjucks is a better fit than Hugging Face's subset. If MiniJinja is preferred,
   pre-render declaration discovery still needs a solution compatible with its
   grammar; pairing unrelated parsers is not demonstrated by this research.
5. **Validate the chosen integration next.** Confirm the exact AST nodes used
   for collection and the Bun/package build path, including WASM assets if
   applicable. Types, defaults, validation limits, and OpenTUI form mapping are
   separate design choices; template syntax alone does not implement them.
