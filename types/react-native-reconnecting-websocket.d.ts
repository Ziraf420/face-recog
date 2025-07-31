declare module 'react-native-reconnecting-websocket' {
  class ReconnectingWebSocket {
    constructor(
      url: string,
      protocols?: string | string[],
      options?: {
        reconnectInterval?: number;
        maxReconnectInterval?: number;
        reconnectDecay?: number;
        timeoutInterval?: number;
        maxReconnectAttempts?: number | null;
      }
    );

    onopen: (event: any) => void;
    onclose: (event: any) => void;
    onerror: (event: any) => void;
    onmessage: (event: { data: string }) => void;
    
    send(data: string | ArrayBuffer | Blob): void;
    close(code?: number, reason?: string): void;
    reconnect(code?: number, reason?: string): void;
  }

  export = ReconnectingWebSocket;
}