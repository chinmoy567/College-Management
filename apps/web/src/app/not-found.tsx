import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-4 p-4 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Link href="/" className="flex min-h-11 items-center rounded-lg bg-indigo-600 px-4 font-medium text-white">
        Go to the home page
      </Link>
    </main>
  );
}
