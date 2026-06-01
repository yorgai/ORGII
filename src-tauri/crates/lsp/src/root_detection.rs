//! Project Root Detection for LSP Servers
//!
//! Walks up the directory tree from a file to find the appropriate workspace root
//! for an LSP server. Supports include/exclude patterns for smart detection
//! (e.g., distinguishing TypeScript projects from Deno projects).

use std::path::{Path, PathBuf};

/// Patterns used to find a workspace root.
#[derive(Debug, Clone)]
pub struct RootPattern {
    /// Marker files that indicate a workspace root (e.g., `package.json`, `Cargo.toml`).
    pub include: &'static [&'static str],
    /// Marker files that should stop and exclude this directory (e.g., `deno.json` for TS).
    pub exclude: &'static [&'static str],
}

impl Default for RootPattern {
    fn default() -> Self {
        Self::DEFAULT
    }
}

impl RootPattern {
    const DEFAULT: Self = Self {
        include: &[],
        exclude: &[],
    };
}

/// Walk up from `file`'s parent directory looking for include markers.
/// Returns `None` if an exclude marker is found first.
/// Stops searching at `stop_at` boundary (usually workspace root).
///
/// # Arguments
/// * `file` - The file path to find the root for
/// * `pattern` - Include/exclude patterns for this language
/// * `stop_at` - Upper boundary to stop searching (typically workspace root)
///
/// # Returns
/// * `Some(PathBuf)` - The detected workspace root
/// * `None` - No root found or an exclude marker was hit first
pub fn find_nearest_root(file: &Path, pattern: &RootPattern, stop_at: &Path) -> Option<PathBuf> {
    // Start from the file's parent directory
    let mut current = file.parent()?;

    // Normalize stop_at to handle relative paths
    let stop_at = stop_at
        .canonicalize()
        .unwrap_or_else(|_| stop_at.to_path_buf());

    loop {
        // Check for exclude markers first - if found, stop and return None
        for exclude in pattern.exclude {
            if current.join(exclude).exists() {
                return None;
            }
        }

        // Check for include markers
        for include in pattern.include {
            if current.join(include).exists() {
                return Some(current.to_path_buf());
            }
        }

        // Move up to parent
        let parent = current.parent()?;

        // Check if we've reached or passed the stop boundary
        let current_normalized = current
            .canonicalize()
            .unwrap_or_else(|_| current.to_path_buf());
        if current_normalized == stop_at || !current_normalized.starts_with(&stop_at) {
            break;
        }

        current = parent;
    }

    None
}

/// Find the nearest root, but also check for workspace-level markers (e.g., `go.work`, `Cargo.toml` with `[workspace]`).
/// Some languages have multi-project workspace support where the root should be the workspace, not the subproject.
pub fn find_workspace_root(
    file: &Path,
    project_pattern: &RootPattern,
    workspace_markers: &[&str],
    stop_at: &Path,
) -> Option<PathBuf> {
    // First find the immediate workspace root
    let workspace_root = find_nearest_root(file, project_pattern, stop_at)?;

    // Then look for workspace markers above the workspace root
    let mut current = workspace_root.parent()?;
    let stop_at_normalized = stop_at
        .canonicalize()
        .unwrap_or_else(|_| stop_at.to_path_buf());

    loop {
        for marker in workspace_markers {
            if current.join(marker).exists() {
                return Some(current.to_path_buf());
            }
        }

        let parent = current.parent()?;
        let current_normalized = current
            .canonicalize()
            .unwrap_or_else(|_| current.to_path_buf());

        if current_normalized == stop_at_normalized
            || !current_normalized.starts_with(&stop_at_normalized)
        {
            break;
        }

        current = parent;
    }

    // No workspace found, return the workspace root
    Some(workspace_root)
}

// ============================================
// Common Patterns
// ============================================

/// TypeScript/JavaScript workspace root pattern.
/// Excludes Deno projects (they use `deno.json`).
pub const TYPESCRIPT_PATTERN: RootPattern = RootPattern {
    include: &["package.json", "tsconfig.json", "jsconfig.json"],
    exclude: &["deno.json", "deno.jsonc"],
};

/// Go workspace root pattern.
pub const GO_PATTERN: RootPattern = RootPattern {
    include: &["go.mod"],
    exclude: &[],
};

/// Go workspace markers (for multi-module workspaces).
pub const GO_WORKSPACE_MARKERS: &[&str] = &["go.work"];

/// Rust workspace root pattern.
pub const RUST_PATTERN: RootPattern = RootPattern {
    include: &["Cargo.toml"],
    exclude: &[],
};

/// Python workspace root pattern.
pub const PYTHON_PATTERN: RootPattern = RootPattern {
    include: &[
        "pyproject.toml",
        "setup.py",
        "setup.cfg",
        "requirements.txt",
        "Pipfile",
        "poetry.lock",
        ".python-version",
    ],
    exclude: &[],
};

