'use client';

import { Button, Card } from './ui';

export interface SlipData {
  role: string;
  name: string;
  loginId: string;
  password: string;
  placement?: string;
}

/**
 * Credential slip print view. Shown once: the password lives only in this component's props and is never
 * stored. Print CSS hides everything else (see globals.css `.slip-root`).
 */
export function Slip({ slips, onClose }: { slips: SlipData[]; onClose: () => void }) {
  return (
    <div className="slip-root fixed inset-0 z-[60] overflow-y-auto bg-white p-4" role="dialog" aria-modal="true" aria-label="Credential slip">
      <div className="mx-auto flex max-w-md flex-col gap-4">
        <p className="print:hidden rounded-lg bg-amber-100 p-3 text-base text-amber-900">
          Print or save this slip now. The password is shown only once and cannot be viewed again.
        </p>
        {slips.map((s) => (
          <Card key={s.loginId} className="flex flex-col gap-2 border-2 border-slate-400">
            <p className="text-lg font-semibold">College login slip</p>
            <p className="text-base">{s.role}: {s.name}</p>
            {s.placement && <p className="text-base">{s.placement}</p>}
            <p className="text-base">
              Login ID: <strong data-testid="slip-login">{s.loginId}</strong>
            </p>
            <p className="text-base">
              Password: <strong data-testid="slip-password" className="font-mono">{s.password}</strong>
            </p>
            <p className="text-sm text-slate-600">Change this password and complete your profile on first login. Keep this slip private.</p>
          </Card>
        ))}
        <div className="print:hidden flex flex-col gap-2">
          <Button onClick={() => window.print()}>Print slip</Button>
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
