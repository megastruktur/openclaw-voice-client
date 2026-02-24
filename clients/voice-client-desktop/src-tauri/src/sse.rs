use crate::types::VoiceEvent;

/// Parse a single complete SSE event block into a VoiceEvent.
/// Input format: "event: <type>\ndata: <json>\n\n"
/// Returns Err if the block is malformed or JSON deserialization fails.
pub fn parse_sse_event(raw: &str) -> Result<VoiceEvent, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("empty SSE block".to_string());
    }

    let mut data_payload: Option<&str> = None;

    for line in trimmed.lines() {
        let line = line.trim();

        // Skip SSE comments and blank lines
        if line.starts_with(':') || line.is_empty() {
            continue;
        }

        if line.starts_with("data:") {
            data_payload = Some(line.strip_prefix("data:").unwrap_or("").trim());
        }
        // `event:` line is informational — serde tag in JSON handles type dispatch
    }

    let data = data_payload.ok_or_else(|| "missing data line".to_string())?;

    serde_json::from_str::<VoiceEvent>(data)
        .map_err(|e| format!("JSON deserialization failed: {e}"))
}

/// Stateful SSE parser that handles chunk boundaries.
/// reqwest delivers arbitrary byte chunks that may split across event boundaries.
pub struct SseParser {
    buffer: String,
}

impl SseParser {
    pub fn new() -> Self {
        Self {
            buffer: String::new(),
        }
    }

    /// Feed a chunk of text. Returns all complete events parsed from the accumulated buffer.
    pub fn feed(&mut self, chunk: &str) -> Vec<VoiceEvent> {
        self.buffer.push_str(chunk);

        let mut events = Vec::new();

        // Scan for complete events delimited by "\n\n"
        while let Some(pos) = self.buffer.find("\n\n") {
            let block: String = self.buffer.drain(..pos).collect();
            // Drain the "\n\n" delimiter
            self.buffer.drain(..2);

            match parse_sse_event(&block) {
                Ok(event) => events.push(event),
                Err(_) => { /* skip malformed blocks */ }
            }
        }

        events
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user_event_raw() -> String {
        "event: user\ndata: {\"type\":\"user\",\"text\":\"hello\",\"confidence\":0.95,\"timestamp\":\"2026-02-24T12:00:00Z\"}\n\n".to_string()
    }

    fn openclaw_event_raw() -> String {
        "event: openclaw\ndata: {\"type\":\"openclaw\",\"text\":\"world\",\"done\":true,\"timestamp\":\"2026-02-24T12:00:01Z\"}\n\n".to_string()
    }

    fn system_event_raw() -> String {
        "event: system\ndata: {\"type\":\"system\",\"status\":\"connected\",\"message\":\"ready\",\"timestamp\":\"2026-02-24T12:00:02Z\"}\n\n".to_string()
    }

    #[test]
    fn test_parse_user_event() {
        let raw = "event: user\ndata: {\"type\":\"user\",\"text\":\"hello\",\"confidence\":0.95,\"timestamp\":\"2026-02-24T12:00:00Z\"}";
        let event = parse_sse_event(raw).unwrap();
        match event {
            VoiceEvent::User { text, confidence, timestamp } => {
                assert_eq!(text, "hello");
                assert!((confidence - 0.95).abs() < f64::EPSILON);
                assert_eq!(timestamp, "2026-02-24T12:00:00Z");
            }
            _ => panic!("expected User variant"),
        }
    }

    #[test]
    fn test_parse_openclaw_event() {
        let raw = "event: openclaw\ndata: {\"type\":\"openclaw\",\"text\":\"world\",\"done\":true,\"timestamp\":\"2026-02-24T12:00:01Z\"}";
        let event = parse_sse_event(raw).unwrap();
        match event {
            VoiceEvent::Openclaw { text, done, timestamp } => {
                assert_eq!(text, "world");
                assert!(done);
                assert_eq!(timestamp, "2026-02-24T12:00:01Z");
            }
            _ => panic!("expected Openclaw variant"),
        }
    }

    #[test]
    fn test_parse_system_event() {
        let raw = "event: system\ndata: {\"type\":\"system\",\"status\":\"connected\",\"message\":\"ready\",\"timestamp\":\"2026-02-24T12:00:02Z\"}";
        let event = parse_sse_event(raw).unwrap();
        match event {
            VoiceEvent::System { status, message, timestamp } => {
                assert_eq!(status, "connected");
                assert_eq!(message, Some("ready".to_string()));
                assert_eq!(timestamp, "2026-02-24T12:00:02Z");
            }
            _ => panic!("expected System variant"),
        }
    }

    #[test]
    fn test_parse_malformed_missing_data() {
        let raw = "event: user\n";
        let result = parse_sse_event(raw);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("missing data line"));
    }

    #[test]
    fn test_parse_malformed_invalid_json() {
        let raw = "event: user\ndata: {not valid json}";
        let result = parse_sse_event(raw);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("JSON deserialization failed"));
    }

    #[test]
    fn test_parser_single_event() {
        let mut parser = SseParser::new();
        let events = parser.feed(&user_event_raw());
        assert_eq!(events.len(), 1);
        match &events[0] {
            VoiceEvent::User { text, .. } => assert_eq!(text, "hello"),
            _ => panic!("expected User variant"),
        }
    }

    #[test]
    fn test_parser_multiple_events() {
        let mut parser = SseParser::new();
        let chunk = format!("{}{}", user_event_raw(), openclaw_event_raw());
        let events = parser.feed(&chunk);
        assert_eq!(events.len(), 2);
        assert!(matches!(&events[0], VoiceEvent::User { .. }));
        assert!(matches!(&events[1], VoiceEvent::Openclaw { .. }));
    }

    #[test]
    fn test_parser_split_across_chunks() {
        let mut parser = SseParser::new();
        // Split a user event across two chunks — break mid-JSON
        let full = user_event_raw();
        let mid = full.len() / 2;
        let (first, second) = full.split_at(mid);

        let events1 = parser.feed(first);
        assert!(events1.is_empty(), "partial chunk should yield no events");

        let events2 = parser.feed(second);
        assert_eq!(events2.len(), 1);
        assert!(matches!(&events2[0], VoiceEvent::User { .. }));
    }

    #[test]
    fn test_parser_partial_then_complete() {
        let mut parser = SseParser::new();
        let user_raw = user_event_raw();
        let system_raw = system_event_raw();

        // First feed: partial user event (no terminator yet)
        let partial = user_raw.trim_end_matches('\n');
        let events1 = parser.feed(partial);
        assert!(events1.is_empty());

        // Second feed: remaining terminator of user event + full system event
        let rest = format!("\n\n{}", system_raw);
        let events2 = parser.feed(&rest);
        assert_eq!(events2.len(), 2);
        assert!(matches!(&events2[0], VoiceEvent::User { .. }));
        assert!(matches!(&events2[1], VoiceEvent::System { .. }));
    }
}
