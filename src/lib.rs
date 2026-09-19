use std::{env, fs};

use zed::settings::LspSettings;
use zed_extension_api::{self as zed};

const LANGUAGE_SERVER_ID: &str = "gherkin-lsp";
const SERVER_PATH: &str = "gherkin-lsp.cjs";
const SERVER_SOURCE: &str = include_str!("../server/gherkin-lsp.cjs");

/// Writes the embedded language server next to the extension assets
/// and returns its path. The server is a zero-dependency Node script
/// (see server/gherkin-lsp.cjs), so no npm install is required.
fn write_server() -> zed::Result<String> {
    fs::write(SERVER_PATH, SERVER_SOURCE).map_err(|e| e.to_string())?;
    Ok(SERVER_PATH.to_string())
}

struct GherkinExtension;

impl zed::Extension for GherkinExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> zed::Result<zed::Command> {
        let lsp_settings = LspSettings::for_worktree(LANGUAGE_SERVER_ID, worktree).ok();

        // 1. Binary explicitly configured in settings
        //    (`lsp.gherkin-lsp.binary.path`).
        if let Some(binary) = lsp_settings.as_ref().and_then(|s| s.binary.as_ref()) {
            if let Some(path) = binary.path.clone() {
                return Ok(zed::Command {
                    command: path,
                    args: binary
                        .arguments
                        .clone()
                        .unwrap_or_else(|| vec!["--stdio".into()]),
                    env: Default::default(),
                });
            }
        }

        // 2. Run the embedded server with Zed's bundled Node.
        let script_path = write_server()?;
        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![
                env::current_dir()
                    .unwrap()
                    .join(&script_path)
                    .to_string_lossy()
                    .to_string(),
                "--stdio".into(),
            ],
            env: Default::default(),
        })
    }

    fn language_server_initialization_options(
        &mut self,
        _language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> zed::Result<Option<zed::serde_json::Value>> {
        let initialization_options = LspSettings::for_worktree(LANGUAGE_SERVER_ID, worktree)
            .ok()
            .and_then(|settings| settings.initialization_options.clone())
            .unwrap_or_else(|| default_settings());
        Ok(Some(initialization_options))
    }

    fn language_server_workspace_configuration(
        &mut self,
        _language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> zed::Result<Option<zed::serde_json::Value>> {
        // The server requests the `gherkin` configuration section, so the
        // value is the section's content (not wrapped in {"gherkin": ...}).
        let settings = LspSettings::for_worktree(LANGUAGE_SERVER_ID, worktree)
            .ok()
            .and_then(|lsp_settings| lsp_settings.settings.clone())
            .unwrap_or_else(default_settings);
        Ok(Some(settings))
    }
}

fn default_settings() -> zed::serde_json::Value {
    zed::serde_json::json!({
        "features": [
            "features/**/*.feature",
            "openspec/**/features/**/*.feature",
            "tests/**/*.feature"
        ],
        "glue": [
            "features/steps/**/*.py",
            "tests/bdd/steps/**/*.py",
            "steps/**/*.py"
        ]
    })
}

zed::register_extension!(GherkinExtension);
