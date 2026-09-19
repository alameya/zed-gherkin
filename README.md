# zed-gherkin

Zed extension for BDD Gherkin (`.feature`) files.

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
- LSP via [`@cucumber/language-server`](https://www.npmjs.com/package/@cucumber/language-server):
  syntax error checking, step autocompletion, formatting, quickfixes

## Install (dev)

```sh
git clone <this repo> && cd zed-gherkin
zed .
```

Then in Zed: `Extensions` → `Install Dev Extension` → select this folder.

The language server is installed automatically (npm) and run with Zed's bundled
Node.js. No manual setup required.

## LSP configuration

Defaults are enough for pure Gherkin editing (syntax errors, formatting). To get
step autocompletion from your step definitions, point the server at your glue:

```json
// ~/AppData/.../settings.json or ~/.config/zed/settings.json
{
  "lsp": {
    "cucumber-language-server": {
      "settings": {
        "cucumber": {
          "features": ["features/**/*.feature"],
          "glue": ["features/step_definitions/**/*.ts"]
        }
      }
    }
  }
}
```

The `cucumber` section is passed straight to the language server, so any
[cucumber-language-server setting](https://github.com/cucumber/language-server#settings)
works (e.g. `parameterTypes`, `snippets`).

To use a specific binary instead of the auto-installed one:

```json
{
  "lsp": {
    "cucumber-language-server": {
      "binary": {
        "path": "/usr/bin/cucumber-language-server",
        "arguments": ["--stdio"]
      }
    }
  }
}
```

## License

MIT
