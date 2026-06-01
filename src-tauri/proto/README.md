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

## Usage (coming in PR2)

```rust
// src-tauri/build.rs
prost_build::Config::new()
    .file_descriptor_set_path("proto/cursor_agent_v1.descriptor.pb")
    .compile_protos(&[], &[])?;
```

The generated Rust types will be used by `CursorNativeClient` (see
`docs/ideas/cursor-native-provider.md`) to drive the
`/agent.v1.AgentService/Run` server-streaming RPC.
