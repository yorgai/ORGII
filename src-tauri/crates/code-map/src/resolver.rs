use std::collections::HashMap;

use crate::types::{
    CodeMapConfidence, CodeMapEdge, CodeMapEdgeKind, CodeMapExtractionMethod, CodeMapNodeKind,
    CodeMapResolutionStatus, ExtractedFile,
};

pub fn resolve_files(files: &mut [ExtractedFile]) {
    let mut file_nodes = HashMap::new();
    let mut symbols_by_file_and_name: HashMap<(String, String), Vec<String>> = HashMap::new();
    let mut files_by_stem: HashMap<String, String> = HashMap::new();

    for file in files.iter() {
        for node in &file.nodes {
            if node.kind == CodeMapNodeKind::File {
                file_nodes.insert(node.file_path.clone(), node.id.clone());
                if let Some(stem) = file_stem(&node.file_path) {
                    files_by_stem.insert(stem, node.id.clone());
                }
                continue;
            }
            symbols_by_file_and_name
                .entry((node.file_path.clone(), node.name.clone()))
                .or_default()
                .push(node.id.clone());
        }
    }

    for file in files.iter_mut() {
        let mut resolved_indexes = Vec::new();
        for (index, unresolved) in file.unresolved_refs.iter_mut().enumerate() {
            match unresolved.kind {
                CodeMapEdgeKind::Calls | CodeMapEdgeKind::References => {
                    let key = (unresolved.file_path.clone(), unresolved.name.clone());
                    let candidates = symbols_by_file_and_name.get(&key).cloned().unwrap_or_default();
                    unresolved.candidates = candidates.clone();
                    if candidates.len() == 1 {
                        let source = unresolved
                            .from_node_id
                            .clone()
                            .or_else(|| file_nodes.get(&unresolved.file_path).cloned());
                        if let Some(source) = source {
                            file.edges.push(CodeMapEdge {
                                source,
                                target: candidates[0].clone(),
                                kind: unresolved.kind,
                                line: Some(unresolved.line),
                                column: Some(unresolved.column),
                                provenance: Some("same_file_resolver".to_string()),
                                confidence: CodeMapConfidence::Medium,
                                resolution_status: CodeMapResolutionStatus::Resolved,
                            });
                            resolved_indexes.push(index);
                        }
                    } else if candidates.len() > 1 {
                        unresolved.reason = Some("same-file reference is ambiguous".to_string());
                    }
                }
                CodeMapEdgeKind::Imports => {
                    let normalized = normalize_import_name(&unresolved.name);
                    if let Some(target) = files_by_stem.get(&normalized) {
                        if let Some(source) = file_nodes.get(&unresolved.file_path).cloned() {
                            file.edges.push(CodeMapEdge {
                                source,
                                target: target.clone(),
                                kind: CodeMapEdgeKind::Imports,
                                line: Some(unresolved.line),
                                column: Some(unresolved.column),
                                provenance: Some("relative_import_resolver".to_string()),
                                confidence: CodeMapConfidence::Low,
                                resolution_status: CodeMapResolutionStatus::Resolved,
                            });
                            resolved_indexes.push(index);
                        }
                    }
                }
                _ => {}
            }
        }

        for index in resolved_indexes.into_iter().rev() {
            file.unresolved_refs.remove(index);
        }
        for edge in &mut file.edges {
            if edge.provenance.as_deref() == Some("same_file_resolver")
                || edge.provenance.as_deref() == Some("relative_import_resolver")
            {
                edge.resolution_status = CodeMapResolutionStatus::Resolved;
                continue;
            }
            if edge.kind == CodeMapEdgeKind::Contains {
                edge.confidence = CodeMapConfidence::Exact;
                edge.resolution_status = CodeMapResolutionStatus::Resolved;
            } else if edge.confidence == CodeMapConfidence::Heuristic {
                edge.resolution_status = CodeMapResolutionStatus::Unresolved;
            }
        }
        for node in &mut file.nodes {
            if node.extraction_method == CodeMapExtractionMethod::Regex {
                node.confidence = CodeMapConfidence::Heuristic;
            }
        }
    }
}

fn file_stem(file_path: &str) -> Option<String> {
    let name = file_path.rsplit('/').next()?;
    let stem = name.split('.').next()?;
    Some(stem.to_string())
}

fn normalize_import_name(name: &str) -> String {
    name.trim_matches(['\'', '"', '<', '>'])
        .rsplit('/')
        .next()
        .unwrap_or(name)
        .split('.')
        .next()
        .unwrap_or(name)
        .to_string()
}
