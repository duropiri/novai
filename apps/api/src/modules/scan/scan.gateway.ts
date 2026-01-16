import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ScanService } from './scan.service';

interface SessionSubscription {
  sessionId: string;
  role: 'desktop' | 'phone';
}

@WebSocketGateway({
  namespace: '/scan',
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class ScanGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ScanGateway.name);

  // Track which clients are subscribed to which sessions
  private subscriptions = new Map<string, SessionSubscription>();

  // Track session rooms for broadcasting
  private sessionDesktops = new Map<string, string>(); // sessionId -> desktop socketId
  private sessionPhones = new Map<string, string>(); // sessionId -> phone socketId

  constructor(private readonly scanService: ScanService) {}

  afterInit() {
    this.logger.log('Scan WebSocket Gateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);

    const subscription = this.subscriptions.get(client.id);
    if (subscription) {
      const { sessionId, role } = subscription;

      // Remove from role-specific map
      if (role === 'desktop') {
        this.sessionDesktops.delete(sessionId);
      } else if (role === 'phone') {
        this.sessionPhones.delete(sessionId);

        // Notify desktop that phone disconnected
        const desktopId = this.sessionDesktops.get(sessionId);
        if (desktopId) {
          this.server.to(desktopId).emit('phone:disconnected');
        }
      }

      // Leave room and clean up
      client.leave(`session:${sessionId}`);
      this.subscriptions.delete(client.id);
    }
  }

  /**
   * Desktop subscribes to a session
   */
  @SubscribeMessage('session:subscribe')
  async handleSessionSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string; secret: string },
  ) {
    try {
      const session = await this.scanService.getSession(data.sessionId);

      // Verify secret
      if (session.session_secret !== data.secret) {
        return { error: 'Invalid session secret' };
      }

      // Join session room
      client.join(`session:${data.sessionId}`);

      // Track subscription
      this.subscriptions.set(client.id, {
        sessionId: data.sessionId,
        role: 'desktop',
      });
      this.sessionDesktops.set(data.sessionId, client.id);

      // Mark desktop as connected
      await this.scanService.markDesktopConnected(data.sessionId);

      this.logger.log(`Desktop subscribed to session ${data.sessionId}`);

      return {
        success: true,
        session,
        phoneConnected: this.sessionPhones.has(data.sessionId),
      };
    } catch (error) {
      this.logger.error('Failed to subscribe to session', error);
      return { error: 'Failed to subscribe to session' };
    }
  }

  /**
   * Phone connects to a session
   */
  @SubscribeMessage('phone:connect')
  async handlePhoneConnect(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionCode: string },
  ) {
    try {
      const session = await this.scanService.getSessionByCode(data.sessionCode);

      // Check if phone already connected
      if (this.sessionPhones.has(session.id)) {
        return { error: 'Phone already connected to this session' };
      }

      // Join session room
      client.join(`session:${session.id}`);

      // Track subscription
      this.subscriptions.set(client.id, {
        sessionId: session.id,
        role: 'phone',
      });
      this.sessionPhones.set(session.id, client.id);

      // Update session status
      await this.scanService.updateSessionStatus(session.id, 'connected');

      // Notify desktop that phone connected
      const desktopId = this.sessionDesktops.get(session.id);
      if (desktopId) {
        this.server.to(desktopId).emit('phone:connected', {
          sessionId: session.id,
        });
      }

      this.logger.log(`Phone connected to session ${session.id}`);

      return {
        success: true,
        sessionId: session.id,
        targetAngles: session.target_angles,
        autoCaptureEnabled: session.auto_capture_enabled,
        capturedAngles: Object.keys(session.captured_angles),
      };
    } catch (error) {
      this.logger.error('Failed to connect phone', error);
      return { error: error instanceof Error ? error.message : 'Failed to connect' };
    }
  }

  /**
   * Phone sends a preview frame
   */
  @SubscribeMessage('phone:frame')
  handlePhoneFrame(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: Buffer | ArrayBuffer | { data: Buffer | ArrayBuffer },
  ) {
    const subscription = this.subscriptions.get(client.id);
    if (!subscription || subscription.role !== 'phone') {
      return;
    }

    // Forward frame to desktop
    const desktopId = this.sessionDesktops.get(subscription.sessionId);
    if (desktopId) {
      // Handle both direct binary data and wrapped object
      // Socket.io may send as Buffer (Node.js) instead of ArrayBuffer
      let frameData: Buffer | ArrayBuffer;
      if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
        frameData = data;
      } else if (typeof data === 'object' && 'data' in data) {
        frameData = data.data;
      } else {
        this.logger.warn('Received invalid frame data type');
        return;
      }
      this.server.to(desktopId).emit('frame:preview', frameData);
    }
  }

  /**
   * Phone sends a capture
   */
  @SubscribeMessage('phone:capture')
  async handlePhoneCapture(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: {
      imageBase64: string;
      detectedAngle?: string;
      eulerAngles?: { pitch: number; yaw: number; roll: number };
      qualityScore?: number;
      isAutoCaptured?: boolean;
    },
  ) {
    const subscription = this.subscriptions.get(client.id);
    if (!subscription || subscription.role !== 'phone') {
      return { error: 'Not a phone connection' };
    }

    try {
      const capture = await this.scanService.addCapture(subscription.sessionId, {
        imageBase64: data.imageBase64,
        detectedAngle: data.detectedAngle,
        eulerAngles: data.eulerAngles,
        qualityScore: data.qualityScore,
        isAutoCaptured: data.isAutoCaptured,
      });

      // Notify desktop of new capture
      const desktopId = this.sessionDesktops.get(subscription.sessionId);
      if (desktopId) {
        this.server.to(desktopId).emit('capture:new', capture);
      }

      // Send confirmation back to phone
      return {
        success: true,
        captureId: capture.id,
        angle: capture.detected_angle,
      };
    } catch (error) {
      this.logger.error('Failed to save capture', error);
      return { error: 'Failed to save capture' };
    }
  }

  /**
   * Phone heartbeat
   */
  @SubscribeMessage('phone:heartbeat')
  async handlePhoneHeartbeat(@ConnectedSocket() client: Socket) {
    const subscription = this.subscriptions.get(client.id);
    if (!subscription || subscription.role !== 'phone') {
      return;
    }

    await this.scanService.updateHeartbeat(subscription.sessionId);
    return { success: true };
  }

  /**
   * Desktop sends guide update to phone
   */
  @SubscribeMessage('guide:update')
  handleGuideUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetAngle: string },
  ) {
    const subscription = this.subscriptions.get(client.id);
    if (!subscription || subscription.role !== 'desktop') {
      return;
    }

    // Forward to phone
    const phoneId = this.sessionPhones.get(subscription.sessionId);
    if (phoneId) {
      this.server.to(phoneId).emit('guide:update', data);
    }
  }

  /**
   * End session (from desktop)
   */
  @SubscribeMessage('session:end')
  async handleSessionEnd(@ConnectedSocket() client: Socket) {
    const subscription = this.subscriptions.get(client.id);
    if (!subscription || subscription.role !== 'desktop') {
      return { error: 'Not a desktop connection' };
    }

    try {
      await this.scanService.completeSession(subscription.sessionId);

      // Notify phone that session ended
      const phoneId = this.sessionPhones.get(subscription.sessionId);
      if (phoneId) {
        this.server.to(phoneId).emit('session:ended');
      }

      return { success: true };
    } catch (error) {
      this.logger.error('Failed to end session', error);
      return { error: 'Failed to end session' };
    }
  }
}
