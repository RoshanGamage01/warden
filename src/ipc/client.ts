import net from 'net';
import { MessageFramer, isResponse, isEvent } from './protocol.js';
import { RpcEvent, RpcResponse } from '../core/types.js';

let _nextId = 1;

export class RpcClient {
  private socket: net.Socket | null = null;
  private framer = new MessageFramer();
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private eventListeners: Array<(e: RpcEvent) => void> = [];

  async connect(socketPath: string, timeoutMs = 5_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`connect timeout after ${timeoutMs}ms`)),
        timeoutMs
      );

      const sock = net.createConnection(socketPath, () => {
        clearTimeout(timer);
        resolve();
      });

      sock.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      sock.on('data', (chunk: Buffer) => {
        this.framer.feed(chunk, (msg) => {
          if (isResponse(msg)) {
            this.handleResponse(msg as RpcResponse);
          } else if (isEvent(msg)) {
            for (const cb of this.eventListeners) cb(msg as RpcEvent);
          }
        });
      });

      sock.on('close', () => {
        // Reject all pending calls
        for (const [, p] of this.pending) {
          p.reject(new Error('IPC connection closed'));
        }
        this.pending.clear();
      });

      this.socket = sock;
    });
  }

  private handleResponse(msg: RpcResponse): void {
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.error) {
      p.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code }));
    } else {
      p.resolve(msg.result);
    }
  }

  call<T = unknown>(method: string, params?: unknown, timeoutMs = 30_000): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.destroyed) {
        return reject(new Error('Not connected'));
      }

      const id = _nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });

      this.socket.write(MessageFramer.encode({ id, method, params }));
    });
  }

  /** Register a handler for server-push events (log streaming etc.). */
  onEvent(cb: (e: RpcEvent) => void): () => void {
    this.eventListeners.push(cb);
    return () => {
      this.eventListeners = this.eventListeners.filter((l) => l !== cb);
    };
  }

  disconnect(): void {
    this.socket?.destroy();
    this.socket = null;
  }
}

/**
 * Attempt to connect; return null if the daemon is not running.
 */
export async function tryConnect(socketPath: string): Promise<RpcClient | null> {
  const client = new RpcClient();
  try {
    await client.connect(socketPath, 2_000);
    return client;
  } catch {
    client.disconnect();
    return null;
  }
}
