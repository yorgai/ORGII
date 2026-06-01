use calamine::Range;

use super::*;

#[test]
fn range_to_rows_preserves_absolute_offsets() {
    let mut range = Range::new((2, 1), (2, 1));
    range.set_value((2, 1), Data::String("value".to_string()));

    let rows = range_to_rows(&range);

    assert_eq!(rows.len(), 3);
    assert!(rows[0].is_empty());
    assert!(rows[1].is_empty());
    assert_eq!(rows[2], vec!["".to_string(), "value".to_string()]);
}

#[test]
fn used_dimensions_from_range_uses_absolute_coordinates() {
    let mut range = Range::new((2, 1), (4, 3));
    range.set_value((3, 2), Data::String("value".to_string()));

    assert_eq!(used_dimensions_from_range(&range), (4, 3));
}

#[test]
fn read_rows_from_range_returns_requested_absolute_page() {
    let mut range = Range::new((2, 1), (4, 3));
    range.set_value((3, 2), Data::String("value".to_string()));

    let rows = read_rows_from_range(&range, 3, 1, 4, 3);

    assert_eq!(
        rows,
        vec![vec!["".to_string(), "".to_string(), "value".to_string()]]
    );
}

#[test]
fn group_patches_by_sheet_overwrites_duplicate_cell_with_last_value() {
    let patches = vec![
        XlsxCellPatch {
            sheet_name: "Sheet1".to_string(),
            row_index: 1,
            column_index: 2,
            value: "old".to_string(),
        },
        XlsxCellPatch {
            sheet_name: "Sheet1".to_string(),
            row_index: 1,
            column_index: 2,
            value: "new".to_string(),
        },
    ];

    let grouped = group_patches_by_sheet(&patches);

    assert_eq!(
        grouped
            .get("Sheet1")
            .and_then(|sheet| sheet.get(&1))
            .and_then(|row| row.get(&2)),
        Some(&"new".to_string())
    );
}

#[test]
fn apply_sheet_patches_expands_sparse_rows_and_columns() {
    let mut rows = vec![vec!["a".to_string()]];
    let mut row_patches = BTreeMap::new();
    row_patches.insert(2, "c".to_string());
    let mut sheet_patches = BTreeMap::new();
    sheet_patches.insert(2, row_patches);

    apply_sheet_patches(&mut rows, Some(&sheet_patches));

    assert_eq!(rows.len(), 3);
    assert_eq!(
        rows[2],
        vec!["".to_string(), "".to_string(), "c".to_string()]
    );
}
