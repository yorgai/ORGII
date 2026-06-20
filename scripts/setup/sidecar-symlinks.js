#!/usr/bin/env node

/**
 * Setup Sidecar Symlinks
 *
 * Creates machine-specific symlinks for Tauri sidecar binaries.
 * This script runs automatically during pnpm install (postinstall).
 *
 * Purpose:
 * - Tauri requires external binaries (sidecars) to be bundled with the app
 * - These binaries need to be architecture-specific (e.g., -aarch64-apple-darwin)
 * - We use symlinks pointing to local node binaries to avoid large binary commits
 * - Symlinks are machine-specific and should not be tracked in git
 *
 * Created: 2024-12-31
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ============================================
// Configuration
// ============================================

const PROJECT_ROOT = path.join(__dirname, "..", "..");

// Detect current architecture
function getArchitecture() {
  const platform = process.platform;
  const arch = process.arch;

  // Map Node.js arch names to Rust target triple format
  const archMap = {
    "darwin-arm64": "aarch64-apple-darwin",
    "darwin-x64": "x86_64-apple-darwin",
    "linux-x64": "x86_64-unknown-linux-gnu",
    "linux-arm64": "aarch64-unknown-linux-gnu",
    "win32-x64": "x86_64-pc-windows-msvc",
  };

  const key = `${platform}-${arch}`;
  return archMap[key] || `${arch}-${platform}`;
}

const ARCH = getArchitecture();

// Sidecar configurations
const SIDECARS = [
  {
    name: "ORG2 Helper (Backend)",
    target: process.execPath, // Current Node.js binary path
    path: path.join(PROJECT_ROOT, `ORG2 Helper (Backend)-${ARCH}`),
  },
  {
    name: "ORG2 Helper (Semantic)",
    target: process.execPath, // Current Node.js binary path
    path: path.join(
      PROJECT_ROOT,
      "src-tauri",
      "bin",
      `ORG2 Helper (Semantic)-${ARCH}`
    ),
  },
];

// ============================================
// Helper Functions
// ============================================

/**
 * Check if a path is a symlink
 */
function isSymlink(filePath) {
  try {
    const stats = fs.lstatSync(filePath);
    return stats.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Check if a symlink target exists
 */
function symlinkTargetExists(symlinkPath) {
  try {
    fs.statSync(symlinkPath); // This follows symlinks
    return true;
  } catch {
    return false;
  }
}

/**
 * Create or update a symlink
 */
function createSymlink(linkPath, targetPath, name) {
  // Check if target exists
  if (!fs.existsSync(targetPath)) {
    console.error(`❌ [${name}] Target does not exist: ${targetPath}`);
    return false;
  }

  // If symlink exists and points to correct target, skip
  if (isSymlink(linkPath)) {
    const currentTarget = fs.readlinkSync(linkPath);
    if (currentTarget === targetPath && symlinkTargetExists(linkPath)) {
      console.log(`✅ [${name}] Symlink already correct`);
      return true;
    }

    // Remove broken or incorrect symlink
    console.log(`🔄 [${name}] Updating incorrect symlink...`);
    fs.unlinkSync(linkPath);
  } else if (fs.existsSync(linkPath)) {
    // Remove regular file if it exists
    console.log(`🔄 [${name}] Removing existing file...`);
    fs.unlinkSync(linkPath);
  }

  // Create symlink
  try {
    // Ensure directory exists
    const dir = path.dirname(linkPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.symlinkSync(targetPath, linkPath);
    console.log(`✅ [${name}] Created symlink: ${linkPath} -> ${targetPath}`);
    return true;
  } catch (error) {
    console.error(`❌ [${name}] Failed to create symlink:`, error.message);
    return false;
  }
}

// ============================================
// Main
// ============================================

function main() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Setup Sidecar Symlinks");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  console.log(`📍 Architecture: ${ARCH}`);
  console.log(`📍 Node.js: ${process.execPath}\n`);

  let allSuccess = true;

  for (const sidecar of SIDECARS) {
    const success = createSymlink(sidecar.path, sidecar.target, sidecar.name);
    if (!success) {
      allSuccess = false;
    }
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  if (!allSuccess) {
    console.error(
      "⚠️  Some symlinks failed to create. Please check the errors above."
    );
    process.exit(0); // Don't fail dependency installation, but log the issue
  } else {
    console.log("✅ All sidecar symlinks configured successfully!\n");
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { main };
