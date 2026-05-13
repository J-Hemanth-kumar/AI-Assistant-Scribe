import type {
  WSMessage,
  WSMessageType,
  ChatTokenPayload,
  ChatCitationPayload,
  ChatDonePayload,
  ChatErrorPayload,
  FileProgressPayload,
} from '@/types';

type WSHandler<T = unknown> = (payload: T) => void;
type WSHandlerMap = { [K in WSMessageType]?: WSHandler<never>[] };

export interface SendChatOptions {
  sessionId: string;
  messageId: string;
  content: string;
  // FIX: doc_id is now sent so backend RAG branch is reached
  doc_id?: string;
  fileIds?: string[];
}

class ScribeWebSocketService {
  private ws: WebSocket | null = null;
  private url = '';
  private handlers: WSHandlerMap = {};
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnects = 5;
  private readonly reconnectBaseDelay = 1000;
  private intentionalClose = false;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  connect(url: string, sessionId?: string): Promise<void> {
    const wsUrl = sessionId ? `${url}?session_id=${sessionId}` : url;
    this.url = wsUrl;
    this.intentionalClose = false;
    return this._openSocket();
  }

  private _openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          this.reconnectAttempts = 0;
          this._startPing();
          resolve();
        };

        this.ws.onerror = (e) => reject(e);

        this.ws.onmessage = (event: MessageEvent<string>) => {
          try {
            const msg: WSMessage = JSON.parse(event.data);
            this._dispatch(msg);
          } catch {
            console.warn('[WS] Failed to parse message:', event.data);
          }
        };

        this.ws.onclose = () => {
          this._stopPing();
          if (!this.intentionalClose) this._scheduleReconnect();
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  disconnect(): void {
    this.intentionalClose = true;
    this._stopPing();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private _startPing(): void {
    this.pingInterval = setInterval(() => {
      this.send({ type: 'ping', payload: null });
    }, 25_000);
  }

  private _stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private _scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnects) {
      console.error('[WS] Max reconnect attempts reached.');
      return;
    }
    const delay = this.reconnectBaseDelay * 2 ** this.reconnectAttempts;
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this._openSocket().catch(() => {});
    }, delay);
  }

  send(msg: WSMessage): void {
    if (!this.isConnected) {
      console.warn('[WS] Cannot send — not connected.');
      return;
    }
    this.ws!.send(JSON.stringify(msg));
  }

  /**
   * FIX: sendChat now includes doc_id in the payload so the backend
   * correctly routes to the RAG branch instead of the echo fallback.
   */
  sendChat(opts: SendChatOptions): void {
    this.send({
      type: 'chat_start',
      payload: {
        messageId: opts.messageId,
        sessionId: opts.sessionId,
        content: opts.content,
        doc_id: opts.doc_id ?? null,
        fileIds: opts.fileIds ?? [],
      },
    });
  }

  on<T>(type: WSMessageType, handler: WSHandler<T>): () => void {
    if (!this.handlers[type]) this.handlers[type] = [];
    (this.handlers[type] as WSHandler<T>[]).push(handler);
    return () => this.off(type, handler);
  }

  off<T>(type: WSMessageType, handler: WSHandler<T>): void {
    const list = this.handlers[type] as WSHandler<T>[] | undefined;
    if (!list) return;
    this.handlers[type] = list.filter((h) => h !== handler) as WSHandler<never>[];
  }

  private _dispatch(msg: WSMessage): void {
    const list = this.handlers[msg.type];
    if (!list) return;
    for (const handler of list) {
      try {
        handler(msg.payload as never);
      } catch (e) {
        console.error('[WS] Handler error:', e);
      }
    }
  }
}

export const wsService = new ScribeWebSocketService();
export type { ChatTokenPayload, ChatCitationPayload, ChatDonePayload, ChatErrorPayload, FileProgressPayload };
