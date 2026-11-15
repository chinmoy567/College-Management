// Frees the dev API port before `npm run dev` by stopping leftover dev servers (orphaned or still-running `tsx watch`).
// Only node processes are killed; anything else on the port is reported and left alone.
import { execSync } from 'node:child_process';

const port = Number(process.argv[2] ?? process.env.PORT ?? 3000);
const run = (c) => { try { return execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };
const win = process.platform === 'win32';

// 1) Kill leftover `tsx watch` parents first. Killing only the port listener is not enough: a live
//    watcher respawns its child (e.g. when build:shared rewrites dist) and takes the port again.
//    Our own ancestors (this npm run) are never killed.
let watchers = [];
if (win) {
  const ps = [
    '$me=' + process.pid + ';$anc=@();',
    'while($me){$anc+=$me;$x=Get-CimInstance Win32_Process -Filter "ProcessId=$me";if(-not $x){break};$me=$x.ParentProcessId};',
    'Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" |',
    ' Where-Object { $_.CommandLine -match \'tsx.dist.cli\\.mjs"?\\s+watch\' -and $anc -notcontains $_.ProcessId } |',
    ' ForEach-Object { $_.ProcessId }',
  ].join('');
  const enc = Buffer.from(ps, 'utf16le').toString('base64');
  watchers = run(`powershell -NoProfile -EncodedCommand ${enc}`).split(/\s+/).filter(Boolean);
} else {
  watchers = run('pgrep -f "tsx.*watch src/server.ts"').split('\n').filter((x) => x && Number(x) !== process.pid && Number(x) !== process.ppid);
}
for (const w of watchers) {
  run(win ? `taskkill /PID ${w} /F /T` : `kill -9 ${w}`);
  console.log(`Stopped leftover tsx watch (PID ${w}).`);
}

// 2) Free the port itself (a listener that survived, or one with no watcher parent).
let pids = [];
if (win) {
  const rows = run('netstat -ano -p tcp').split('\n').map((l) => l.trim().split(/\s+/));
  pids = [...new Set(rows.filter((c) => c[3] === 'LISTENING' && c[1]?.endsWith(':' + port)).map((c) => c[4]))];
} else {
  pids = run(`lsof -ti tcp:${port} -sTCP:LISTEN`).split('\n').filter(Boolean);
}

for (const pid of pids) {
  if (!pid || pid === '0') continue;
  const name = win
    ? run(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`).toLowerCase()
    : run(`ps -p ${pid} -o comm=`).toLowerCase();
  if (!name.includes('node')) { console.warn(`Port ${port} is used by a non-node process (PID ${pid}); not killing it.`); continue; }
  run(win ? `taskkill /PID ${pid} /F /T` : `kill -9 ${pid}`);
  console.log(`Stopped leftover dev server on port ${port} (PID ${pid}).`);
}
