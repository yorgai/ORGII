//! BytesFilterCollector - A Tantivy collector that filters documents using fast fields
//!
//! This is a port from bloop's implementation. It allows filtering documents
//! based on raw byte content before returning them, which is crucial for regex
//! matching and case-insensitive search.

use tantivy::collector::{Collector, SegmentCollector};
use tantivy::columnar::BytesColumn;
use tantivy::schema::Field;
use tantivy::{Score, SegmentReader, TantivyError};

/// A collector that filters documents based on a predicate applied to a fast field
pub struct BytesFilterCollector<TCollector, TPredicate>
where
    TPredicate: 'static + Clone,
{
    field: Field,
    collector: TCollector,
    predicate: TPredicate,
}

impl<TCollector, TPredicate> BytesFilterCollector<TCollector, TPredicate>
where
    TCollector: Collector + Send + Sync,
    TPredicate: Fn(&[u8]) -> bool + Send + Sync + Clone,
{
    /// Create a new BytesFilterCollector.
    ///
    /// # Arguments
    /// * `field` - The fast field to filter on
    /// * `predicate` - A function that returns true if the document should be kept
    /// * `collector` - The underlying collector to use after filtering
    pub fn new(
        field: Field,
        predicate: TPredicate,
        collector: TCollector,
    ) -> BytesFilterCollector<TCollector, TPredicate> {
        BytesFilterCollector {
            field,
            predicate,
            collector,
        }
    }
}

impl<TCollector, TPredicate> Collector for BytesFilterCollector<TCollector, TPredicate>
where
    TCollector: Collector + Send + Sync,
    TPredicate: Fn(&[u8]) -> bool + Send + Sync + Clone,
{
    type Fruit = TCollector::Fruit;
    type Child = BytesFilterSegmentCollector<TCollector::Child, TPredicate>;

    fn for_segment(
        &self,
        segment_local_id: u32,
        segment_reader: &SegmentReader,
    ) -> tantivy::Result<BytesFilterSegmentCollector<TCollector::Child, TPredicate>> {
        let schema = segment_reader.schema();
        let field_entry = schema.get_field_entry(self.field);

        if !field_entry.is_fast() {
            return Err(TantivyError::SchemaError(format!(
                "Field {:?} is not a fast field.",
                field_entry.name()
            )));
        }

        let field_name = schema.get_field_name(self.field);
        let fast_field_reader =
            segment_reader
                .fast_fields()
                .bytes(field_name)?
                .ok_or_else(|| {
                    TantivyError::SchemaError(format!(
                        "Field {:?} is not a bytes field",
                        field_name
                    ))
                })?;

        let segment_collector = self
            .collector
            .for_segment(segment_local_id, segment_reader)?;

        Ok(BytesFilterSegmentCollector {
            fast_field_reader,
            segment_collector,
            predicate: self.predicate.clone(),
        })
    }

    fn requires_scoring(&self) -> bool {
        self.collector.requires_scoring()
    }

    fn merge_fruits(
        &self,
        segment_fruits: Vec<<TCollector::Child as SegmentCollector>::Fruit>,
    ) -> tantivy::Result<TCollector::Fruit> {
        self.collector.merge_fruits(segment_fruits)
    }
}

/// Segment collector that applies the filter at document collection time
pub struct BytesFilterSegmentCollector<TSegmentCollector, TPredicate>
where
    TPredicate: 'static,
{
    fast_field_reader: BytesColumn,
    segment_collector: TSegmentCollector,
    predicate: TPredicate,
}

impl<TSegmentCollector, TPredicate> SegmentCollector
    for BytesFilterSegmentCollector<TSegmentCollector, TPredicate>
where
    TSegmentCollector: SegmentCollector,
    TPredicate: 'static + Fn(&[u8]) -> bool + Send + Sync,
{
    type Fruit = TSegmentCollector::Fruit;

    fn collect(&mut self, doc: u32, score: Score) {
        let mut value = Vec::new();
        self.fast_field_reader
            .ords()
            .values_for_doc(doc)
            .for_each(|ord| {
                self.fast_field_reader
                    .ord_to_bytes(ord, &mut value)
                    .unwrap();
            });

        // Only collect if predicate returns true
        if (self.predicate)(&value) {
            self.segment_collector.collect(doc, score)
        }
    }

    fn harvest(self) -> <TSegmentCollector as SegmentCollector>::Fruit {
        self.segment_collector.harvest()
    }
}
