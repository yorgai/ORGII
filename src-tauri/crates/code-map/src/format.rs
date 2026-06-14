use crate::types::{
    CodeMapNode, CodeMapNodeDetails, CodeMapRelationship, CodeMapSearchResponse, CodeMapStatus,
};

const MAX_TEXT_RESULTS: usize = 40;

pub fn status_text(status: &CodeMapStatus) -> String {
    format!(
        "Code Map status for {}: {:?}\nFiles: {}\nSymbols: {}\nRelationships: {}\nUnresolved refs: {}\nStale files: {}\nFreshness: {:?}\nIndex size: {}\nLast indexed: {}{}",
        status.workspace_path,
        status.status,
        status.files,
        status.symbols,
        status.relationships,
        status.unresolved,
        status.stale_files,
        status.freshness,
        format_size(status.index_size_bytes),
        status
            .last_indexed_at
            .map(|value| value.to_string())
            .unwrap_or_else(|| "never".to_string()),
        status
            .error
            .as_ref()
            .map(|error| format!("\nError: {error}"))
            .unwrap_or_default()
    )
}

pub fn search_text(response: &CodeMapSearchResponse) -> String {
    if response.results.is_empty() {
        return format!(
            "No Code Map symbols matched. Unresolved refs: {}. Stale files: {}.",
            response.unresolved_count, response.stale_files
        );
    }
    let mut output = format!(
        "Code Map symbol matches for `{}` ({} shown{}):\n",
        response.query,
        response.results.len().min(MAX_TEXT_RESULTS),
        if response.truncated {
            ", truncated"
        } else {
            ""
        }
    );
    append_honesty_note(&mut output, response.unresolved_count, response.stale_files);
    for result in response.results.iter().take(MAX_TEXT_RESULTS) {
        output.push_str(&format_node_summary(&result.node));
        output.push_str(&format!(
            " rank={:.2} incoming={} outgoing={}\n",
            result.rank, result.incoming_count, result.outgoing_count
        ));
        if let Some(source) = &result.source {
            output.push_str("Source window:\n");
            output.push_str(&source.text);
        }
    }
    output
}

pub fn explore_text(response: &CodeMapSearchResponse) -> String {
    let mut output = format!("Code Map explore for `{}`:\n", response.query);
    append_honesty_note(&mut output, response.unresolved_count, response.stale_files);
    if response.results.is_empty() {
        output.push_str("No related symbols found.\n");
        return output;
    }
    for result in response.results.iter().take(20) {
        output.push_str(&format_node_summary(&result.node));
        output.push_str(&format!(
            " incoming={} outgoing={} confidence={:?} extraction={:?}\n",
            result.incoming_count,
            result.outgoing_count,
            result.node.confidence,
            result.node.extraction_method
        ));
        if let Some(source) = &result.source {
            output.push_str("Source window:\n");
            output.push_str(&source.text);
        }
    }
    output
}

pub fn node_text(details: &CodeMapNodeDetails) -> String {
    let mut output = String::new();
    output.push_str(&format_node_summary(&details.node));
    output.push_str(&format!(
        "\nConfidence: {:?}\nExtraction: {:?}\n",
        details.node.confidence, details.node.extraction_method
    ));
    if let Some(source) = &details.source {
        output.push_str("\nSource:\n");
        output.push_str(&source.text);
    }
    append_relationships(&mut output, "Incoming relationships", &details.incoming);
    append_relationships(&mut output, "Outgoing relationships", &details.outgoing);
    output
}

pub fn related_text(title: &str, nodes: &[CodeMapNode]) -> String {
    if nodes.is_empty() {
        return format!(
            "No Code Map {title} results. Relationship results exclude containment-only edges."
        );
    }
    let mut output = format!("Code Map {title}:\n");
    output.push_str("Note: relationship results exclude containment-only edges. Low-confidence results are heuristic.\n");
    for node in nodes.iter().take(MAX_TEXT_RESULTS) {
        output.push_str(&format_node_summary(node));
        output.push('\n');
    }
    output
}

fn append_relationships(output: &mut String, title: &str, relationships: &[CodeMapRelationship]) {
    if relationships.is_empty() {
        return;
    }
    output.push_str(&format!("\n{title}:\n"));
    for relationship in relationships.iter().take(30) {
        output.push_str(&format!(
            "- {:?} {:?} {:?}: ",
            relationship.edge.kind,
            relationship.edge.confidence,
            relationship.edge.resolution_status
        ));
        output.push_str(&format_node_summary(&relationship.node));
        if let Some(provenance) = &relationship.edge.provenance {
            output.push_str(&format!(" provenance={provenance}"));
        }
        output.push('\n');
    }
}

fn append_honesty_note(output: &mut String, unresolved_count: u32, stale_files: u32) {
    output.push_str(
        "Note: Code Map combines AST-backed and heuristic extraction. Relationship claims include confidence and may be unresolved until resolver coverage improves.\n",
    );
    if unresolved_count > 0 || stale_files > 0 {
        output.push_str(&format!(
            "Caveats: {unresolved_count} unresolved refs, {stale_files} stale files.\n"
        ));
    }
}

fn format_node_summary(node: &CodeMapNode) -> String {
    format!(
        "- {} [{:?}] {}:{}-{} id={} confidence={:?} extraction={:?}",
        node.qualified_name,
        node.kind,
        node.file_path,
        node.start_line,
        node.end_line,
        node.id,
        node.confidence,
        node.extraction_method
    )
}

fn format_size(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit_index = 0usize;
    while value >= 1024.0 && unit_index < UNITS.len() - 1 {
        value /= 1024.0;
        unit_index += 1;
    }
    if unit_index == 0 {
        format!("{} {}", bytes, UNITS[unit_index])
    } else {
        format!("{value:.1} {}", UNITS[unit_index])
    }
}
