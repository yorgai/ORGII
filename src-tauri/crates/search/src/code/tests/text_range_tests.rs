use crate::code::text_range::{Point, TextRange};
use std::ops::Range;

#[test]
fn point_new_constructs_correctly() {
    let point = Point::new(42, 1, 10);
    assert_eq!(point.byte, 42);
    assert_eq!(point.line, 1);
    assert_eq!(point.column, 10);
}

#[test]
fn point_ordering_by_byte_index() {
    let a = Point::new(5, 0, 5);
    let b = Point::new(10, 0, 10);
    assert!(a < b);
    assert!(b > a);
    assert_eq!(a.cmp(&b), std::cmp::Ordering::Less);
}

#[test]
fn point_from_byte_first_line() {
    let line_end_indices = [10u32, 20, 30];
    let point = Point::from_byte(5, &line_end_indices);
    assert_eq!(point.byte, 5);
    assert_eq!(point.line, 0);
    assert_eq!(point.column, 5);
}

#[test]
fn point_from_byte_second_line() {
    let line_end_indices = [10u32, 20, 30];
    let point = Point::from_byte(15, &line_end_indices);
    assert_eq!(point.byte, 15);
    assert_eq!(point.line, 1);
    assert_eq!(point.column, 5);
}

#[test]
fn point_from_byte_at_line_end_boundary() {
    let line_end_indices = [10u32, 20, 30];
    let point = Point::from_byte(10, &line_end_indices);
    assert_eq!(point.byte, 10);
    assert_eq!(point.line, 1);
    assert_eq!(point.column, 0);
}

#[test]
fn text_range_new_constructs() {
    let start = Point::new(0, 0, 0);
    let end = Point::new(10, 0, 10);
    let range = TextRange::new(start, end);
    assert_eq!(range.start.byte, 0);
    assert_eq!(range.end.byte, 10);
}

#[test]
fn text_range_size() {
    let start = Point::new(5, 0, 5);
    let end = Point::new(15, 0, 15);
    let range = TextRange::new(start, end);
    assert_eq!(range.size(), 10);
}

#[test]
fn text_range_contains_itself() {
    let start = Point::new(0, 0, 0);
    let end = Point::new(10, 0, 10);
    let range = TextRange::new(start, end);
    assert!(range.contains(&range));
}

#[test]
fn text_range_contains_sub_range() {
    let outer = TextRange::new(Point::new(0, 0, 0), Point::new(20, 0, 20));
    let inner = TextRange::new(Point::new(5, 0, 5), Point::new(15, 0, 15));
    assert!(outer.contains(&inner));
}

#[test]
fn text_range_does_not_contain_overlapping() {
    let a = TextRange::new(Point::new(0, 0, 0), Point::new(10, 0, 10));
    let b = TextRange::new(Point::new(5, 0, 5), Point::new(15, 0, 15));
    assert!(!a.contains(&b));
}

#[test]
fn text_range_contains_strict_excludes_same_start() {
    let range = TextRange::new(Point::new(0, 0, 0), Point::new(20, 0, 20));
    let same_start = TextRange::new(Point::new(0, 0, 0), Point::new(10, 0, 10));
    assert!(!range.contains_strict(same_start));
}

#[test]
fn text_range_from_byte_range() {
    let line_end_indices = [10u32, 20, 30];
    let range = TextRange::from_byte_range(5..15, &line_end_indices);
    assert_eq!(range.start.byte, 5);
    assert_eq!(range.end.byte, 15);
    assert_eq!(range.start.line, 0);
    assert_eq!(range.end.line, 1);
}

#[test]
fn text_range_ordering_by_start_then_size() {
    let a = TextRange::new(Point::new(0, 0, 0), Point::new(20, 0, 20));
    let b = TextRange::new(Point::new(0, 0, 0), Point::new(10, 0, 10));
    assert!(b < a);
    assert!(a > b);

    let c = TextRange::new(Point::new(5, 0, 5), Point::new(15, 0, 15));
    assert!(a < c);
}

#[test]
fn text_range_into_range_usize() {
    let range = TextRange::new(Point::new(10, 0, 10), Point::new(25, 0, 25));
    let std_range: Range<usize> = range.into();
    assert_eq!(std_range, 10..25);
}
