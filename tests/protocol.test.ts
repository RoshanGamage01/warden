import { describe, it, expect } from 'vitest';
import { MessageFramer, isRequest, isResponse, isEvent } from '../src/ipc/protocol.js';
import { RpcRequest, RpcResponse, RpcEvent } from '../src/core/types.js';

describe('MessageFramer encode/decode', () => {
  it('round-trips a single RPC request', () => {
    const msg: RpcRequest = { id: 1, method: 'list', params: {} };
    const buf = MessageFramer.encode(msg);
    const framer = new MessageFramer();
    const received: unknown[] = [];
    framer.feed(buf, (m) => received.push(m));
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(msg);
  });

  it('handles fragmented delivery', () => {
    const msg: RpcRequest = { id: 2, method: 'stop', params: { id: 0 } };
    const buf = MessageFramer.encode(msg);
    const framer = new MessageFramer();
    const received: unknown[] = [];
    // Feed one byte at a time
    for (let i = 0; i < buf.length; i++) {
      framer.feed(buf.slice(i, i + 1), (m) => received.push(m));
    }
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(msg);
  });

  it('handles multiple messages in one chunk', () => {
    const msgs: RpcRequest[] = [
      { id: 3, method: 'list' },
      { id: 4, method: 'save' },
      { id: 5, method: 'resurrect' },
    ];
    const combined = Buffer.concat(msgs.map(MessageFramer.encode));
    const framer = new MessageFramer();
    const received: unknown[] = [];
    framer.feed(combined, (m) => received.push(m));
    expect(received).toHaveLength(3);
    expect(received).toEqual(msgs);
  });

  it('handles a two-chunk split mid-body', () => {
    const msg: RpcResponse = { id: 6, result: { status: 'ok' } };
    const buf = MessageFramer.encode(msg);
    const mid = Math.floor(buf.length / 2);
    const framer = new MessageFramer();
    const received: unknown[] = [];
    framer.feed(buf.slice(0, mid), (m) => received.push(m));
    expect(received).toHaveLength(0);
    framer.feed(buf.slice(mid), (m) => received.push(m));
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(msg);
  });
});

describe('type guards', () => {
  it('identifies a request', () => {
    const req: RpcRequest = { id: 1, method: 'list' };
    expect(isRequest(req)).toBe(true);
    expect(isResponse(req)).toBe(false);
    expect(isEvent(req)).toBe(false);
  });

  it('identifies a response', () => {
    const res: RpcResponse = { id: 1, result: null };
    expect(isRequest(res)).toBe(false);
    expect(isResponse(res)).toBe(true);
    expect(isEvent(res)).toBe(false);
  });

  it('identifies an event', () => {
    const ev: RpcEvent = { event: 'log', data: { warden_id: 0 } };
    expect(isRequest(ev)).toBe(false);
    expect(isResponse(ev)).toBe(false);
    expect(isEvent(ev)).toBe(true);
  });
});