/// C/C++ workspace root pattern.
pub const CPP_PATTERN: RootPattern = RootPattern {
    include: &[
        "compile_commands.json",
        "CMakeLists.txt",
        "Makefile",
        "configure.ac",
        "meson.build",
        ".clangd",
    ],
    exclude: &[],
};

/// Java/Kotlin workspace root pattern.
pub const JAVA_PATTERN: RootPattern = RootPattern {
    include: &[
        "pom.xml",
        "build.gradle",
        "build.gradle.kts",
        "settings.gradle",
        "settings.gradle.kts",
    ],
    exclude: &[],
};

/// C# / .NET workspace root pattern.
pub const CSHARP_PATTERN: RootPattern = RootPattern {
    include: &["*.csproj", "*.sln", "global.json"],
    exclude: &[],
};

/// PHP workspace root pattern.
pub const PHP_PATTERN: RootPattern = RootPattern {
    include: &["composer.json"],
    exclude: &[],
};

/// Ruby workspace root pattern.
pub const RUBY_PATTERN: RootPattern = RootPattern {
    include: &["Gemfile", "*.gemspec"],
    exclude: &[],
};

/// Swift workspace root pattern.
pub const SWIFT_PATTERN: RootPattern = RootPattern {
    include: &["Package.swift", "*.xcodeproj", "*.xcworkspace"],
    exclude: &[],
};

/// Elixir workspace root pattern.
pub const ELIXIR_PATTERN: RootPattern = RootPattern {
    include: &["mix.exs"],
    exclude: &[],
};

/// Zig workspace root pattern.
pub const ZIG_PATTERN: RootPattern = RootPattern {
    include: &["build.zig", "build.zig.zon"],
    exclude: &[],
};

/// Generic fallback - looks for common VCS/config markers.
pub const GENERIC_PATTERN: RootPattern = RootPattern {
    include: &[".git", ".hg", ".svn"],
    exclude: &[],
};

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_find_nearest_root_basic() {
        let temp = TempDir::new().unwrap();
        let project_dir = temp.path().join("project");
        let src_dir = project_dir.join("src");
        fs::create_dir_all(&src_dir).unwrap();

        // Create package.json marker
        fs::write(project_dir.join("package.json"), "{}").unwrap();

        // Create a source file
        let file = src_dir.join("index.ts");
        fs::write(&file, "").unwrap();

        let root = find_nearest_root(&file, &TYPESCRIPT_PATTERN, temp.path());
        assert_eq!(root, Some(project_dir));
    }

    #[test]
    fn test_find_nearest_root_exclude() {
        let temp = TempDir::new().unwrap();
        let project_dir = temp.path().join("deno-project");
        let src_dir = project_dir.join("src");
        fs::create_dir_all(&src_dir).unwrap();

        // Create both package.json and deno.json (Deno project)
        fs::write(project_dir.join("package.json"), "{}").unwrap();
        fs::write(project_dir.join("deno.json"), "{}").unwrap();

        let file = src_dir.join("mod.ts");
        fs::write(&file, "").unwrap();

        // Should return None because deno.json is an exclude marker
        let root = find_nearest_root(&file, &TYPESCRIPT_PATTERN, temp.path());
        assert_eq!(root, None);
    }

    #[test]
    fn test_find_nearest_root_stops_at_boundary() {
        let temp = TempDir::new().unwrap();
        let workspace = temp.path().join("workspace");
        let project = workspace.join("packages/app");
        let src = project.join("src");
        fs::create_dir_all(&src).unwrap();

        // package.json only at workspace level, not in project
        fs::write(workspace.join("package.json"), "{}").unwrap();

        let file = src.join("index.ts");
        fs::write(&file, "").unwrap();

        // Stop at project level - should not find package.json
        let root = find_nearest_root(&file, &TYPESCRIPT_PATTERN, &project);
        assert_eq!(root, None);

        // Stop at workspace level - should find package.json
        let root = find_nearest_root(&file, &TYPESCRIPT_PATTERN, &workspace);
        assert_eq!(root, Some(workspace));
    }

    #[test]
    fn test_find_workspace_root_go() {
        let temp = TempDir::new().unwrap();
        let workspace = temp.path().join("go-workspace");
        let module = workspace.join("cmd/app");
        let src = module.join("internal");
        fs::create_dir_all(&src).unwrap();

        // go.work at workspace level
        fs::write(workspace.join("go.work"), "go 1.21\n").unwrap();
        // go.mod in submodule
        fs::write(module.join("go.mod"), "module example.com/app\n").unwrap();

        let file = src.join("main.go");
        fs::write(&file, "").unwrap();

        let root = find_workspace_root(&file, &GO_PATTERN, GO_WORKSPACE_MARKERS, temp.path());
        assert_eq!(root, Some(workspace));
    }
}
