//! Minimal protobuf codec for Feishu's pbbp2 protocol.
//!
//! Mirrors the Go SDK's `pbbp2.proto`:
//!
//!   message Header { required string key = 1; required string value = 2; }
//!   message Frame  {
//!     required uint64 SeqID           = 1;
//!     required uint64 LogID           = 2;
//!     required int32  service         = 3;
//!     required int32  method          = 4;
//!     repeated Header headers         = 5;
//!     optional string payload_encoding = 6;
//!     optional string payload_type    = 7;
//!     optional bytes  payload         = 8;
//!     optional string LogIDNew        = 9;
//!   }

/// Protobuf wire types.
const WIRE_VARINT: u8 = 0;
const WIRE_LEN: u8 = 2;

/// Encode a varint into `buf`.
fn encode_varint(buf: &mut Vec<u8>, mut val: u64) {
    loop {
        let byte = (val & 0x7F) as u8;
        val >>= 7;
        if val == 0 {
            buf.push(byte);
            return;
        }
        buf.push(byte | 0x80);
    }
}

/// Decode a varint from `data` starting at `pos`. Returns (value, new_pos).
fn decode_varint(data: &[u8], mut pos: usize) -> Option<(u64, usize)> {
    let mut result: u64 = 0;
    let mut shift = 0u32;
    loop {
        if pos >= data.len() {
            return None;
        }
        let byte = data[pos];
        pos += 1;
        result |= ((byte & 0x7F) as u64) << shift;
        if byte & 0x80 == 0 {
            return Some((result, pos));
        }
        shift += 7;
        if shift >= 64 {
            return None;
        }
    }
}

/// Encode a tag (field_number, wire_type).
fn encode_tag(buf: &mut Vec<u8>, field: u32, wire: u8) {
    encode_varint(buf, ((field as u64) << 3) | wire as u64);
}

/// Encode a length-delimited field (string or bytes).
fn encode_len_field(buf: &mut Vec<u8>, field: u32, data: &[u8]) {
    if data.is_empty() {
        return;
    }
    encode_tag(buf, field, WIRE_LEN);
    encode_varint(buf, data.len() as u64);
    buf.extend_from_slice(data);
}

/// Encode a varint field.
fn encode_varint_field(buf: &mut Vec<u8>, field: u32, val: u64) {
    encode_tag(buf, field, WIRE_VARINT);
    encode_varint(buf, val);
}

/// Encode a signed int32 as varint (zigzag not needed — proto2 int32 uses plain varint).
fn encode_int32_field(buf: &mut Vec<u8>, field: u32, val: i32) {
    encode_varint_field(buf, field, val as u64);
}

/// A single protobuf Header { key, value }.
#[derive(Debug, Clone, Default)]
pub(super) struct PbHeader {
    pub(super) key: String,
    pub(super) value: String,
}

impl PbHeader {
    pub(super) fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        encode_len_field(&mut buf, 1, self.key.as_bytes());
        encode_len_field(&mut buf, 2, self.value.as_bytes());
        buf
    }

    pub(super) fn decode(data: &[u8]) -> Option<Self> {
        let mut key = String::new();
        let mut value = String::new();
        let mut pos = 0;
        while pos < data.len() {
            let (tag_val, new_pos) = decode_varint(data, pos)?;
            pos = new_pos;
            let field = (tag_val >> 3) as u32;
            let wire = (tag_val & 0x07) as u8;
            match (field, wire) {
                (1, WIRE_LEN) => {
                    let (len, new_pos) = decode_varint(data, pos)?;
                    pos = new_pos;
                    let end = pos + len as usize;
                    if end > data.len() {
                        return None;
                    }
                    key = String::from_utf8_lossy(&data[pos..end]).to_string();
                    pos = end;
                }
                (2, WIRE_LEN) => {
                    let (len, new_pos) = decode_varint(data, pos)?;
                    pos = new_pos;
                    let end = pos + len as usize;
                    if end > data.len() {
                        return None;
                    }
                    value = String::from_utf8_lossy(&data[pos..end]).to_string();
                    pos = end;
                }
                (_, WIRE_VARINT) => {
                    let (_, np) = decode_varint(data, pos)?;
                    pos = np;
                }
                (_, WIRE_LEN) => {
                    let (len, np) = decode_varint(data, pos)?;
                    pos = np + len as usize;
                }
                _ => {
                    return None;
                }
            }
        }
        Some(PbHeader { key, value })
    }
}

/// Frame types matching the Go SDK.
pub(super) const FRAME_TYPE_CONTROL: i32 = 0;
pub(super) const FRAME_TYPE_DATA: i32 = 1;

/// Message types (header "type" values).
pub(super) const MSG_TYPE_EVENT: &str = "event";
pub(super) const MSG_TYPE_PING: &str = "ping";
pub(super) const MSG_TYPE_PONG: &str = "pong";

/// The protobuf Frame message.
#[derive(Debug, Clone, Default)]
pub(super) struct PbFrame {
    pub(super) seq_id: u64,
    pub(super) log_id: u64,
    pub(super) service: i32,
    pub(super) method: i32,
    pub(super) headers: Vec<PbHeader>,
    pub(super) payload_encoding: String,
    pub(super) payload_type: String,
    pub(super) payload: Vec<u8>,
    pub(super) log_id_new: String,
}

