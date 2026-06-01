use prost::Message;
use prost_types::field_descriptor_proto::Type;
use prost_types::FileDescriptorSet;
use std::env;
use std::fs;
use std::path::PathBuf;

const CURSOR_AGENT_PACKAGE: &str = "agent.v1";
const MCP_TOOL_DEFINITION: &str = "McpToolDefinition";
const MCP_ARGS: &str = "McpArgs";
const MCP_ARGS_ENTRY: &str = "ArgsEntry";
const INPUT_SCHEMA_FIELD: &str = "input_schema";
const VALUE_FIELD: &str = "value";

fn main() {
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR must be set"));
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let descriptor_path = manifest_dir
        .parent()
        .and_then(|path| path.parent())
        .map(|workspace_root| workspace_root.join("proto/cursor_agent_v1.descriptor.pb"))
        .expect("agent-core crate must live under src-tauri/crates/agent-core");

    println!("cargo:rerun-if-changed={}", descriptor_path.display());

    let descriptor_bytes = fs::read(&descriptor_path).unwrap_or_else(|err| {
        panic!(
            "failed to read Cursor agent descriptor {}: {}",
            descriptor_path.display(),
            err
        );
    });

    let mut file_descriptor_set =
        FileDescriptorSet::decode(&*descriptor_bytes).unwrap_or_else(|err| {
            panic!(
                "failed to decode FileDescriptorSet at {}: {}",
                descriptor_path.display(),
                err
            );
        });
    patch_cursor_mcp_bytes_fields(&mut file_descriptor_set);

    let mut config = prost_build::Config::new();
    config.out_dir(out_dir);
    config
        .compile_fds(file_descriptor_set)
        .unwrap_or_else(|err| {
            panic!(
                "prost_build::compile_fds failed for Cursor agent.v1: {}",
                err
            )
        });
}

fn patch_cursor_mcp_bytes_fields(file_descriptor_set: &mut FileDescriptorSet) {
    let Some(file) = file_descriptor_set
        .file
        .iter_mut()
        .find(|file| file.package.as_deref() == Some(CURSOR_AGENT_PACKAGE))
    else {
        panic!("Cursor descriptor package {CURSOR_AGENT_PACKAGE} not found");
    };

    let Some(tool_definition) = file
        .message_type
        .iter_mut()
        .find(|message| message.name.as_deref() == Some(MCP_TOOL_DEFINITION))
    else {
        panic!("Cursor descriptor message {MCP_TOOL_DEFINITION} not found");
    };

    let Some(input_schema) = tool_definition
        .field
        .iter_mut()
        .find(|field| field.name.as_deref() == Some(INPUT_SCHEMA_FIELD))
    else {
        panic!("Cursor descriptor field {MCP_TOOL_DEFINITION}.{INPUT_SCHEMA_FIELD} not found");
    };
    input_schema.r#type = Some(Type::Bytes as i32);
    input_schema.type_name = None;

    let Some(mcp_args) = file
        .message_type
        .iter_mut()
        .find(|message| message.name.as_deref() == Some(MCP_ARGS))
    else {
        panic!("Cursor descriptor message {MCP_ARGS} not found");
    };

    let Some(args_entry) = mcp_args
        .nested_type
        .iter_mut()
        .find(|message| message.name.as_deref() == Some(MCP_ARGS_ENTRY))
    else {
        panic!("Cursor descriptor message {MCP_ARGS}.{MCP_ARGS_ENTRY} not found");
    };

    let Some(value) = args_entry
        .field
        .iter_mut()
        .find(|field| field.name.as_deref() == Some(VALUE_FIELD))
    else {
        panic!("Cursor descriptor field {MCP_ARGS}.{MCP_ARGS_ENTRY}.{VALUE_FIELD} not found");
    };
    value.r#type = Some(Type::Bytes as i32);
    value.type_name = None;
}
