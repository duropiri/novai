'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { ScanCapture, ScanSession, scanApi } from './api';

// Socket connection states
export type SocketConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

// Events emitted by the socket hook
export interface ScanSocketEvents {
  onPhoneConnected?: (sessionId: string) => void;
  onPhoneDisconnected?: () => void;
  onFrameReceived?: (frameData: ArrayBuffer | Uint8Array) => void;
  onCaptureReceived?: (capture: ScanCapture) => void;
  onSessionUpdated?: (session: ScanSession) => void;
  onError?: (error: string) => void;
  // Phone-side events
  onGuideUpdate?: (data: { targetAngle: string }) => void;
  onSessionEnded?: () => void;
  onCaptureConfirmed?: (data: { captureId: string; angle: string }) => void;
}

interface UseScanSocketOptions {
  role: 'desktop' | 'phone';
  events?: ScanSocketEvents;
}

interface DesktopSubscribeResult {
  success: boolean;
  session?: ScanSession;
  phoneConnected?: boolean;
  error?: string;
}

interface PhoneConnectResult {
  success: boolean;
  sessionId?: string;
  targetAngles?: string[];
  autoCaptureEnabled?: boolean;
  capturedAngles?: string[];
  error?: string;
}

export function useScanSocket({ role, events }: UseScanSocketOptions) {
  const [connectionState, setConnectionState] = useState<SocketConnectionState>('disconnected');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const eventsRef = useRef(events);

  // Keep events ref up to date
  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  // Connect to WebSocket server - returns promise that resolves when connected
  const connect = useCallback((): Promise<boolean> => {
    return new Promise((resolve) => {
      if (socketRef.current?.connected) {
        resolve(true);
        return;
      }

      setConnectionState('connecting');

      // Check if we're accessing via ngrok (HTTPS on non-localhost)
      const isNgrok = typeof window !== 'undefined' &&
                      window.location.protocol === 'https:' &&
                      !window.location.hostname.includes('localhost');

      let socketUrl: string;
      let socketOptions: Parameters<typeof io>[1];

      if (isNgrok) {
        // When accessed via ngrok, use the same origin with polling transport
        // This proxies through Next.js API route at /api/socket
        // The /scan namespace is appended to the origin
        socketUrl = `${window.location.origin}/scan`;
        socketOptions = {
          path: '/api/socket',
          transports: ['polling'], // Force polling since we're proxying through Next.js
          autoConnect: true,
          timeout: 15000,
        };
        console.log('Using ngrok proxy mode:', socketUrl, socketOptions);
      } else {
        // Direct connection to API server
        const wsUrl = scanApi.getWebSocketUrl();
        socketUrl = `${wsUrl}/scan`;
        socketOptions = {
          transports: ['websocket'],
          autoConnect: true,
          timeout: 10000,
        };
        console.log('Using direct WebSocket:', socketUrl);
      }

      const socket = io(socketUrl, socketOptions);

      socket.on('connect', () => {
        console.log('Socket connected');
        setConnectionState('connected');
        resolve(true);
      });

      socket.on('disconnect', () => {
        setConnectionState('disconnected');
        setSessionId(null);
      });

      socket.on('connect_error', (error) => {
        console.error('Socket connection error:', error);
        setConnectionState('error');
        eventsRef.current?.onError?.('Failed to connect to server');
        resolve(false);
      });

      // Desktop events
      socket.on('phone:connected', (data: { sessionId: string }) => {
        eventsRef.current?.onPhoneConnected?.(data.sessionId);
      });

      socket.on('phone:disconnected', () => {
        eventsRef.current?.onPhoneDisconnected?.();
      });

      socket.on('frame:preview', (frameData: ArrayBuffer | Uint8Array) => {
        eventsRef.current?.onFrameReceived?.(frameData);
      });

      socket.on('capture:new', (capture: ScanCapture) => {
        eventsRef.current?.onCaptureReceived?.(capture);
      });

      // Phone events
      socket.on('guide:update', (data: { targetAngle: string }) => {
        eventsRef.current?.onGuideUpdate?.(data);
      });

      socket.on('session:ended', () => {
        eventsRef.current?.onSessionEnded?.();
      });

      socketRef.current = socket;

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!socket.connected) {
          console.error('Socket connection timeout');
          resolve(false);
        }
      }, 10000);
    });
  }, []);

  // Disconnect from WebSocket server
  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setConnectionState('disconnected');
      setSessionId(null);
    }
  }, []);

  // Desktop: Subscribe to a session
  const subscribeToSession = useCallback(
    (sessionIdToSubscribe: string, secret: string): Promise<DesktopSubscribeResult> => {
      return new Promise((resolve) => {
        if (!socketRef.current?.connected) {
          resolve({ success: false, error: 'Socket not connected' });
          return;
        }

        socketRef.current.emit(
          'session:subscribe',
          { sessionId: sessionIdToSubscribe, secret },
          (response: DesktopSubscribeResult) => {
            if (response.success) {
              setSessionId(sessionIdToSubscribe);
            }
            resolve(response);
          }
        );
      });
    },
    []
  );

  // Phone: Connect with session code
  const connectWithCode = useCallback(
    (sessionCode: string): Promise<PhoneConnectResult> => {
      return new Promise((resolve) => {
        if (!socketRef.current?.connected) {
          resolve({ success: false, error: 'Socket not connected' });
          return;
        }

        socketRef.current.emit(
          'phone:connect',
          { sessionCode },
          (response: PhoneConnectResult) => {
            if (response.success && response.sessionId) {
              setSessionId(response.sessionId);
            }
            resolve(response);
          }
        );
      });
    },
    []
  );

  // Phone: Send preview frame
  const sendFrame = useCallback((frameData: ArrayBuffer) => {
    if (socketRef.current?.connected) {
      // Send ArrayBuffer directly - Socket.io handles binary data better without wrapping
      socketRef.current.emit('phone:frame', frameData);
    }
  }, []);

  // Phone: Send capture
  const sendCapture = useCallback(
    (data: {
      imageBase64: string;
      detectedAngle?: string;
      eulerAngles?: { pitch: number; yaw: number; roll: number };
      qualityScore?: number;
      isAutoCaptured?: boolean;
    }): Promise<{ success: boolean; captureId?: string; angle?: string; error?: string }> => {
      return new Promise((resolve) => {
        if (!socketRef.current?.connected) {
          resolve({ success: false, error: 'Socket not connected' });
          return;
        }

        socketRef.current.emit('phone:capture', data, (response: {
          success: boolean;
          captureId?: string;
          angle?: string;
          error?: string;
        }) => {
          if (response.success) {
            eventsRef.current?.onCaptureConfirmed?.({
              captureId: response.captureId!,
              angle: response.angle!,
            });
          }
          resolve(response);
        });
      });
    },
    []
  );

  // Phone: Send heartbeat
  const sendHeartbeat = useCallback(() => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('phone:heartbeat');
    }
  }, []);

  // Desktop: Send guide update to phone
  const sendGuideUpdate = useCallback((targetAngle: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('guide:update', { targetAngle });
    }
  }, []);

  // Desktop: End session
  const endSession = useCallback((): Promise<{ success: boolean; error?: string }> => {
    return new Promise((resolve) => {
      if (!socketRef.current?.connected) {
        resolve({ success: false, error: 'Socket not connected' });
        return;
      }

      socketRef.current.emit('session:end', (response: { success: boolean; error?: string }) => {
        resolve(response);
      });
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, []);

  // Auto-heartbeat for phone connections
  useEffect(() => {
    if (role !== 'phone' || connectionState !== 'connected' || !sessionId) {
      return;
    }

    const interval = setInterval(() => {
      sendHeartbeat();
    }, 5000); // Every 5 seconds

    return () => clearInterval(interval);
  }, [role, connectionState, sessionId, sendHeartbeat]);

  return {
    connectionState,
    sessionId,
    connect,
    disconnect,
    // Desktop methods
    subscribeToSession,
    sendGuideUpdate,
    endSession,
    // Phone methods
    connectWithCode,
    sendFrame,
    sendCapture,
    sendHeartbeat,
  };
}
