import { RpcMessage } from '../core/types.js';

/**
 * Wire format:
 *   [4 bytes big-endian uint32 = body length] [body: UTF-8 JSON]
 *
 * Handles fragmentation and multiple messages per chunk.
 */

const HEADER_LEN = 4;

export class MessageFramer {
  private buf = Buffer.alloc(0);

  /** Encode a message into a framed Buffer ready to send. */
  static encode(msg: RpcMessage): Buffer {
    const body = Buffer.from(JSON.stringify(msg), 'utf8');
    const header = Buffer.allocUnsafe(HEADER_LEN);
    header.writeUInt32BE(body.length, 0);
    return Buffer.concat([header, body]);
  }

  /**
   * Feed incoming data. Calls onMessage for each complete framed message.
   * Returns any remaining partial data (already stored in internal buffer).
   */
  feed(chunk: Buffer, onMessage: (msg: RpcMessage) => void): void {
    this.buf = Buffer.concat([this.buf, chunk]);

    while (true) {
      if (this.buf.length < HEADER_LEN) break;
      const bodyLen = this.buf.readUInt32BE(0);
      if (this.buf.length < HEADER_LEN + bodyLen) break;

      const body = this.buf.slice(HEADER_LEN, HEADER_LEN + bodyLen);
      this.buf = this.buf.slice(HEADER_LEN + bodyLen);

      try {
        const msg = JSON.parse(body.toString('utf8')) as RpcMessage;
        onMessage(msg);
      } catch {
        // malformed frame – skip
      }
    }
  }

  reset(): void {
    this.buf = Buffer.alloc(0);
  }
}

/** Type-guards */

export function isRequest(msg: RpcMessage): msg is import('../core/types.js').RpcRequest {
  return 'method' in msg && 'id' in msg;
}

export function isResponse(msg: RpcMessage): msg is import('../core/types.js').RpcResponse {
  return !('method' in msg) && 'id' in msg;
}

export function isEvent(msg: RpcMessage): msg is import('../core/types.js').RpcEvent {
  return 'event' in msg;
}
