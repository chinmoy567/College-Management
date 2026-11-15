/**
 * OPS-06 chat load: every student in the fixture's conversations opens a socket (200), then MSG_PER_S messages per
 * second are sent (random sender) for DURATION_S seconds. Delivery = sender emit -> each other member's `msg:new`.
 * Writes test-results/load/chat.json.
 */
import { io, type Socket } from 'socket.io-client';
import { BASE, COOKIE, fixture, pct, save, sleep } from './lib';

const DURATION_S = Number(process.env.DURATION_S ?? 120);
const RATE = Number(process.env.MSG_PER_S ?? 1);

async function main() {
  const f = fixture();
  const sockets: { s: Socket; conv: string }[] = [];
  const latencies: number[] = [];
  const errors: string[] = [];
  const acks: number[] = [];
  await Promise.all(
    f.conversations.flatMap((c) =>
      c.tokens.map(
        (token, i) =>
          new Promise<void>((resolve) => {
            const s = io(BASE, { extraHeaders: { cookie: `${COOKIE}=${token}` }, transports: ['websocket'], reconnection: false });
            s.on('msg:new', (m: { text?: string; senderId?: string }) => {
              const t = /^L(\d+)$/.exec(m.text ?? '');
              if (t && m.senderId !== c.userIds[i]) latencies.push(Date.now() - Number(t[1]));
            });
            s.on('connect_error', (e) => { errors.push(`connect:${e.message}`); resolve(); });
            s.on('ready', () => { sockets.push({ s, conv: c.id }); resolve(); });
          }),
      ),
    ),
  );
  console.log(`chat load: ${sockets.length} sockets connected, ${RATE}/s for ${DURATION_S}s`);

  let sent = 0;
  const end = Date.now() + DURATION_S * 1000;
  while (Date.now() < end) {
    const tick = Date.now();
    for (let k = 0; k < RATE; k++) {
      const x = sockets[Math.floor(Math.random() * sockets.length)]!;
      const t0 = Date.now();
      sent++;
      x.s.timeout(10_000).emit('msg:send', { conversationId: x.conv, text: `L${t0}`, clientId: `c${t0}-${sent}` }, (e: unknown, r: { ok: boolean; code?: string }) => {
        if (e || !r?.ok) errors.push(`send:${r?.code ?? 'timeout'}`);
        else acks.push(Date.now() - t0);
      });
    }
    await sleep(Math.max(0, 1000 - (Date.now() - tick)));
  }
  await sleep(3000);
  sockets.forEach((x) => x.s.close());
  const out = {
    sockets: sockets.length, messagesSent: sent, deliveries: latencies.length, durationSeconds: DURATION_S,
    p50DeliveryMs: pct(latencies, 50), p95DeliveryMs: pct(latencies, 95), p99DeliveryMs: pct(latencies, 99), p95AckMs: pct(acks, 95),
    errors: errors.length, errorKinds: [...new Set(errors)], ranAt: new Date().toISOString(),
  };
  save('chat.json', out);
  console.log(out);
}
void main();
