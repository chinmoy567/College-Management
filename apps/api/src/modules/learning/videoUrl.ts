export interface ParsedVideo {
  source: 'youtube' | 'drive';
  videoId: string;
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,100}$/;

/** YouTube (watch, youtu.be, shorts, live) and Google Drive file links only; anything else is null (08 §2). */
export function parseVideoUrl(raw: string): ParsedVideo | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const parts = u.pathname.split('/').filter(Boolean);
  if (host === 'youtu.be') return parts[0] && YT_ID.test(parts[0]) ? { source: 'youtube', videoId: parts[0] } : null;
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    if (u.pathname === '/watch') {
      const v = u.searchParams.get('v');
      return v && YT_ID.test(v) ? { source: 'youtube', videoId: v } : null;
    }
    if ((parts[0] === 'shorts' || parts[0] === 'live') && parts[1] && YT_ID.test(parts[1])) return { source: 'youtube', videoId: parts[1] };
    return null;
  }
  if (host === 'drive.google.com' && parts[0] === 'file' && parts[1] === 'd' && parts[2] && DRIVE_ID.test(parts[2])) {
    return { source: 'drive', videoId: parts[2] };
  }
  return null;
}

export const embedUrl = (source: 'youtube' | 'drive', videoId: string): string =>
  source === 'youtube' ? `https://www.youtube-nocookie.com/embed/${videoId}` : `https://drive.google.com/file/d/${videoId}/preview`;

export function detectPlatform(joinUrl: string): 'meet' | 'jitsi' | 'other' {
  const host = new URL(joinUrl).hostname.toLowerCase();
  if (host === 'meet.google.com') return 'meet';
  if (host === 'meet.jit.si') return 'jitsi';
  return 'other';
}