impl PbFrame {
    /// Serialize to protobuf bytes.
    pub(super) fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        encode_varint_field(&mut buf, 1, self.seq_id);
        encode_varint_field(&mut buf, 2, self.log_id);
        encode_int32_field(&mut buf, 3, self.service);
        encode_int32_field(&mut buf, 4, self.method);
        for header in &self.headers {
            let hdr_bytes = header.encode();
            encode_len_field(&mut buf, 5, &hdr_bytes);
        }
        encode_len_field(&mut buf, 6, self.payload_encoding.as_bytes());
        encode_len_field(&mut buf, 7, self.payload_type.as_bytes());
        encode_len_field(&mut buf, 8, &self.payload);
        encode_len_field(&mut buf, 9, self.log_id_new.as_bytes());
        buf
    }

    /// Deserialize from protobuf bytes.
    pub(super) fn decode(data: &[u8]) -> Option<Self> {
        let mut frame = PbFrame::default();
        let mut pos = 0;
        while pos < data.len() {
            let (tag_val, new_pos) = decode_varint(data, pos)?;
            pos = new_pos;
            let field = (tag_val >> 3) as u32;
            let wire = (tag_val & 0x07) as u8;
            match (field, wire) {
                (1, WIRE_VARINT) => {
                    let (v, np) = decode_varint(data, pos)?;
                    frame.seq_id = v;
                    pos = np;
                }
                (2, WIRE_VARINT) => {
                    let (v, np) = decode_varint(data, pos)?;
                    frame.log_id = v;
                    pos = np;
                }
                (3, WIRE_VARINT) => {
                    let (v, np) = decode_varint(data, pos)?;
                    frame.service = v as i32;
                    pos = np;
                }
                (4, WIRE_VARINT) => {
                    let (v, np) = decode_varint(data, pos)?;
                    frame.method = v as i32;
                    pos = np;
                }
                (5, WIRE_LEN) => {
                    let (len, np) = decode_varint(data, pos)?;
                    pos = np;
                    let end = pos + len as usize;
                    if end > data.len() {
                        return None;
                    }
                    if let Some(hdr) = PbHeader::decode(&data[pos..end]) {
                        frame.headers.push(hdr);
                    }
                    pos = end;
                }
                (6, WIRE_LEN) => {
                    let (len, np) = decode_varint(data, pos)?;
                    pos = np;
                    let end = pos + len as usize;
                    if end > data.len() {
                        return None;
                    }
                    frame.payload_encoding = String::from_utf8_lossy(&data[pos..end]).to_string();
                    pos = end;
                }
                (7, WIRE_LEN) => {
                    let (len, np) = decode_varint(data, pos)?;
                    pos = np;
                    let end = pos + len as usize;
                    if end > data.len() {
                        return None;
                    }
                    frame.payload_type = String::from_utf8_lossy(&data[pos..end]).to_string();
                    pos = end;
                }
                (8, WIRE_LEN) => {
                    let (len, np) = decode_varint(data, pos)?;
                    pos = np;
                    let end = pos + len as usize;
                    if end > data.len() {
                        return None;
                    }
                    frame.payload = data[pos..end].to_vec();
                    pos = end;
                }
                (9, WIRE_LEN) => {
                    let (len, np) = decode_varint(data, pos)?;
                    pos = np;
                    let end = pos + len as usize;
                    if end > data.len() {
                        return None;
                    }
                    frame.log_id_new = String::from_utf8_lossy(&data[pos..end]).to_string();
                    pos = end;
                }
                // Skip unknown fields
                (_, WIRE_VARINT) => {
                    let (_, np) = decode_varint(data, pos)?;
                    pos = np;
                }
                (_, WIRE_LEN) => {
                    let (len, np) = decode_varint(data, pos)?;
                    pos = np + len as usize;
                }
                _ => {
                    pos += 1;
                } // skip unknown wire types
            }
        }
        Some(frame)
    }

    /// Get a header value by key.
    pub(super) fn header(&self, key: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|h| h.key == key)
            .map(|h| h.value.as_str())
    }

    /// Get a header value as int.
    pub(super) fn header_int(&self, key: &str) -> i32 {
        self.header(key).and_then(|v| v.parse().ok()).unwrap_or(0)
    }

    /// Build a ping frame.
    pub(super) fn new_ping(service_id: i32) -> Self {
        PbFrame {
            method: FRAME_TYPE_CONTROL,
            service: service_id,
            headers: vec![PbHeader {
                key: "type".to_string(),
                value: MSG_TYPE_PING.to_string(),
            }],
            ..Default::default()
        }
    }

    /// Build a response frame for an event (echoes back headers + status).
    pub(super) fn new_response(original: &PbFrame, status_code: i32) -> Self {
        let resp_payload = serde_json::json!({
            "code": status_code,
            "headers": {},
            "data": null
        });
        let mut headers = original.headers.clone();
        headers.push(PbHeader {
            key: "biz_rt".to_string(),
            value: "0".to_string(),
        });
        PbFrame {
            seq_id: original.seq_id,
            log_id: original.log_id,
            service: original.service,
            method: original.method,
            headers,
            payload: resp_payload.to_string().into_bytes(),
            ..Default::default()
        }
    }
}
