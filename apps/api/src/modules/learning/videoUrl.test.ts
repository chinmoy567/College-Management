import { describe, expect, it } from 'vitest';
import { detectPlatform, embedUrl, parseVideoUrl } from './videoUrl';

describe('video url parser', () => {
  it('[LRN-04] accepts YouTube and Drive links, rejects others', () => {
    const id = 'dQw4w9WgXcQ';
    expect(parseVideoUrl(`https://www.youtube.com/watch?v=${id}&t=3`)).toEqual({ source: 'youtube', videoId: id });
    expect(parseVideoUrl(`https://youtu.be/${id}`)).toEqual({ source: 'youtube', videoId: id });
    expect(parseVideoUrl(`https://youtube.com/shorts/${id}`)).toEqual({ source: 'youtube', videoId: id });
    expect(parseVideoUrl(`https://www.youtube.com/live/${id}`)).toEqual({ source: 'youtube', videoId: id });
    expect(parseVideoUrl('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing')).toEqual({ source: 'drive', videoId: '1AbCdEfGhIjKlMnOp' });
    for (const bad of ['https://vimeo.com/123', 'https://evil.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ', 'javascript:alert(1)', 'not a url', `https://www.youtube.com/watch?v=short`, 'https://drive.google.com/drive/folders/abc']) {
      expect(parseVideoUrl(bad), bad).toBeNull();
    }
    expect(embedUrl('youtube', id)).toBe(`https://www.youtube-nocookie.com/embed/${id}`);
  });
  it('detects the meeting platform from the host', () => {
    expect(detectPlatform('https://meet.google.com/abc-defg-hij')).toBe('meet');
    expect(detectPlatform('https://meet.jit.si/Room')).toBe('jitsi');
    expect(detectPlatform('https://zoom.us/j/1')).toBe('other');
  });
});
