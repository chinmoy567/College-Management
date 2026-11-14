'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageTitle } from '@/components/ui';
import { ExamForm } from '@/components/ExamForm';

export default function NewExam() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  return (
    <>
      <PageTitle>New exam</PageTitle>
      <ExamForm
        offeringId={id}
        submitLabel="Create draft"
        onSubmit={async (v) => {
          const e = await api<{ id: string }>('/exams', { method: 'POST', json: { offeringId: id, ...v, instructions: v.instructions || null } });
          await qc.invalidateQueries({ queryKey: ['offering-exams', id] });
          router.push(`/teacher/exams/${e.id}`);
        }}
      />
    </>
  );
}
