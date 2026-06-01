//! Tantivy Full-Text Search Index
//!
//! Provides fast full-text search using Tantivy.
//! Pre-indexes code files for instant search across large codebases.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tantivy::collector::TopDocs;
use tantivy::query::{BooleanQuery, QueryParser, TermQuery};
use tantivy::schema::*;
use tantivy::tokenizer::{NgramTokenizer, TextAnalyzer};
use tantivy::{doc, Index, IndexReader, IndexWriter, ReloadPolicy, TantivyDocument, Term};

use super::bytes_filter::BytesFilterCollector;

// ============================================
// Schema Definition
// ============================================

/// Schema for indexing code files
#[derive(Clone)]
pub struct CodeSchema {
    pub schema: Schema,
    pub unique_id: Field,
    pub repo_id: Field,
    pub repo_path: Field,
    pub relative_path: Field,
    pub file_name: Field,
    pub content: Field,
    pub language: Field,
    pub symbols: Field,
    pub line_count: Field,
    // Fast fields for efficient filtering
    pub raw_content: Field,
    pub raw_relative_path: Field,
}

impl CodeSchema {
    pub fn new() -> Self {
        let mut builder = Schema::builder();

        // Unique identifier for the file
        let unique_id = builder.add_text_field("unique_id", STRING | STORED);

        // Repository ID (UUID from frontend)
        let repo_id = builder.add_text_field("repo_id", STRING | STORED);

        // Repository root path (for backwards compatibility)
        let repo_path = builder.add_text_field("repo_path", STRING | STORED);

        // Trigram text options for better partial matching
        // This breaks text into 3-character overlapping sequences
        let trigram_options = TextOptions::default().set_stored().set_indexing_options(
            TextFieldIndexing::default()
                .set_tokenizer("trigram")
                .set_index_option(IndexRecordOption::WithFreqsAndPositions),
        );

        // Path relative to repo root (with trigram indexing)
        let relative_path = builder.add_text_field("relative_path", trigram_options.clone());

        // Just the filename (with trigram indexing)
        let file_name = builder.add_text_field("file_name", trigram_options.clone());

        // Full file content for searching (with trigram indexing)
        let content = builder.add_text_field("content", trigram_options.clone());

        // Programming language
        let language = builder.add_text_field("language", STRING | STORED);

        // Extracted symbol names (functions, classes, etc.) (with trigram indexing)
        let symbols = builder.add_text_field("symbols", trigram_options);

        // Line count
        let line_count = builder.add_u64_field("line_count", STORED);

        // Fast fields for efficient regex filtering
        // These store raw bytes and can be accessed quickly during search
        let raw_content = builder.add_bytes_field("raw_content", FAST);
        let raw_relative_path = builder.add_bytes_field("raw_relative_path", FAST);

        Self {
            schema: builder.build(),
            unique_id,
            repo_id,
            repo_path,
            relative_path,
            file_name,
            content,
            language,
            symbols,
            line_count,
            raw_content,
            raw_relative_path,
        }
    }
}

