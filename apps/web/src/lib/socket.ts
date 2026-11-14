'use client';

import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;
/** One shared connection per tab; the cookie session authenticates it (07 §1). Rooms are chosen by the server. */
export function getSocket(): Socket {
  if (!socket) socket = io({ withCredentials: true, reconnectionDelayMax: 5000 });
  return socket;
}

/** Subscribes to a server event while the component is mounted. */
export function useSocketEvent<T = unknown>(event: string, handler: (payload: T) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const s = getSocket();
    const fn = (p: T) => ref.current(p);
    s.on(event, fn);
    return () => void s.off(event, fn);
  }, [event]);
}

/** Calls `fn` on every (re)connect, e.g. to fill message gaps after a drop. */
export function useOnConnect(fn: () => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const s = getSocket();
    const h = () => ref.current();
    s.on('connect', h);
    if (s.connected) h();
    return () => void s.off('connect', h);
  }, []);
}
