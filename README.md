# gherkin (zed extension)

Zed extension for BDD Gherkin (`.feature`) files. Published as **`gherkin`** in the
Zed extension registry (id `gherkin`, LSP id `gherkin-lsp`).

## Features

- Syntax highlighting via [tree-sitter-gherkin](https://github.com/binhtddev/tree-sitter-gherkin)
  (a maintained port of the official Cucumber grammar):
  - localized keywords (`# language: ru` → `Функциональность`, `Сценарий`, `Допустим`, …)
  - `Feature` / `Rule` / `Background` / `Scenario` / `Scenario Outline` / `Examples`
  - tags, doc strings (`"""` / ` ``` `), data tables, `<placeholders>`
- Outline panel support (features, rules, scenarios)
- Code folding for blocks, doc strings and data tables
- Auto-indent inside features, rules, scenarios and examples
- Language injection into typed doc strings (`"""xml … """` highlights as XML)
- Built-in LSP **gherkin-lsp** (zero-dependency Node server, bundled with the
  extension — no npm install):
  - `Undefined step` diagnostics against behave (`@given/@when/@then/@step`) glue
  - step autocompletion from step definitions
  - go-to-definition: step → `.py` glue file/line
  - document outline (features/rules/scenarios) and table formatting
  - resolves all paths from the LSP `rootUri` (no cwd dependency)
  - accepts `@Given` in any case, `r"…"`/`'…'`/`f"…"` strings, `parse(...)` is not
    yet supported

## Install (dev)

```sh
git clone <this repo> && cd zed-gherkin
zed .
```

Then in Zed: `Extensions` → `Install Dev Extension` → select this folder.

The language server ships inside the extension and runs on Zed's bundled
Node.js. Nothing to install.

## LSP configuration

Defaults cover common layouts (`features/`, `openspec/`, `tests/bdd/steps`).
To point the server at your own feature files and behave glue:

```json
// ~/AppData/.../settings.json or ~/.config/zed/settings.json
{
  "lsp": {
    "gherkin-lsp": {
      "settings": {
        "features": ["openspec/**/features/**/*.feature"],
        "glue": ["tests/bdd/steps/*.py"]
      }
    }
  }
}
```

The `gherkin` section is passed straight to the language server. Glue supports
any `@given/@when/@then/@step` regular expressions (behave `use_step_matcher("re")`).

To use a specific binary instead of the auto-installed one:

```json
{
  "lsp": {
    "gherkin-lsp": {
      "binary": {
        "path": "/path/to/custom/gherkin-lsp",
        "arguments": ["--stdio"]
      }
    }
  }
}
```

## License

MIT
