/**
 * FileService - Singleton File Management Service
 *
 * Provides file operations shared by both AI and UI.
 *
 * Usage:
 *   import { FileService } from "@src/services/file";
 *   await FileService.open("/path/to/file.ts");
 */
import { invoke } from "@tauri-apps/api/core";
import {
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  writeTextFile,
} from "@tauri-apps/plugin-fs";

import {
  type FileNode,
  fileContentAtom,
  fileContentErrorAtom,
  fileIsBinaryAtom,
  fileLoadingContentAtom,
  fileLoadingTreeAtom,
  fileMarkSavedAtom,
  fileRepoPathAtom,
  fileSaveErrorAtom,
  fileSavedContentAtom,
  fileSavingAtom,
  fileSelectedPathAtom,
  fileTreeAtom,
  fileTreeErrorAtom,
} from "@src/store/workstation/codeEditor/file";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";
import {
  getBinaryFileMessage,
  isBinaryByExtension,
  isBinaryContent,
} from "@src/util/file/binaryDetection";
import { createGitignoreChecker } from "@src/util/file/gitignoreParser";

// ============================================
// Jotai Store Access (uses app's instrumented store)
// ============================================

const getStore = () => getInstrumentedStore();

// ============================================
// Gitignore Cache (module-level singleton)
// ============================================

let gitignoreChecker: {
  isIgnored: (relativePath: string) => boolean;
  refresh: () => Promise<void>;
} | null = null;
let gitignoreRepoPath: string | null = null;

// ============================================
// Helper Functions
// ============================================

interface RustDirEntry {
  name: string;
  path: string;
  type: "directory" | "file";
  isSymlink: boolean;
  isIgnored: boolean;
}

/**
 * Load directory contents via Rust (single invoke: readdir + stat + gitignore + sort).
 * Falls back to TS-side readDir if the Rust command is unavailable.
 */
async function loadDirectoryContents(
  dirPath: string,
  repoPath?: string
): Promise<FileNode[]> {
  try {
    const entries = await invoke<RustDirEntry[]>("list_directory_filtered", {
      dirPath,
      repoPath: repoPath ?? null,
      gitignorePatterns: null,
    });

    return entries.map((entry) => ({
      name: entry.name,
      path: entry.path,
      type: entry.type,
      expanded: false,
      children: entry.type === "directory" ? [] : undefined,
      isSymlink: entry.isSymlink,
      isIgnored: entry.isIgnored,
    }));
  } catch {
    const entries = await readDir(dirPath);
    const nodes: FileNode[] = entries.map((entry) => ({
      name: entry.name,
      path: `${dirPath}/${entry.name}`,
      type: entry.isDirectory ? "directory" : ("file" as const),
      expanded: false,
      children: entry.isDirectory ? [] : undefined,
      isSymlink: entry.isSymlink,
      isIgnored: false,
    }));
    return nodes.sort((left, right) => {
      if (left.type === right.type) return left.name.localeCompare(right.name);
      return left.type === "directory" ? -1 : 1;
    });
  }
}

function updateTreeExpansion(
  tree: FileNode[],
  targetPath: string,
  expand: boolean,
  children?: FileNode[]
): FileNode[] {
  return tree.map((node) => {
    if (node.path === targetPath && node.type === "directory") {
      return { ...node, expanded: expand, children: children ?? node.children };
    }
    if (node.children) {
      return {
        ...node,
        children: updateTreeExpansion(
          node.children,
          targetPath,
          expand,
          children
        ),
      };
    }
    return node;
  });
}

