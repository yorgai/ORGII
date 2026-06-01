/**
 * SQLite File Validation
 *
 * Delegates to the Rust `db_is_valid_sqlite_file` command which reads
 * the 16-byte SQLite header without loading a WASM binary.
 */
import { invoke } from "@tauri-apps/api/core";

export async function isValidSqliteFile(filePath: string): Promise<boolean> {
  return invoke<boolean>("db_is_valid_sqlite_file", { filePath });
}
