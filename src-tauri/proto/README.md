# Cursor Agent Proto Descriptor

`cursor_agent_v1.descriptor.pb` is a binary `FileDescriptorSet` containing the
full `agent.v1` proto schema used by Cursor's internal gRPC / Connect API at
`api2.cursor.sh`.

## Provenance

Extracted from [opencode-cursor](https://github.com/ephraimduncan/opencode-cursor)'s
generated TypeScript file `src/proto/agent_pb.ts`. That file embeds the original
bufbuild-compiled `FileDescriptorProto` as a base64 blob inside a
`fileDesc("...")` call. The descriptor was decoded with:

```python
import re, base64
src = open("opencode-cursor/src/proto/agent_pb.ts").read()
b64 = re.search(r'fileDesc\(\s*"([^"]+)"', src).group(1)
b64 += "=" * (-len(b64) % 4)
fdp = base64.b64decode(b64)
```

Then wrapped as a single-file `FileDescriptorSet` (field 1, length-delimited)
so `prost-build` / `protoc` can consume it directly.

## Why binary, not `.proto` source

The `agent.v1` schema has ~300 messages across ~80KB. Shipping the binary
descriptor avoids maintaining hand-written `.proto` files that drift from
Cursor's schema. When Cursor changes the schema, re-run the extraction above
against an updated `agent_pb.ts`.

## Usage

The `agent-core` crate consumes this descriptor at build time:

```rust
// src-tauri/crates/agent-core/build.rs
let descriptor_bytes = fs::read(&descriptor_path)?;
let file_descriptor_set = FileDescriptorSet::decode(&*descriptor_bytes)?;
prost_build::Config::new().compile_fds(file_descriptor_set)?;
```

`src-tauri/crates/agent-core/src/core/providers/cursor_native/proto.rs` includes
the generated `agent.v1.rs` file from `OUT_DIR`, and the Cursor native provider
uses those `pb::*` types to encode requests, decode streaming responses, and
handle native tool-call messages for `/agent.v1.AgentService/Run`.
