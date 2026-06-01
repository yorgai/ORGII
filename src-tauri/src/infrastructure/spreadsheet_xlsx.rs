use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use calamine::{open_workbook_auto, Data, Reader};
use rust_xlsxwriter::Workbook;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XlsxWorkbookRequest {
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XlsxSheetInfo {
    pub name: String,
    pub row_count: usize,
    pub column_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XlsxWorkbookInfoResponse {
    pub sheets: Vec<XlsxSheetInfo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XlsxPageRequest {
    pub path: String,
    pub sheet_name: String,
    pub start_row: usize,
    pub page_size: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XlsxPageResponse {
    pub sheet_name: String,
    pub rows: Vec<Vec<String>>,
    pub start_row: usize,
    pub next_row: usize,
    pub has_more: bool,
    pub row_count: usize,
    pub column_count: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XlsxCellPatch {
    pub sheet_name: String,
    pub row_index: usize,
    pub column_index: usize,
    pub value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XlsxSavePatchesRequest {
    pub path: String,
    pub patches: Vec<XlsxCellPatch>,
}

#[tauri::command]
pub async fn spreadsheet_xlsx_workbook_info(
    request: XlsxWorkbookRequest,
) -> Result<XlsxWorkbookInfoResponse, String> {
    tokio::task::spawn_blocking(move || workbook_info(&request.path))
        .await
        .map_err(|err| format!("Task join error: {err}"))?
}

#[tauri::command]
pub async fn spreadsheet_xlsx_read_page(
    request: XlsxPageRequest,
) -> Result<XlsxPageResponse, String> {
    tokio::task::spawn_blocking(move || read_xlsx_page(&request))
        .await
        .map_err(|err| format!("Task join error: {err}"))?
}

#[tauri::command]
pub async fn spreadsheet_xlsx_save_patches(request: XlsxSavePatchesRequest) -> Result<(), String> {
    tokio::task::spawn_blocking(move || save_xlsx_patches(&request))
        .await
        .map_err(|err| format!("Task join error: {err}"))?
}

fn workbook_info(path: &str) -> Result<XlsxWorkbookInfoResponse, String> {
    let mut workbook =
        open_workbook_auto(path).map_err(|err| format!("Failed to open workbook: {err}"))?;
    let sheet_names = workbook.sheet_names().to_vec();
    let mut sheets = Vec::with_capacity(sheet_names.len());

    for sheet_name in sheet_names {
        let range = workbook
            .worksheet_range(&sheet_name)
            .map_err(|err| format!("Failed to read sheet '{sheet_name}': {err}"))?;
        let (row_count, column_count) = used_dimensions_from_range(&range);
        sheets.push(XlsxSheetInfo {
            name: sheet_name,
            row_count,
            column_count,
        });
    }

    Ok(XlsxWorkbookInfoResponse { sheets })
}

fn read_xlsx_page(request: &XlsxPageRequest) -> Result<XlsxPageResponse, String> {
    let mut workbook = open_workbook_auto(&request.path)
        .map_err(|err| format!("Failed to open workbook: {err}"))?;
    let range = workbook
        .worksheet_range(&request.sheet_name)
        .map_err(|err| format!("Failed to read sheet '{}': {err}", request.sheet_name))?;
    let (row_count, column_count) = used_dimensions_from_range(&range);
    let rows = read_rows_from_range(
        &range,
        request.start_row,
        request.page_size,
        row_count,
        column_count,
    );
    let next_row = request.start_row + rows.len();
    let has_more = request.page_size > 0 && next_row < row_count;

    Ok(XlsxPageResponse {
        sheet_name: request.sheet_name.clone(),
        rows,
        start_row: request.start_row,
        next_row,
        has_more,
        row_count,
        column_count,
    })
}

fn save_xlsx_patches(request: &XlsxSavePatchesRequest) -> Result<(), String> {
    let path = PathBuf::from(&request.path);
    let temp_path = temp_path_for(&path)?;
    let patches_by_sheet = group_patches_by_sheet(&request.patches);

    let save_result = write_patched_workbook(&path, &temp_path, &patches_by_sheet);
    if let Err(err) = save_result {
        let _ = fs::remove_file(&temp_path);
        return Err(err);
    }

    fs::rename(&temp_path, &path).map_err(|err| format!("Failed to replace workbook: {err}"))?;
    Ok(())
}

fn write_patched_workbook(
    path: &Path,
    temp_path: &Path,
    patches_by_sheet: &BTreeMap<String, BTreeMap<usize, BTreeMap<usize, String>>>,
) -> Result<(), String> {
    let mut source =
        open_workbook_auto(path).map_err(|err| format!("Failed to open workbook: {err}"))?;
    let sheet_names = source.sheet_names().to_vec();
    let mut target = Workbook::new();

    for sheet_name in sheet_names {
        let range = source
            .worksheet_range(&sheet_name)
            .map_err(|err| format!("Failed to read sheet '{sheet_name}': {err}"))?;
        let mut rows = range_to_rows(&range);
        apply_sheet_patches(&mut rows, patches_by_sheet.get(&sheet_name));
        write_sheet(&mut target, &sheet_name, &rows)?;
    }

    target
        .save(temp_path)
        .map_err(|err| format!("Failed to write workbook: {err}"))?;
    Ok(())
}

fn write_sheet(
    workbook: &mut Workbook,
    sheet_name: &str,
    rows: &[Vec<String>],
) -> Result<(), String> {
    let worksheet = workbook.add_worksheet();
    worksheet
        .set_name(sheet_name)
        .map_err(|err| format!("Failed to set sheet name '{sheet_name}': {err}"))?;

    for (row_index, row) in rows.iter().enumerate() {
        let row_number = u32::try_from(row_index)
            .map_err(|_| "Workbook row index exceeds XLSX limit".to_string())?;
        for (column_index, value) in row.iter().enumerate() {
            if value.is_empty() {
                continue;
            }
            let column_number = u16::try_from(column_index)
                .map_err(|_| "Workbook column index exceeds XLSX limit".to_string())?;
            worksheet
                .write_string(row_number, column_number, value)
                .map_err(|err| format!("Failed to write workbook cell: {err}"))?;
        }
    }

    Ok(())
}

fn read_rows_from_range(
    range: &calamine::Range<Data>,
    start_row: usize,
    page_size: usize,
    row_count: usize,
    column_count: usize,
) -> Vec<Vec<String>> {
    if page_size == 0 || start_row >= row_count {
        return Vec::new();
    }

    let end_row = row_count.min(start_row + page_size);
    (start_row..end_row)
        .map(|row_index| {
            (0..column_count)
                .map(|column_index| {
                    let row = u32::try_from(row_index).ok();
                    let column = u32::try_from(column_index).ok();
                    match (row, column) {
                        (Some(row), Some(column)) => range
                            .get_value((row, column))
                            .map(cell_to_string)
                            .unwrap_or_default(),
                        _ => String::new(),
                    }
                })
                .collect()
        })
        .collect()
}

fn used_dimensions_from_range(range: &calamine::Range<Data>) -> (usize, usize) {
    let Some((start_row, start_column)) = range.start() else {
        return (0, 0);
    };
    let mut row_count = 0usize;
    let mut column_count = 0usize;

    for (relative_row, relative_column, cell) in range.used_cells() {
        if cell_to_string(cell).is_empty() {
            continue;
        }
        row_count = row_count.max(start_row as usize + relative_row + 1);
        column_count = column_count.max(start_column as usize + relative_column + 1);
    }

    (row_count, column_count)
}

fn range_to_rows(range: &calamine::Range<Data>) -> Vec<Vec<String>> {
    let Some((start_row, start_column)) = range.start() else {
        return Vec::new();
    };
    let leading_rows = start_row as usize;
    let leading_columns = start_column as usize;
    let mut rows = Vec::with_capacity(leading_rows + range.height());

    for _ in 0..leading_rows {
        rows.push(Vec::new());
    }

    rows.extend(range.rows().map(|row| {
        let mut cells = vec![String::new(); leading_columns];
        cells.extend(row.iter().map(cell_to_string));
        cells
    }));

    rows
}

fn cell_to_string(cell: &Data) -> String {
    match cell {
        Data::Empty => String::new(),
        _ => cell.to_string(),
    }
}

fn group_patches_by_sheet(
    patches: &[XlsxCellPatch],
) -> BTreeMap<String, BTreeMap<usize, BTreeMap<usize, String>>> {
    let mut grouped = BTreeMap::new();
    for patch in patches {
        grouped
            .entry(patch.sheet_name.clone())
            .or_insert_with(BTreeMap::new)
            .entry(patch.row_index)
            .or_insert_with(BTreeMap::new)
            .insert(patch.column_index, patch.value.clone());
    }
    grouped
}

fn apply_sheet_patches(
    rows: &mut Vec<Vec<String>>,
    sheet_patches: Option<&BTreeMap<usize, BTreeMap<usize, String>>>,
) {
    let Some(sheet_patches) = sheet_patches else {
        return;
    };

    if let Some(last_row_index) = sheet_patches.keys().next_back() {
        if rows.len() <= *last_row_index {
            rows.resize_with(last_row_index + 1, Vec::new);
        }
    }

    for (&row_index, row_patches) in sheet_patches {
        let row = &mut rows[row_index];
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
}

fn temp_path_for(path: &Path) -> Result<PathBuf, String> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Invalid workbook file path".to_string())?;
    Ok(path.with_file_name(format!(".{file_name}.orgii-tmp.xlsx")))
}

#[cfg(test)]
#[path = "spreadsheet_xlsx_tests.rs"]
mod tests;
