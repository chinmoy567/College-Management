'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Button, Card, ErrorState, ListSkeleton, PageTitle } from '@/components/ui';
import { CommunityShell } from '@/components/community/CommunityShell';

interface Pref {
  type: string;
  email: boolean;
  push: boolean;
}
const LABELS: Record<string, string> = {
  notice_new: 'New notices', online_class_scheduled: 'Online class scheduled', online_class_starting: 'Online class starting',
  online_class_changed: 'Online class changed', online_class_cancelled: 'Online class cancelled', recording_new: 'New recordings',
  material_new: 'New materials', exam_published: 'Exam published', exam_starting_soon: 'Exam starting soon', result_published: 'Result published',
  exam_key_fixed: 'Exam answer fixed', pinned_post: 'Pinned posts', reaction: 'Reactions', comment: 'Comments', reply: 'Replies',
  new_message: 'New messages', course_assignment_changed: 'Course assignment changed', mentor_assigned: 'Mentor assigned',
  marked_absent: 'Marked absent', attendance_below_threshold: 'Attendance warning', routine_changed: 'Routine changed',
  class_cancelled: 'Class cancelled', substitute_assigned: 'Substitute assigned', content_removed: 'Content removed', warning: 'Warnings', muted: 'Mute',
};

const b64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));

function Settings() {
  const q = useQuery({ queryKey: ['prefs'], queryFn: () => api<{ prefs: Pref[]; note: string }>('/me/notification-prefs') });
  const [prefs, setPrefs] = useState<Pref[]>([]);
  const [msg, setMsg] = useState('');
  useEffect(() => void (q.data && setPrefs(q.data.prefs)), [q.data]);
  const set = (type: string, k: 'email' | 'push', v: boolean) => setPrefs((p) => p.map((x) => (x.type === type ? { ...x, [k]: v } : x)));
  const save = async () => {
    try {
      await api('/me/notification-prefs', { method: 'PUT', json: { prefs } });
      setMsg('Saved.');
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Could not save.');
    }
  };
  const enablePush = async () => {
    try {
      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key || !('serviceWorker' in navigator) || !('PushManager' in window)) return setMsg('Push is not available on this device.');
      if ((await Notification.requestPermission()) !== 'granted') return setMsg('Notifications are blocked in the browser settings.');
      const reg = await navigator.serviceWorker.register('/sw.js');
      const sub = await (await navigator.serviceWorker.ready).pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
      void reg;
      const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await api('/me/push-subscriptions', { method: 'POST', json: { endpoint: j.endpoint, keys: j.keys } });
      setMsg('Push notifications are on for this device.');
    } catch {
      setMsg('Could not turn on push notifications.');
    }
  };
  if (q.isPending) return <ListSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  return (
    <>
      <PageTitle>Notification settings</PageTitle>
      <Card className="mb-3 flex flex-col gap-2">
        <p className="text-base">Urgent notices are always emailed, whatever you choose below.</p>
        <Button variant="secondary" onClick={() => void enablePush()}>Turn on push on this device</Button>
      </Card>
      <div className="flex flex-col gap-2">
        {prefs.map((p) => (
          <Card key={p.type} className="flex items-center justify-between gap-3">
            <span className="text-base font-medium">{LABELS[p.type] ?? p.type}</span>
            <span className="flex gap-3">
              <label className="flex min-h-11 items-center gap-1 text-base"><input type="checkbox" className="size-5" checked={p.email} onChange={(e) => set(p.type, 'email', e.target.checked)} /> Email</label>
              <label className="flex min-h-11 items-center gap-1 text-base"><input type="checkbox" className="size-5" checked={p.push} onChange={(e) => set(p.type, 'push', e.target.checked)} /> Push</label>
            </span>
          </Card>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button onClick={() => void save()}>Save</Button>
        <Link href="/notifications" className="text-base text-indigo-700 underline">Back</Link>
        {msg && <p role="status" className="text-base">{msg}</p>}
      </div>
    </>
  );
}

export default function SettingsPage() {
  return <CommunityShell>{() => <Settings />}</CommunityShell>;
}
