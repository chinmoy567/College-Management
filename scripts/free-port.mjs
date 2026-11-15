// Frees the dev API port before `npm run dev` by stopping a leftover node process (orphaned `tsx watch`).
// Only node processes are killed; anything else on the port is reported and left alone.
import { execSync } from 'node:child_process';

const port = Number(process.argv[2] ?? process.env.PORT ?? 3000);
const run = (c) => { try { return execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };

let pids = [];
if (process.platform === 'win32') {
  const rows = run('netstat -ano -p tcp').split('\n').map((l) => l.trim().split(/\s+/));
  pids = [...new Set(rows.filter((c) => c[3] === 'LISTENING' && c[1]?.endsWith(':' + port)).map((c) => c[4]))];
} else {
  pids = run(`lsof -ti tcp:${port} -sTCP:LISTEN`).split('\n').filter(Boolean);
}

for (const pid of pids) {
  if (!pid || pid === '0') continue;
  const name = process.platform === 'win32'
    ? run(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`).toLowerCase()
    : run(`ps -p ${pid} -o comm=`).toLowerCase();
  if (!name.includes('node')) { console.warn(`Port ${port} is used by a non-node process (PID ${pid}); not killing it.`); continue; }
  run(process.platform === 'win32' ? `taskkill /PID ${pid} /F /T` : `kill -9 ${pid}`);
  console.log(`Stopped leftover dev server on port ${port} (PID ${pid}).`);
}
