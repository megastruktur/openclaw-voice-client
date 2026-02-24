import { describe, it, expect, vi } from 'vitest';
import type http from 'node:http';
import { formatSSE, writeSSEHeaders, sendSSE, endSSE } from '../sse.js';
import type { UserEvent, OpenClawEvent, SystemEvent } from '../types.js';

describe('SSE Module', () => {
  describe('formatSSE', () => {
    it('should format a UserEvent as SSE string', () => {
      const event: UserEvent = {
        type: 'user',
        text: 'Hello world',
        confidence: 0.95,
        timestamp: '2026-02-24T10:00:00Z',
      };

      const result = formatSSE(event);

      expect(result).toContain('event: user\n');
      expect(result).toContain('data: ');
      expect(result).toMatch(/\n\n$/);
      expect(result).toContain('"type":"user"');
      expect(result).toContain('"text":"Hello world"');
      expect(result).toContain('"confidence":0.95');
    });

    it('should format an OpenClawEvent as SSE string', () => {
      const event: OpenClawEvent = {
        type: 'openclaw',
        text: 'Response text',
        done: false,
        timestamp: '2026-02-24T10:00:01Z',
      };

      const result = formatSSE(event);

      expect(result).toContain('event: openclaw\n');
      expect(result).toContain('data: ');
      expect(result).toMatch(/\n\n$/);
      expect(result).toContain('"type":"openclaw"');
      expect(result).toContain('"text":"Response text"');
      expect(result).toContain('"done":false');
    });

    it('should format a SystemEvent as SSE string', () => {
      const event: SystemEvent = {
        type: 'system',
        status: 'transcribing',
        message: 'Processing audio',
        timestamp: '2026-02-24T10:00:02Z',
      };

      const result = formatSSE(event);

      expect(result).toContain('event: system\n');
      expect(result).toContain('data: ');
      expect(result).toMatch(/\n\n$/);
      expect(result).toContain('"type":"system"');
      expect(result).toContain('"status":"transcribing"');
      expect(result).toContain('"message":"Processing audio"');
    });

    it('should handle multi-line text with escaped newlines in JSON', () => {
      const event: UserEvent = {
        type: 'user',
        text: 'Line 1\nLine 2\nLine 3',
        confidence: 0.9,
        timestamp: '2026-02-24T10:00:03Z',
      };

      const result = formatSSE(event);

      expect(result).toContain('event: user\n');
      expect(result).toContain('data: ');
      // JSON.stringify escapes newlines as \n
      expect(result).toContain('Line 1\\nLine 2\\nLine 3');
      expect(result).toMatch(/\n\n$/);
    });
  });

  describe('writeSSEHeaders', () => {
    it('should write correct SSE headers to response', () => {
      const mockRes = {
        writeHead: vi.fn(),
      } as unknown as http.ServerResponse;

      writeSSEHeaders(mockRes);

      expect(mockRes.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
    });
  });

  describe('sendSSE', () => {
    it('should write formatted event to response', () => {
      const event: UserEvent = {
        type: 'user',
        text: 'Test message',
        confidence: 0.85,
        timestamp: '2026-02-24T10:00:04Z',
      };

      const mockRes = {
        write: vi.fn(),
      } as unknown as http.ServerResponse;

      sendSSE(mockRes, event);

      expect(mockRes.write).toHaveBeenCalledOnce();
      const writtenData = (mockRes.write as any).mock.calls[0][0];
      expect(writtenData).toContain('event: user\n');
      expect(writtenData).toContain('data: ');
      expect(writtenData).toContain('"text":"Test message"');
    });

    it('should call write with formatted OpenClawEvent', () => {
      const event: OpenClawEvent = {
        type: 'openclaw',
        text: 'Agent response',
        done: true,
        timestamp: '2026-02-24T10:00:05Z',
      };

      const mockRes = {
        write: vi.fn(),
      } as unknown as http.ServerResponse;

      sendSSE(mockRes, event);

      expect(mockRes.write).toHaveBeenCalledOnce();
      const writtenData = (mockRes.write as any).mock.calls[0][0];
      expect(writtenData).toContain('event: openclaw\n');
      expect(writtenData).toContain('"done":true');
    });
  });

  describe('endSSE', () => {
    it('should call res.end() to close the stream', () => {
      const mockRes = {
        end: vi.fn(),
      } as unknown as http.ServerResponse;

      endSSE(mockRes);

      expect(mockRes.end).toHaveBeenCalledOnce();
    });
  });
});
