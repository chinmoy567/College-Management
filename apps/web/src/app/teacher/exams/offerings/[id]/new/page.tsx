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
      <p className="mb-4 text-base text-slate-600">Step 1: set the time and rules. Step 2 (next screen): add your MCQ questions and their options.</p>
      <ExamForm
        offeringId={id}
        submitLabel="Save and add questions"
        onSubmit={async (v) => {
          const e = await api<{ id: string }>('/exams', { method: 'POST', json: { offeringId: id, ...v, instructions: v.instructions || null } });
          await qc.invalidateQueries({ queryKey: ['offering-exams', id] });
          router.push(`/teacher/exams/${e.id}`);
        }}
      />
    </>
  );
}
