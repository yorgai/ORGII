use super::codec::*;

#[test]
fn header_encode_decode_roundtrip() {
    let header = PbHeader {
        key: "type".to_string(),
        value: "ping".to_string(),
    };
    let encoded = header.encode();
    let decoded = PbHeader::decode(&encoded).expect("decode should succeed");
    assert_eq!(decoded.key, "type");
    assert_eq!(decoded.value, "ping");
}

#[test]
fn header_encode_decode_empty_values() {
    let header = PbHeader {
        key: String::new(),
        value: String::new(),
    };
    let encoded = header.encode();
    assert!(
        encoded.is_empty(),
        "empty header should encode to empty bytes"
    );
    let decoded = PbHeader::decode(&encoded).expect("decode of empty should succeed");
    assert_eq!(decoded.key, "");
    assert_eq!(decoded.value, "");
}

#[test]
fn header_encode_decode_unicode() {
    let header = PbHeader {
        key: "channel".to_string(),
        value: "飞书消息".to_string(),
    };
    let encoded = header.encode();
    let decoded = PbHeader::decode(&encoded).expect("decode should succeed");
    assert_eq!(decoded.key, "channel");
    assert_eq!(decoded.value, "飞书消息");
}

#[test]
fn frame_encode_decode_roundtrip_minimal() {
    let frame = PbFrame {
        seq_id: 42,
        log_id: 100,
        service: 1,
        method: 2,
        ..Default::default()
    };
    let encoded = frame.encode();
    let decoded = PbFrame::decode(&encoded).expect("decode should succeed");
    assert_eq!(decoded.seq_id, 42);
    assert_eq!(decoded.log_id, 100);
    assert_eq!(decoded.service, 1);
    assert_eq!(decoded.method, 2);
    assert!(decoded.headers.is_empty());
    assert!(decoded.payload.is_empty());
}

#[test]
fn frame_encode_decode_roundtrip_with_headers_and_payload() {
    let frame = PbFrame {
        seq_id: 1,
        log_id: 2,
        service: 1,
        method: FRAME_TYPE_DATA,
        headers: vec![
            PbHeader {
                key: "type".into(),
                value: "event".into(),
            },
            PbHeader {
                key: "biz_rt".into(),
                value: "0".into(),
            },
        ],
        payload_encoding: "utf-8".to_string(),
        payload_type: "application/json".to_string(),
        payload: b"{\"key\":\"value\"}".to_vec(),
        log_id_new: "log-abc".to_string(),
    };

    let encoded = frame.encode();
    let decoded = PbFrame::decode(&encoded).expect("decode should succeed");

    assert_eq!(decoded.seq_id, 1);
    assert_eq!(decoded.service, 1);
    assert_eq!(decoded.method, FRAME_TYPE_DATA);
    assert_eq!(decoded.headers.len(), 2);
    assert_eq!(decoded.headers[0].key, "type");
    assert_eq!(decoded.headers[0].value, "event");
    assert_eq!(decoded.headers[1].key, "biz_rt");
    assert_eq!(decoded.payload_encoding, "utf-8");
    assert_eq!(decoded.payload_type, "application/json");
    assert_eq!(decoded.payload, b"{\"key\":\"value\"}");
    assert_eq!(decoded.log_id_new, "log-abc");
}

#[test]
fn frame_header_lookup() {
    let frame = PbFrame {
        headers: vec![
            PbHeader {
                key: "type".into(),
                value: "ping".into(),
            },
            PbHeader {
                key: "status".into(),
                value: "200".into(),
            },
        ],
        ..Default::default()
    };
    assert_eq!(frame.header("type"), Some("ping"));
    assert_eq!(frame.header("status"), Some("200"));
    assert_eq!(frame.header("missing"), None);
}

#[test]
fn frame_header_int() {
    let frame = PbFrame {
        headers: vec![
            PbHeader {
                key: "status_code".into(),
                value: "200".into(),
            },
            PbHeader {
                key: "not_a_number".into(),
                value: "abc".into(),
            },
        ],
        ..Default::default()
    };
    assert_eq!(frame.header_int("status_code"), 200);
    assert_eq!(frame.header_int("not_a_number"), 0);
    assert_eq!(frame.header_int("missing"), 0);
}

#[test]
fn frame_new_ping() {
    let ping = PbFrame::new_ping(7);
    assert_eq!(ping.service, 7);
    assert_eq!(ping.method, FRAME_TYPE_CONTROL);
    assert_eq!(ping.header("type"), Some(MSG_TYPE_PING));
}

#[test]
fn frame_new_response_echoes_original() {
    let original = PbFrame {
        seq_id: 99,
        log_id: 77,
        service: 1,
        method: FRAME_TYPE_DATA,
        headers: vec![PbHeader {
            key: "type".into(),
            value: "event".into(),
        }],
        ..Default::default()
    };
    let resp = PbFrame::new_response(&original, 0);
    assert_eq!(resp.seq_id, 99);
    assert_eq!(resp.log_id, 77);
    assert_eq!(resp.service, 1);
    assert_eq!(resp.header("type"), Some("event"));
    assert_eq!(resp.header("biz_rt"), Some("0"));
    let payload_str = String::from_utf8_lossy(&resp.payload);
    assert!(payload_str.contains("\"code\":0"));
}

#[test]
fn frame_decode_empty_data() {
    let decoded = PbFrame::decode(&[]);
    assert!(
        decoded.is_some(),
        "empty bytes should decode to default frame"
    );
    let frame = decoded.unwrap();
    assert_eq!(frame.seq_id, 0);
    assert!(frame.headers.is_empty());
}

#[test]
fn frame_decode_garbage_returns_none_or_partial() {
    let garbage = vec![0xFF, 0xFF, 0xFF, 0xFF];
    // Should not panic; may return None or a partial frame
    let _ = PbFrame::decode(&garbage);
}

#[test]
fn frame_large_varint_roundtrip() {
    let frame = PbFrame {
        seq_id: u64::MAX - 1,
        log_id: u64::MAX,
        service: i32::MAX,
        method: i32::MIN,
        ..Default::default()
    };
    let encoded = frame.encode();
    let decoded = PbFrame::decode(&encoded).expect("large values should roundtrip");
    assert_eq!(decoded.seq_id, u64::MAX - 1);
    assert_eq!(decoded.log_id, u64::MAX);
    assert_eq!(decoded.service, i32::MAX);
}
