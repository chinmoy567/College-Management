import type { Server as HttpServer } from 'node:http';
import cookie from 'cookie';
import { Server } from 'socket.io';
import { prisma } from '../../db';
import { isLive, lookup, setRevokeListener } from '../auth/sessions';
import { cookieName } from '../../middleware/session';
import { setRoomHook } from '../../lib/chatMembership';
import { setNotifyEmitter } from '../../lib/notify';

interface SocketData {
  userId: string;
  loginSessionId: string;
}

/** Socket.IO with the same cookie session as HTTP (02 §1). Chat events arrive in M9. */
export function createSocketServer(server: HttpServer, opts: { revalidateMs?: number } = {}): Server {
  const io = new Server(server);

  io.use(async (socket, next) => {
    try {
      const token = cookie.parse(socket.handshake.headers.cookie ?? '')[cookieName()];
      const s = token ? await lookup(token) : null;
      if (!s || !isLive(s)) return next(new Error('UNAUTHENTICATED'));
      if (s.stepUpPending || (s.user.role !== 'admin' && s.user.firstLogin)) return next(new Error('FORBIDDEN'));
      (socket.data as SocketData) = { userId: s.userId, loginSessionId: s.id };
      next();
    } catch {
      next(new Error('UNAUTHENTICATED'));
    }
  });

  io.on('connection', (socket) => {
    const data = socket.data as SocketData;
    void socket.join(`user:${data.userId}`);
    // Revalidate periodically so a session ended elsewhere cannot linger.
    const timer = setInterval(() => {
      void (async () => {
        const s = await prisma.loginSession.findUnique({ where: { id: data.loginSessionId }, include: { user: true } });
        if (!s || !isLive(s)) socket.disconnect(true);
      })();
    }, opts.revalidateMs ?? 5 * 60 * 1000);
    socket.on('disconnect', () => clearInterval(timer));
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
  // Live sockets follow membership changes (07 §2.3); chat events themselves arrive in M9.
  setRoomHook((userId, diff) => {
    for (const [, socket] of io.sockets.sockets) {
      if ((socket.data as SocketData).userId !== userId) continue;
      for (const c of diff.joined) void socket.join(`conv:${c}`);
      for (const c of diff.left) void socket.leave(`conv:${c}`);
    }
  });
  return io;
}
