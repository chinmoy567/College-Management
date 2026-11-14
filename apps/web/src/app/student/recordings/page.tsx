'use client';

import { PageTitle } from '@/components/ui';
import { RecordingList } from '@/components/RecordingList';

export default function StudentRecordings() {
  return (
    <>
      <PageTitle>Recorded classes</PageTitle>
      <RecordingList student />
    </>
  );
}