function findNodeInTree(tree: FileNode[], targetPath: string): FileNode | null {
  for (const node of tree) {
    if (node.path === targetPath) return node;
    if (node.children) {
      const found = findNodeInTree(node.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}

// ============================================
// FileService - Singleton API
// ============================================

export const FileService = {
  /**
   * Initialize with repo path
   */
  setRepoPath(repoPath: string): void {
    getStore().set(fileRepoPathAtom, repoPath);
  },

  /**
   * Get current repo path
   */
  getRepoPath(): string {
    return getStore().get(fileRepoPathAtom);
  },

  /**
   * Open a file in the editor
   */
  async open(path: string): Promise<void> {
    const store = getStore();
    store.set(fileSelectedPathAtom, path);
    store.set(fileLoadingContentAtom, true);
    store.set(fileContentErrorAtom, null);
    store.set(fileIsBinaryAtom, false);

    try {
      // Check for binary
      if (isBinaryByExtension(path)) {
        const message = getBinaryFileMessage();
        store.set(fileIsBinaryAtom, true);
        store.set(fileContentAtom, message);
        store.set(fileSavedContentAtom, message);
        return;
      }

      const content = await readTextFile(path);

      // Check content for binary
      if (isBinaryContent(content)) {
        const message = getBinaryFileMessage();
        store.set(fileIsBinaryAtom, true);
        store.set(fileContentAtom, message);
        store.set(fileSavedContentAtom, message);
        return;
      }

      store.set(fileIsBinaryAtom, false);
      store.set(fileContentAtom, content);
      store.set(fileSavedContentAtom, content);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to read file";
      store.set(fileContentErrorAtom, message);
      console.error("[FileService] Failed to open:", error);
    } finally {
      store.set(fileLoadingContentAtom, false);
    }
  },

  /**
   * Save a file
   */
  async save(path?: string, content?: string): Promise<boolean> {
    const store = getStore();
    const filePath = path ?? store.get(fileSelectedPathAtom);
    const fileContent = content ?? store.get(fileContentAtom);

    if (!filePath) {
      console.error("[FileService] No file to save");
      return false;
    }

    store.set(fileSavingAtom, true);
    store.set(fileSaveErrorAtom, null);

    try {
      await writeTextFile(filePath, fileContent);
      store.set(fileMarkSavedAtom);
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save file";
      store.set(fileSaveErrorAtom, message);
      console.error("[FileService] Failed to save:", error);
      return false;
    } finally {
      store.set(fileSavingAtom, false);
    }
  },

  /**
   * Load the file tree
   */
  async loadTree(repoPath?: string): Promise<void> {
    const store = getStore();
    const path = repoPath ?? store.get(fileRepoPathAtom);
    if (!path) {
      store.set(fileTreeErrorAtom, "No repo path");
      return;
    }

    store.set(fileLoadingTreeAtom, true);
    store.set(fileTreeErrorAtom, null);

    try {
      // Initialize or refresh gitignore checker for this repo
      if (gitignoreRepoPath !== path || !gitignoreChecker) {
        gitignoreChecker = await createGitignoreChecker(path);
        gitignoreRepoPath = path;
      } else {
        // Refresh patterns in case .gitignore changed
        await gitignoreChecker.refresh();
      }

      const tree = await loadDirectoryContents(path, path);
      store.set(fileTreeAtom, tree);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load file tree";
      store.set(fileTreeErrorAtom, message);
      console.error("[FileService] Failed to load tree:", error);
    } finally {
      store.set(fileLoadingTreeAtom, false);
    }
  },

  /**
   * Refresh the file tree
   */
  async refresh(): Promise<void> {
    await this.loadTree();
  },

  /**
   * Toggle directory expanded state
   */
  async toggleDirectory(path: string): Promise<void> {
    const store = getStore();
    const tree = store.get(fileTreeAtom);
    const repoPath = store.get(fileRepoPathAtom);
    const node = findNodeInTree(tree, path);

    if (!node || node.type !== "directory") return;

    if (node.expanded) {
      // Collapse
      const updated = updateTreeExpansion(tree, path, false);
      store.set(fileTreeAtom, updated);
    } else {
      // Expand - load children if empty
      let children = node.children ?? [];
      if (children.length === 0) {
        try {
          children = await loadDirectoryContents(path, repoPath || undefined);
        } catch (error) {
          console.error("[FileService] Failed to load directory:", error);
          return;
        }
      }
      const updated = updateTreeExpansion(tree, path, true, children);
      store.set(fileTreeAtom, updated);
    }
  },

  /**
   * Reveal a file or directory in the explorer.
   */
  async reveal(
    filePath: string,
    options?: { expandTargetDirectory?: boolean }
  ): Promise<void> {
    const store = getStore();
    const repoPath = store.get(fileRepoPathAtom);
    if (!repoPath || !filePath.startsWith(repoPath)) return;

    const relativePath = filePath.replace(repoPath + "/", "");
    const segments = relativePath.split("/").filter(Boolean);
    const lastDirectoryIndex = options?.expandTargetDirectory
      ? segments.length
      : segments.length - 1;

    let currentPath = repoPath;
    for (
      let segmentIndex = 0;
      segmentIndex < lastDirectoryIndex;
      segmentIndex++
    ) {
      currentPath += "/" + segments[segmentIndex];
      const tree = store.get(fileTreeAtom);
      const node = findNodeInTree(tree, currentPath);
      if (node && node.type === "directory" && !node.expanded) {
        await this.toggleDirectory(currentPath);
      }
    }

    store.set(fileSelectedPathAtom, filePath);
  },

  /**
   * Reveal a file in the OS file manager (Finder on macOS, Explorer on Windows)
   */
  async revealInFinder(filePath: string): Promise<boolean> {
    try {
      await invoke("show_in_folder", { path: filePath });
      return true;
    } catch (error) {
      console.error("[FileService] Failed to reveal in Finder:", error);
      return false;
    }
  },

  /**
   * Get selected file path
   */
  getSelectedFile(): string | null {
    return getStore().get(fileSelectedPathAtom);
  },

  /**
   * Get current file content
   */
  getContent(): string {
    return getStore().get(fileContentAtom);
  },

  /**
   * Update file content (from editor)
   */
  updateContent(content: string): void {
    getStore().set(fileContentAtom, content);
  },

  /**
   * Discard unsaved changes
   */
  discard(): void {
    const store = getStore();
    const saved = store.get(fileSavedContentAtom);
    store.set(fileContentAtom, saved);
  },

  /**
   * Collapse all directories
   */
  collapseAll(): void {
    const store = getStore();
    const tree = store.get(fileTreeAtom);
    const collapseRecursive = (nodes: FileNode[]): FileNode[] =>
      nodes.map((node) => ({
        ...node,
        expanded: false,
        children: node.children ? collapseRecursive(node.children) : undefined,
      }));
    store.set(fileTreeAtom, collapseRecursive(tree));
  },

  /**
   * Create a new file with optional content
   */
  async create(path: string, content: string = ""): Promise<boolean> {
    try {
      // Ensure parent directory exists
      const parentPath = path.substring(0, path.lastIndexOf("/"));
      if (parentPath) {
        try {
          await mkdir(parentPath, { recursive: true });
        } catch {
          // Directory might already exist, that's fine
        }
      }

      await writeTextFile(path, content);
      // Refresh tree to show new file
      await this.refresh();

      // Open the new file in editor
      await this.open(path);

      return true;
    } catch (error) {
      console.error("[FileService] Failed to create:", error);
      return false;
    }
  },

  /**
   * Delete a file or directory
   */
  async delete(path: string): Promise<boolean> {
    const store = getStore();
    const selectedPath = store.get(fileSelectedPathAtom);

    try {
      await remove(path, { recursive: true });
      // If deleted file was selected, clear selection
      if (selectedPath === path) {
        store.set(fileSelectedPathAtom, null);
        store.set(fileContentAtom, "");
        store.set(fileSavedContentAtom, "");
      }

      // Refresh tree to reflect deletion
      await this.refresh();

      return true;
    } catch (error) {
      console.error("[FileService] Failed to delete:", error);
      return false;
    }
  },

  /**
   * Rename a file or directory
   */
  async rename(oldPath: string, newPath: string): Promise<boolean> {
    const store = getStore();
    const selectedPath = store.get(fileSelectedPathAtom);

    try {
      await rename(oldPath, newPath);
      // If renamed file was selected, update selection
      if (selectedPath === oldPath) {
        store.set(fileSelectedPathAtom, newPath);
      }

      // Refresh tree to reflect rename
      await this.refresh();

      return true;
    } catch (error) {
      console.error("[FileService] Failed to rename:", error);
      return false;
    }
  },
};

export default FileService;