impl Default for CodeSchema {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================
// Index Manager
// ============================================

/// Manages Tantivy indexes for code search
pub struct CodeIndex {
    index: Index,
    schema: CodeSchema,
    reader: IndexReader,
    writer: Arc<Mutex<IndexWriter>>,
    index_path: PathBuf,
}

impl CodeIndex {
    /// Create or open an index at the specified path
    pub fn open_or_create(index_path: &Path) -> Result<Self> {
        let schema = CodeSchema::new();

        // Create index directory if it doesn't exist
        fs::create_dir_all(index_path)?;

        // Try to open existing index, or create new one
        let index = if index_path.join("meta.json").exists() {
            match Index::open_in_dir(index_path) {
                Ok(idx) => {
                    // Verify schema compatibility
                    if idx.schema() != schema.schema {
                        tracing::warn!(
                            "Index schema mismatch detected. Deleting old index and creating new one."
                        );
                        // Delete the old index
                        if let Err(e) = fs::remove_dir_all(index_path) {
                            tracing::error!("Failed to remove old index: {}", e);
                        }
                        // Recreate directory and index
                        fs::create_dir_all(index_path)?;
                        Index::create_in_dir(index_path, schema.schema.clone())
                            .context("Failed to create new index after schema mismatch")?
                    } else {
                        idx
                    }
                }
                Err(e) => {
                    tracing::warn!("Failed to open existing index: {}. Creating new one.", e);
                    // Delete corrupted index
                    if let Err(e) = fs::remove_dir_all(index_path) {
                        tracing::error!("Failed to remove corrupted index: {}", e);
                    }
                    // Recreate directory and index
                    fs::create_dir_all(index_path)?;
                    Index::create_in_dir(index_path, schema.schema.clone())
                        .context("Failed to create new index after corruption")?
                }
            }
        } else {
            Index::create_in_dir(index_path, schema.schema.clone())
                .context("Failed to create new index")?
        };

        // Register trigram tokenizer for partial matching
        // Trigrams break text into 3-character overlapping sequences
        // e.g., "hello" -> ["hel", "ell", "llo"]
        let trigram_tokenizer =
            TextAnalyzer::builder(NgramTokenizer::new(3, 3, false).unwrap()).build();
        index.tokenizers().register("trigram", trigram_tokenizer);

        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::OnCommitWithDelay)
            .try_into()
            .context("Failed to create index reader")?;

        // Use 50MB heap for writer
        let writer = index
            .writer(50_000_000)
            .context("Failed to create index writer")?;

        Ok(Self {
            index,
            schema,
            reader,
            writer: Arc::new(Mutex::new(writer)),
            index_path: index_path.to_path_buf(),
        })
    }

    /// Get the default index path for the application
    pub fn default_index_path() -> PathBuf {
        app_paths::tantivy_index_dir()
    }

    /// Index a single file
    pub fn index_file(
        &self,
        repo_id: &str,
        repo_path: &Path,
        file_path: &Path,
        content: &str,
    ) -> Result<()> {
        let relative_path = file_path
            .strip_prefix(repo_path)
            .unwrap_or(file_path)
            .to_string_lossy()
            .to_string();

        let file_name = file_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        let extension = file_path
            .extension()
            .map(|e| e.to_str().unwrap_or(""))
            .unwrap_or("");

        // Detect language
        let language = detect_language(extension);

        // Generate unique ID
        let unique_id = generate_file_id(repo_path, &relative_path, content);

        // Extract symbols if possible
        let symbols = extract_symbol_names(content, extension);

        let line_count = content.lines().count() as u64;

        let writer = self.writer.lock().unwrap();

        // Delete existing document with same ID
        let term = Term::from_field_text(self.schema.unique_id, &unique_id);
        writer.delete_term(term);

        // Add new document
        writer.add_document(doc!(
            self.schema.unique_id => unique_id,
            self.schema.repo_id => repo_id.to_string(),
            self.schema.repo_path => repo_path.to_string_lossy().to_string(),
            self.schema.relative_path => relative_path.clone(),
            self.schema.file_name => file_name,
            self.schema.content => content.to_string(),
            self.schema.language => language,
            self.schema.symbols => symbols,
            self.schema.line_count => line_count,
            // Fast fields for efficient filtering
            self.schema.raw_content => content.as_bytes().to_vec(),
            self.schema.raw_relative_path => relative_path.as_bytes().to_vec(),
        ))?;

        Ok(())
    }

