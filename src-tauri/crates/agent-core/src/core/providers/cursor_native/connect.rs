//! Connect RPC envelope framing.

pub const CONNECT_END_STREAM_FLAG: u8 = 0x02;

pub fn frame_message(payload: &[u8]) -> Vec<u8> {
    let mut buffer = Vec::with_capacity(5 + payload.len());
    buffer.push(0);
    buffer.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    buffer.extend_from_slice(payload);
    buffer
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    pub flags: u8,
    pub payload: Vec<u8>,
}

impl Frame {
    pub fn is_end_stream(&self) -> bool {
        (self.flags & CONNECT_END_STREAM_FLAG) != 0
    }
}

#[derive(Default)]
pub struct FrameParser {
    buffer: Vec<u8>,
}

impl FrameParser {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, chunk: &[u8]) {
        self.buffer.extend_from_slice(chunk);
    }

    pub fn next_frame(&mut self) -> Option<Frame> {
        if self.buffer.len() < 5 {
            return None;
        }
        let flags = self.buffer[0];
        let length = u32::from_be_bytes([
            self.buffer[1],
            self.buffer[2],
            self.buffer[3],
            self.buffer[4],
        ]) as usize;
        if self.buffer.len() < 5 + length {
            return None;
        }
        self.buffer.drain(..5);
        let payload = self.buffer.drain(..length).collect();
        Some(Frame { flags, payload })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_message_prepends_5_byte_header() {
        let payload = b"hello";
        let framed = frame_message(payload);
        assert_eq!(framed[0], 0x00);
        assert_eq!(&framed[1..5], &(5u32.to_be_bytes())[..]);
        assert_eq!(&framed[5..], payload);
    }

    #[test]
    fn parser_emits_single_frame() {
        let mut parser = FrameParser::new();
        let mut bytes = vec![0x00];
        bytes.extend_from_slice(&(3u32.to_be_bytes())[..]);
        bytes.extend_from_slice(b"abc");
        parser.push(&bytes);
        let frame = parser.next_frame().expect("frame ready");
        assert_eq!(frame.flags, 0);
        assert_eq!(frame.payload, b"abc");
        assert!(parser.next_frame().is_none());
    }

    #[test]
    fn parser_buffers_across_partial_reads() {
        let mut parser = FrameParser::new();
        parser.push(&[0x00]);
        assert!(parser.next_frame().is_none());
        parser.push(&(7u32.to_be_bytes())[..2]);
        assert!(parser.next_frame().is_none());
        parser.push(&(7u32.to_be_bytes())[2..]);
        assert!(parser.next_frame().is_none());
        parser.push(b"abcde");
        assert!(parser.next_frame().is_none());
        parser.push(b"fg");
        let frame = parser.next_frame().expect("frame ready after full payload");
        assert_eq!(frame.payload, b"abcdefg");
    }

    #[test]
    fn parser_emits_multiple_frames_from_one_chunk() {
        let mut buffer = Vec::new();
        for payload in [b"a" as &[u8], b"bb", b"ccc"] {
            buffer.push(0x00);
            buffer.extend_from_slice(&(payload.len() as u32).to_be_bytes());
            buffer.extend_from_slice(payload);
        }
        let mut parser = FrameParser::new();
        parser.push(&buffer);
        assert_eq!(parser.next_frame().unwrap().payload, b"a");
        assert_eq!(parser.next_frame().unwrap().payload, b"bb");
        assert_eq!(parser.next_frame().unwrap().payload, b"ccc");
        assert!(parser.next_frame().is_none());
    }

    #[test]
    fn parser_detects_end_stream_flag() {
        let mut parser = FrameParser::new();
        let mut bytes = vec![CONNECT_END_STREAM_FLAG];
        bytes.extend_from_slice(&(2u32.to_be_bytes())[..]);
        bytes.extend_from_slice(b"{}");
        parser.push(&bytes);
        let frame = parser.next_frame().unwrap();
        assert!(frame.is_end_stream());
    }
}
