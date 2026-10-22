import Link from 'next/link';
import { BrandMark } from '@/components/shell/brand';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="max-w-sm text-center">
        <BrandMark className="mx-auto h-10 w-10" />
        <p className="mt-4 text-sm font-semibold uppercase tracking-wider text-berry">404</p>
        <h1 className="mt-1 text-xl font-bold text-plum">We could not find that page</h1>
        <p className="mt-2 text-sm text-muted">The link may be old, or the page may have moved. Your Chama records are safe.</p>
        <div className="mt-6 flex justify-center gap-2">
          <Link href="/" className="rounded-md bg-berry px-4 py-2 text-sm font-semibold text-white hover:bg-berry/90">Go to my home</Link>
          <Link href="/chamas" className="rounded-md border border-line bg-white px-4 py-2 text-sm text-plum hover:bg-blush/50">My Chamas</Link>
        </div>
      </div>
    </main>
  );
}
