import type { Server as HttpServer } from 'node:http';
import cookie from 'cookie';
import { Server, type Socket } from 'socket.io';
import { socketRead, socketSend, socketTyping } from '@cms/shared';
import { prisma } from '../../db';
import { isLive, lookup, setRevokeListener } from '../auth/sessions';
import { cookieName } from '../../middleware/session';
import { setRoomHook } from '../../lib/chatMembership';
import { setNotifyEmitter } from '../../lib/notify';
import { setEmitter } from '../../lib/realtime';
import { logger } from '../../lib/logger';
import { markRead, sendMessage } from '../chat/service';

interface SocketData {
  userId: string;
  role: 'admin' | 'teacher' | 'student';
  loginSessionId: string;
}

type Ack = (r: unknown) => void;
const ack = (cb: unknown): Ack => (typeof cb === 'function' ? (cb as Ack) : () => {});

/** Socket.IO with the same cookie session as HTTP (02 §1); chat events per 07 §1. Rooms are chosen by the server only. */
export function createSocketServer(server: HttpServer, opts: { revalidateMs?: number } = {}): Server {
  const io = new Server(server);

  io.use(async (socket, next) => {
    try {
      const token = cookie.parse(socket.handshake.headers.cookie ?? '')[cookieName()];
      const s = token ? await lookup(token) : null;
      if (!s || !isLive(s)) return next(new Error('UNAUTHENTICATED'));
      if ((s.user.role !== 'admin' && s.user.firstLogin) || (s.user.role === 'admin' && s.user.mustChangePassword)) return next(new Error('FORBIDDEN'));
      (socket.data as SocketData) = { userId: s.userId, role: s.user.role, loginSessionId: s.id };
      next();
    } catch {
      next(new Error('UNAUTHENTICATED'));
    }
  });

  const typingAt = new Map<string, number>(); // lossy by design, one entry per user+conversation

  io.on('connection', (socket: Socket) => {
    const data = socket.data as SocketData;
    void socket.join(`user:${data.userId}`);
    // Join every conversation the user is currently a member of (one query). Clients never choose rooms.
    void prisma.conversationMember
      .findMany({ where: { userId: data.userId, leftAt: null }, select: { conversationId: true } })
      .then((ms) => socket.join(ms.map((m) => `conv:${m.conversationId}`)))
      .then(() => socket.emit('ready'))
      .catch((err) => logger.warn({ err }, 'socket room join failed'));

    // Revalidate periodically so a session ended elsewhere cannot linger.
    const timer = setInterval(() => {
      void (async () => {
        const s = await prisma.loginSession.findUnique({ where: { id: data.loginSessionId }, include: { user: true } });
        if (!s || !isLive(s)) socket.disconnect(true);
      })();
    }, opts.revalidateMs ?? 5 * 60 * 1000);
    socket.on('disconnect', () => clearInterval(timer));

    // Message content is never logged here, ids only (CONV-06).
    socket.on('msg:send', (payload: unknown, cb?: unknown) => {
      const done = ack(cb);
      const p = socketSend.safeParse(payload);
      if (!p.success) return done({ ok: false, code: 'VALIDATION_ERROR' });
      sendMessage({ id: data.userId, role: data.role }, p.data.conversationId, { text: p.data.text, attachmentId: p.data.attachmentId, clientId: p.data.clientId })
        .then((message) => done({ ok: true, message }))
        .catch((e: unknown) => {
          const code = (e as { code?: string }).code ?? 'INTERNAL_ERROR';
          if (code === 'INTERNAL_ERROR') logger.error({ conversationId: p.data.conversationId }, 'msg:send failed');
          done({ ok: false, code, message: (e as Error).message });
        });
    });

    socket.on('msg:typing', (payload: unknown) => {
      const p = socketTyping.safeParse(payload);
      if (!p.success || !socket.rooms.has(`conv:${p.data.conversationId}`)) return;
      const key = `${data.userId}:${p.data.conversationId}`;
      const t = Date.now();
      if (t - (typingAt.get(key) ?? 0) < 3000) return;
      typingAt.set(key, t);
      if (typingAt.size > 5000) for (const [k, v] of typingAt) if (t - v > 10_000) typingAt.delete(k);
      socket.to(`conv:${p.data.conversationId}`).emit('msg:typing', { conversationId: p.data.conversationId, userId: data.userId });
    });

    socket.on('msg:read', (payload: unknown, cb?: unknown) => {
      const done = ack(cb);
      const p = socketRead.safeParse(payload);
      if (!p.success) return done({ ok: false, code: 'VALIDATION_ERROR' });
      markRead({ id: data.userId, role: data.role }, p.data.conversationId, p.data.messageId)
        .then(() => done({ ok: true }))
        .catch((e: unknown) => done({ ok: false, code: (e as { code?: string }).code ?? 'INTERNAL_ERROR' }));
    });

    socket.on('presence:ping', () => {
      void prisma.loginSession.update({ where: { id: data.loginSessionId }, data: { lastSeenAt: new Date() } }).catch(() => {});
    });
  });

  setRevokeListener((userId, exceptSessionId) => {
    for (const [, socket] of io.sockets.sockets) {
      const d = socket.data as SocketData;
      if (d.userId === userId && d.loginSessionId !== exceptSessionId) {
        socket.emit('session:revoked');
        socket.disconnect(true);
      }
    }
  });
  setNotifyEmitter((userId, payload) => void io.to(`user:${userId}`).emit('notif:new', payload));
  setEmitter({
    toUser: (userId, event, payload) => void io.to(`user:${userId}`).emit(event, payload),
    toConversation: (conversationId, event, payload, except = []) =>
      void io.to(`conv:${conversationId}`).except(except.map((u) => `user:${u}`)).emit(event, payload),
    isOnline: (userId) => (io.sockets.adapter.rooms.get(`user:${userId}`)?.size ?? 0) > 0,
  });
  // Live sockets follow membership changes (07 §2.3) and are told about them.
  setRoomHook((userId, diff) => {
    for (const [, socket] of io.sockets.sockets) {
      if ((socket.data as SocketData).userId !== userId) continue;
      for (const c of diff.joined) void socket.join(`conv:${c}`);
      for (const c of diff.left) void socket.leave(`conv:${c}`);
    }
    for (const c of diff.joined) io.to(`user:${userId}`).emit('conv:joined', { conversationId: c });
    for (const c of diff.left) io.to(`user:${userId}`).emit('conv:left', { conversationId: c });
  });
  return io;
}