    /// Index an entire repository
    pub fn index_repository(
        &self,
        repo_id: &str,
        repo_path: &Path,
        on_progress: impl Fn(usize, usize),
    ) -> Result<TantivyIndexStats> {
        let files = collect_indexable_files(repo_path);
        let total = files.len();
        let mut indexed = 0;
        let mut errors = 0;
        let mut languages: HashMap<String, usize> = HashMap::new();

        for (i, file_path) in files.iter().enumerate() {
            match fs::read_to_string(file_path) {
                Ok(content) => {
                    if let Err(e) = self.index_file(repo_id, repo_path, file_path, &content) {
                        tracing::warn!("Failed to index {}: {}", file_path.display(), e);
                        errors += 1;
                    } else {
                        indexed += 1;
                        let ext = file_path
                            .extension()
                            .and_then(|e| e.to_str())
                            .unwrap_or("unknown");
                        *languages.entry(detect_language(ext)).or_insert(0) += 1;
                    }
                }
                Err(e) => {
                    tracing::trace!(
                        "Skipping binary/unreadable file {}: {}",
                        file_path.display(),
                        e
                    );
                }
            }
            on_progress(i + 1, total);
        }

        // Commit all changes
        self.commit()?;

        Ok(TantivyIndexStats {
            files_indexed: indexed,
            files_failed: errors,
            total_files: total,
            languages: languages.into_iter().collect(),
        })
    }

    /// Commit pending changes
    pub fn commit(&self) -> Result<()> {
        let mut writer = self.writer.lock().unwrap();
        writer.commit()?;
        Ok(())
    }

