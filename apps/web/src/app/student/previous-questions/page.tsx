'use client';

import { PageTitle } from '@/components/ui';
import { PreviousList } from '@/components/PreviousList';

export default function StudentPrevious() {
  return (
    <>
      <PageTitle>Previous questions</PageTitle>
      <PreviousList />
    </>
  );
}
