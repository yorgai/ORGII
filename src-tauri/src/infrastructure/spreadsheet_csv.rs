use std::collections::BTreeMap;
use std::fs::{self, File};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const CSV_DELIMITER: u8 = b',';
const TSV_DELIMITER: u8 = b'\t';

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvPageRequest {
    pub path: String,
    pub start_row: usize,
    pub page_size: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvPageResponse {
    pub rows: Vec<Vec<String>>,
    pub start_row: usize,
    pub next_row: usize,
    pub has_more: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvCellPatch {
    pub row_index: usize,
    pub column_index: usize,
    pub value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvSavePatchesRequest {
    pub path: String,
    pub patches: Vec<CsvCellPatch>,
}

#[tauri::command]
pub async fn spreadsheet_csv_read_page(request: CsvPageRequest) -> Result<CsvPageResponse, String> {
    tokio::task::spawn_blocking(move || read_csv_page(&request))
        .await
        .map_err(|err| format!("Task join error: {err}"))?
}

#[tauri::command]
pub async fn spreadsheet_csv_save_patches(request: CsvSavePatchesRequest) -> Result<(), String> {
    tokio::task::spawn_blocking(move || save_csv_patches(&request))
        .await
        .map_err(|err| format!("Task join error: {err}"))?
}

fn delimiter_for_path(path: &Path) -> u8 {
    match path.extension().and_then(|extension| extension.to_str()) {
        Some(extension) if extension.eq_ignore_ascii_case("tsv") => TSV_DELIMITER,
        _ => CSV_DELIMITER,
    }
}

fn read_csv_page(request: &CsvPageRequest) -> Result<CsvPageResponse, String> {
    let path = PathBuf::from(&request.path);
    let delimiter = delimiter_for_path(&path);
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .delimiter(delimiter)
        .from_path(&path)
        .map_err(|err| format!("Failed to open spreadsheet file: {err}"))?;

    let mut rows = Vec::new();
    let mut next_row = request.start_row;
    let mut has_more = false;

    for (row_index, record_result) in reader.records().enumerate() {
        if row_index < request.start_row {
            continue;
        }
        let record =
            record_result.map_err(|err| format!("Failed to parse spreadsheet row: {err}"))?;
        if rows.len() >= request.page_size {
            has_more = true;
            break;
        }
        rows.push(record.iter().map(ToOwned::to_owned).collect());
        next_row = row_index + 1;
    }

    Ok(CsvPageResponse {
        rows,
        start_row: request.start_row,
        next_row,
        has_more,
    })
}

fn save_csv_patches(request: &CsvSavePatchesRequest) -> Result<(), String> {
    let path = PathBuf::from(&request.path);
    let delimiter = delimiter_for_path(&path);
    let patches_by_row = group_patches_by_row(&request.patches);
    let temp_path = temp_path_for(&path)?;

    let save_result = write_patched_csv(&path, &temp_path, delimiter, &patches_by_row);
    if let Err(err) = save_result {
        let _ = fs::remove_file(&temp_path);
        return Err(err);
    }

    fs::rename(&temp_path, &path)
        .map_err(|err| format!("Failed to replace spreadsheet file: {err}"))?;
    Ok(())
}

fn write_patched_csv(
    path: &Path,
    temp_path: &Path,
    delimiter: u8,
    patches_by_row: &BTreeMap<usize, BTreeMap<usize, String>>,
) -> Result<(), String> {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .delimiter(delimiter)
        .from_path(path)
        .map_err(|err| format!("Failed to open spreadsheet file: {err}"))?;
    let temp_file = File::create(temp_path)
        .map_err(|err| format!("Failed to create temporary spreadsheet file: {err}"))?;
    let mut writer = csv::WriterBuilder::new()
        .has_headers(false)
        .delimiter(delimiter)
        .from_writer(temp_file);

    let mut written_rows = 0usize;
    for (row_index, record_result) in reader.records().enumerate() {
        let record =
            record_result.map_err(|err| format!("Failed to parse spreadsheet row: {err}"))?;
        let mut row: Vec<String> = record.iter().map(ToOwned::to_owned).collect();
        apply_row_patches(&mut row, patches_by_row.get(&row_index));
        writer
            .write_record(row)
            .map_err(|err| format!("Failed to write spreadsheet row: {err}"))?;
        written_rows = row_index + 1;
    }

    for (&row_index, row_patches) in patches_by_row.range(written_rows..) {
        while written_rows < row_index {
            writer
                .write_record(std::iter::empty::<&str>())
                .map_err(|err| format!("Failed to write empty spreadsheet row: {err}"))?;
            written_rows += 1;
        }
        let mut row = Vec::new();
        apply_row_patches(&mut row, Some(row_patches));
        writer
            .write_record(row)
            .map_err(|err| format!("Failed to write appended spreadsheet row: {err}"))?;
        written_rows += 1;
    }

    writer
        .flush()
        .map_err(|err| format!("Failed to flush spreadsheet file: {err}"))?;
    Ok(())
}

fn group_patches_by_row(patches: &[CsvCellPatch]) -> BTreeMap<usize, BTreeMap<usize, String>> {
    let mut grouped = BTreeMap::new();
    for patch in patches {
        grouped
            .entry(patch.row_index)
            .or_insert_with(BTreeMap::new)
            .insert(patch.column_index, patch.value.clone());
    }
    grouped
}

fn apply_row_patches(row: &mut Vec<String>, row_patches: Option<&BTreeMap<usize, String>>) {
    let Some(row_patches) = row_patches else {
        return;
    };
    let required_columns = row_patches
        .keys()
        .next_back()
        .map_or(0, |column| column + 1);
    if row.len() < required_columns {
        row.resize(required_columns, String::new());
    }
    for (&column_index, value) in row_patches {
        row[column_index] = value.clone();
    }
}

fn temp_path_for(path: &Path) -> Result<PathBuf, String> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Invalid spreadsheet file path".to_string())?;
    Ok(path.with_file_name(format!(".{file_name}.orgii-tmp")))
}

#[cfg(test)]
#[path = "spreadsheet_csv_tests.rs"]
mod tests;