    /// Search the index using two-stage filtering
    /// 1. Tantivy trigram search finds candidate documents
    /// 2. BytesFilterCollector applies regex filter on raw content
    ///
    /// repo_filter should be the repo_id (UUID) for reliable filtering
    /// offset: skip this many results (for pagination)
    pub fn search(
        &self,
        query_str: &str,
        repo_filter: Option<&str>,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<SearchHit>> {
        let searcher = self.reader.searcher();

        // Build regex for filtering - case insensitive by default
        let regex_pattern = regex::escape(query_str);
        let byte_regex = regex::bytes::RegexBuilder::new(&regex_pattern)
            .case_insensitive(true)
            .multi_line(true)
            .build()
            .context("Failed to build regex")?;

        // Clone for use in closure
        let byte_regex_clone = byte_regex.clone();

        // Build Tantivy query using trigrams
        let mut subqueries: Vec<Box<dyn tantivy::query::Query>> = Vec::new();

        // Extract trigrams from query for better matching
        let trigrams = extract_trigrams(query_str);
        tracing::info!(
            "🔍 [Search] Query: '{}' → {} trigrams: {:?}",
            query_str,
            trigrams.len(),
            trigrams
        );

        for trigram in &trigrams {
            // Search in content field
            let content_term = Term::from_field_text(self.schema.content, trigram);
            subqueries.push(Box::new(TermQuery::new(
                content_term,
                IndexRecordOption::WithFreqsAndPositions,
            )));

            // Also search in symbols field
            let symbol_term = Term::from_field_text(self.schema.symbols, trigram);
            subqueries.push(Box::new(TermQuery::new(
                symbol_term,
                IndexRecordOption::WithFreqsAndPositions,
            )));

            // And in file paths
            let path_term = Term::from_field_text(self.schema.relative_path, trigram);
            subqueries.push(Box::new(TermQuery::new(
                path_term,
                IndexRecordOption::WithFreqsAndPositions,
            )));
        }

        // If no trigrams, fall back to full query
        if subqueries.is_empty() {
            let query_parser = QueryParser::for_index(
                &self.index,
                vec![
                    self.schema.content,
                    self.schema.symbols,
                    self.schema.file_name,
                    self.schema.relative_path,
                ],
            );
            let query = query_parser
                .parse_query(query_str)
                .context("Failed to parse query")?;

            // Use TopDocs collector with BytesFilterCollector
            let fetch_count = (offset + limit) * 3; // 3x multiplier for safety
            let top_k = TopDocs::with_limit(fetch_count);
            let collector = BytesFilterCollector::new(
                self.schema.raw_content,
                move |b| byte_regex_clone.is_match(b),
                top_k,
            );

            let top_docs = searcher.search(&query, &collector)?;

            return self.build_results(top_docs, repo_filter, &byte_regex, limit, offset);
        }

        // Union query: match if any trigram matches
        let query = BooleanQuery::union(subqueries);

        // Set up collectors
        // Fetch enough candidates to satisfy offset + limit after filtering
        let fetch_count = (offset + limit) * 3; // 3x multiplier for safety
        let top_k = TopDocs::with_limit(fetch_count);

        // Use BytesFilterCollector to filter docs by regex on raw_content
        let collector = BytesFilterCollector::new(
            self.schema.raw_content,
            move |b| byte_regex_clone.is_match(b),
            top_k,
        );

        let top_docs = searcher.search(&query, &collector)?;
        tracing::info!(
            "🔍 [Search] Tantivy returned {} candidate docs",
            top_docs.len()
        );

        let results = self.build_results(top_docs, repo_filter, &byte_regex, limit, offset)?;
        tracing::info!(
            "🔍 [Search] Final results after filtering: {} (offset: {})",
            results.len(),
            offset
        );
        Ok(results)
    }

    /// Build search results from top docs
    fn build_results(
        &self,
        top_docs: Vec<(f32, tantivy::DocAddress)>,
        repo_filter: Option<&str>,
        byte_regex: &regex::bytes::Regex,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<SearchHit>> {
        let searcher = self.reader.searcher();
        let mut all_results = Vec::new();

        // First, collect all valid results
        for (score, doc_address) in top_docs {
            // Early exit if we have enough results (offset + limit + some buffer)
            if all_results.len() >= offset + limit + 50 {
                break;
            }

            let doc: TantivyDocument = searcher.doc(doc_address)?;

            let repo_id = doc
                .get_first(self.schema.repo_id)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            // Apply repo filter by ID if specified
            if let Some(filter_id) = repo_filter {
                if repo_id != filter_id {
                    continue;
                }
            }

            let repo_path = doc
                .get_first(self.schema.repo_path)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let relative_path = doc
                .get_first(self.schema.relative_path)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let content = doc
                .get_first(self.schema.content)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let language = doc
                .get_first(self.schema.language)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let line_count = doc
                .get_first(self.schema.line_count)
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as usize;

            // Find matching lines using the regex
            let matching_lines = find_matching_lines_regex(&content, byte_regex, 3);

            // Only include if we actually found matches
            if !matching_lines.is_empty() {
                all_results.push(SearchHit {
                    repo_id,
                    repo_path,
                    relative_path,
                    language,
                    line_count,
                    score,
                    matching_lines,
                });
            }
        }

        // Apply pagination: skip 'offset' results and take 'limit' results
        let paginated_results = all_results.into_iter().skip(offset).take(limit).collect();

        Ok(paginated_results)
    }

    /// Remove all documents for a specific repository
    pub fn remove_repository(&self, repo_id: &str) -> Result<usize> {
        let mut writer = self.writer.lock().unwrap();

        // Delete all documents matching this repo_id
        let term = Term::from_field_text(self.schema.repo_id, repo_id);
        let num_deleted = writer.delete_term(term);

        writer.commit()?;

        tracing::info!("Removed {} documents for repo_id: {}", num_deleted, repo_id);
        Ok(num_deleted as usize)
    }

    /// Delete specific files from the index by searching for matching repo_id + relative_path.
    /// Uses a two-step approach: search for matching doc IDs, then delete them.
    /// This works even when the file has been deleted from disk.
    pub fn delete_files(&self, repo_id: &str, relative_paths: &[String]) -> Result<usize> {
        let searcher = self.reader.searcher();
        let mut unique_ids_to_delete = Vec::new();

        for rel_path in relative_paths {
            let repo_term = Term::from_field_text(self.schema.repo_id, repo_id);
            let repo_query = TermQuery::new(repo_term, IndexRecordOption::Basic);

            let path_term = Term::from_field_text(self.schema.relative_path, rel_path);
            let path_query = TermQuery::new(path_term, IndexRecordOption::Basic);

            let combined = BooleanQuery::new(vec![
                (
                    tantivy::query::Occur::Must,
                    Box::new(repo_query) as Box<dyn tantivy::query::Query>,
                ),
                (
                    tantivy::query::Occur::Must,
                    Box::new(path_query) as Box<dyn tantivy::query::Query>,
                ),
            ]);

            if let Ok(top_docs) = searcher.search(&combined, &TopDocs::with_limit(10)) {
                for (_score, doc_address) in top_docs {
                    if let Ok(doc) = searcher.doc::<TantivyDocument>(doc_address) {
                        if let Some(uid) = doc
                            .get_first(self.schema.unique_id)
                            .and_then(|v| v.as_str())
                        {
                            unique_ids_to_delete.push(uid.to_string());
                        }
                    }
                }
            }
        }

        let writer = self.writer.lock().unwrap();
        for uid in &unique_ids_to_delete {
            let term = Term::from_field_text(self.schema.unique_id, uid);
            writer.delete_term(term);
        }
        drop(writer);
        self.commit()?;

        Ok(unique_ids_to_delete.len())
    }

    /// Incrementally index specific files (delete old docs then insert new)
    pub fn incremental_index_files(
        &self,
        repo_id: &str,
        repo_path: &Path,
        relative_paths: &[String],
    ) -> Result<IncrementalResult> {
        let mut files_updated = 0;
        let mut files_failed = 0;
        let mut failed_paths = Vec::new();

        for rel_path in relative_paths {
            let file_path = repo_path.join(rel_path);
            match std::fs::read_to_string(&file_path) {
                Ok(content) => match self.index_file(repo_id, repo_path, &file_path, &content) {
                    Ok(()) => files_updated += 1,
                    Err(err) => {
                        tracing::warn!("Failed to incrementally index {}: {}", rel_path, err);
                        files_failed += 1;
                        failed_paths.push(rel_path.clone());
                    }
                },
                Err(_) => {
                    files_failed += 1;
                    failed_paths.push(rel_path.clone());
                }
            }
        }

        self.commit()?;

        Ok(IncrementalResult {
            files_updated,
            files_failed,
            failed_paths,
        })
    }

    /// Clear the entire index
    pub fn clear(&self) -> Result<()> {
        let mut writer = self.writer.lock().unwrap();
        writer.delete_all_documents()?;
        writer.commit()?;
        Ok(())
    }

    /// Get index statistics
    pub fn stats(&self) -> Result<TantivyIndexInfo> {
        let searcher = self.reader.searcher();
        let num_docs = searcher.num_docs() as usize;

        let index_size = fs_extra::dir::get_size(&self.index_path).unwrap_or(0) as usize;

        Ok(TantivyIndexInfo {
            num_documents: num_docs,
            index_size_bytes: index_size,
            index_path: self.index_path.to_string_lossy().to_string(),
        })
    }
}

// ============================================
// Types
// ============================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TantivyIndexStats {
    pub files_indexed: usize,
    pub files_failed: usize,
    pub total_files: usize,
    pub languages: Vec<(String, usize)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TantivyIndexInfo {
    pub num_documents: usize,
    pub index_size_bytes: usize,
    pub index_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHit {
    pub repo_id: String,
    pub repo_path: String,
    pub relative_path: String,
    pub language: String,
    pub line_count: usize,
    pub score: f32,
    pub matching_lines: Vec<MatchingLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchingLine {
    pub line_number: usize,
    pub content: String,
    pub context_before: Vec<String>,
    pub context_after: Vec<String>,
}

// ============================================
// Incremental Index Result
// ============================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncrementalResult {
    pub files_updated: usize,
    pub files_failed: usize,
    pub failed_paths: Vec<String>,
}

// ============================================
// Helper Functions
// ============================================

/// Generate unique file ID using blake3 hash
fn generate_file_id(repo_path: &Path, relative_path: &str, content: &str) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(repo_path.to_string_lossy().as_bytes());
    hasher.update(relative_path.as_bytes());
    hasher.update(content.as_bytes());
    hasher.finalize().to_hex().to_string()
}

/// Detect programming language from file extension
fn detect_language(extension: &str) -> String {
    match extension {
        "go" => "Go",
        "java" => "Java",
        "c" | "h" => "C",
        "cpp" | "hpp" | "cc" | "cxx" => "C++",
        "cs" => "C#",
        "rb" => "Ruby",
        "php" => "PHP",
        "swift" => "Swift",
        "kt" | "kts" => "Kotlin",
        "scala" => "Scala",
        "html" | "htm" => "HTML",
        "css" | "scss" | "sass" => "CSS",
        "json" => "JSON",
        "yaml" | "yml" => "YAML",
        "toml" => "TOML",
        "md" | "markdown" => "Markdown",
        "sh" | "bash" | "zsh" => "Shell",
        "sql" => "SQL",
        _ => "unknown",
    }
    .to_string()
}

/// Extract symbol names from code (simplified version)
fn extract_symbol_names(content: &str, _extension: &str) -> String {
    let identifier_pattern = regex::Regex::new(r"\b[a-zA-Z_][a-zA-Z0-9_]{2,}\b").unwrap();
    identifier_pattern
        .find_iter(content)
        .map(|matched_identifier| matched_identifier.as_str())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Collect all indexable files from a repository
fn collect_indexable_files(repo_path: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();

    let exclude_dirs = [
        "node_modules",
        ".git",
        "target",
        "dist",
        "build",
        ".next",
        "__pycache__",
        ".venv",
        "venv",
        "coverage",
        ".cache",
        ".idea",
        ".vscode",
    ];

    fn walk_dir(dir: &Path, files: &mut Vec<PathBuf>, exclude_dirs: &[&str]) {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                let path = entry.path();
                let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

                if path.is_dir() {
                    if !exclude_dirs.contains(&name) && !name.starts_with('.') {
                        walk_dir(&path, files, exclude_dirs);
                    }
                } else if path.is_file() {
                    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                        // Only index text-based source files
                        if is_indexable_extension(ext) {
                            files.push(path);
                        }
                    }
                }
            }
        }
    }

