import Link from 'next/link';
import type { LegalDocument } from '@chamahub/shared';
import { BrandMark } from '@/components/shell/brand';
import { date } from '@/lib/utils';

/** A public, readable legal document (no sign-in needed). */
export function LegalPage({ doc }: { doc: LegalDocument }) {
  return (
    <main className="min-h-screen bg-canvas px-4 py-10">
      <article className="mx-auto max-w-2xl rounded-xl border border-line bg-white p-6 shadow-card sm:p-10">
        <Link href="/login" className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-plum">
          <BrandMark className="h-7 w-7" /> ChamaHub
        </Link>
        <h1 className="text-2xl font-bold text-plum">{doc.title}</h1>
        <p className="mt-1 text-sm text-muted">Last updated {date(doc.updated)}</p>
        {doc.draft && (
          <p className="mt-4 rounded-md bg-pending-50 px-3 py-2 text-sm text-pending-ink" role="note">
            Draft: the operator’s details have not been configured yet, and this document should be reviewed by a Kenyan advocate before ChamaHub goes live.
          </p>
        )}
        <p className="mt-5 text-[15px] leading-relaxed text-plum">{doc.intro}</p>
        {doc.sections.map((s) => (
          <section key={s.heading} className="mt-7">
            <h2 className="text-lg font-semibold text-plum">{s.heading}</h2>
            {s.paragraphs?.map((p) => <p key={p} className="mt-2 text-[15px] leading-relaxed text-plum/90">{p}</p>)}
            {s.bullets && <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed text-plum/90">{s.bullets.map((b) => <li key={b}>{b}</li>)}</ul>}
          </section>
        ))}
        <p className="mt-10 border-t border-line pt-4 text-sm text-muted">
          <Link href="/privacy" className="text-berry hover:underline">Privacy Policy</Link> · <Link href="/terms" className="text-berry hover:underline">Terms of Use</Link>
        </p>
      </article>
    </main>
  );
}
