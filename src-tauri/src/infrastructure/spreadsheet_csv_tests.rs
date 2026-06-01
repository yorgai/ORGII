use std::collections::BTreeMap;

use super::*;

#[test]
fn delimiter_for_tsv_path_uses_tab() {
    assert_eq!(delimiter_for_path(Path::new("sample.tsv")), TSV_DELIMITER);
}

#[test]
fn delimiter_for_csv_path_uses_comma() {
    assert_eq!(delimiter_for_path(Path::new("sample.csv")), CSV_DELIMITER);
}

#[test]
fn group_patches_overwrites_duplicate_cell_with_last_value() {
    let patches = vec![
        CsvCellPatch {
            row_index: 1,
            column_index: 2,
            value: "old".to_string(),
        },
        CsvCellPatch {
            row_index: 1,
            column_index: 2,
            value: "new".to_string(),
        },
    ];

    let grouped = group_patches_by_row(&patches);

    assert_eq!(
        grouped.get(&1).and_then(|row| row.get(&2)),
        Some(&"new".to_string())
    );
}

#[test]
fn apply_row_patches_expands_sparse_columns() {
    let mut row = vec!["a".to_string()];
    let mut patches = BTreeMap::new();
    patches.insert(2, "c".to_string());

    apply_row_patches(&mut row, Some(&patches));

    assert_eq!(row, vec!["a".to_string(), "".to_string(), "c".to_string()]);
}