    walk_dir(repo_path, &mut files, &exclude_dirs);
    files
}

/// Check if file extension is indexable
fn is_indexable_extension(ext: &str) -> bool {
    matches!(
        ext,
        "rs" | "js"
            | "jsx"
            | "ts"
            | "tsx"
            | "py"
            | "go"
            | "java"
            | "c"
            | "cpp"
            | "h"
            | "hpp"
            | "cs"
            | "rb"
            | "php"
            | "swift"
            | "kt"
            | "scala"
            | "html"
            | "css"
            | "scss"
            | "json"
            | "yaml"
            | "yml"
            | "toml"
            | "md"
            | "sh"
            | "sql"
            | "vue"
            | "svelte"
    )
}

/// Extract trigrams from a string for indexing
/// Trigrams are 3-character overlapping sequences
/// Example: "hello" -> ["hel", "ell", "llo"]
fn extract_trigrams(text: &str) -> Vec<String> {
    let text_lower = text.to_lowercase();
    let chars: Vec<char> = text_lower.chars().collect();

    if chars.len() < 3 {
        // For short queries, just return the original
        return vec![text_lower];
    }

    let mut trigrams = Vec::new();
    for i in 0..=chars.len().saturating_sub(3) {
        let trigram: String = chars[i..i + 3].iter().collect();
        if !trigrams.contains(&trigram) {
            trigrams.push(trigram);
        }
    }

    trigrams
}

/// Find lines matching the regex pattern with context
fn find_matching_lines_regex(
    content: &str,
    regex: &regex::bytes::Regex,
    context_lines: usize,
) -> Vec<MatchingLine> {
    let lines: Vec<&str> = content.lines().collect();
    let mut results = Vec::new();

    for (i, line) in lines.iter().enumerate() {
        if regex.is_match(line.as_bytes()) {
            let context_before: Vec<String> = lines[i.saturating_sub(context_lines)..i]
                .iter()
                .map(|s| s.to_string())
                .collect();

            let context_after: Vec<String> = lines
                [(i + 1).min(lines.len())..(i + 1 + context_lines).min(lines.len())]
                .iter()
                .map(|s| s.to_string())
                .collect();

            results.push(MatchingLine {
                line_number: i + 1,
                content: line.to_string(),
                context_before,
                context_after,
            });

            // Limit to 10 matches per file
            if results.len() >= 10 {
                break;
            }
        }
    }

    results
}
