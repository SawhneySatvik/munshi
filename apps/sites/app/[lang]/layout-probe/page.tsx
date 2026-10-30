import { notFound } from 'next/navigation';
import { SLUG } from '../../../lib/api.ts';
import { href, isLang } from '../../../lib/i18n.ts';

export default async function LayoutProbe({ params }: { params: Promise<{ lang: string }> }) {
  if (process.env.VERCEL_ENV !== 'preview') notFound();
  const { lang: rawLang } = await params;
  if (!isLang(rawLang)) notFound();
  return (
    <main>
      <p>Vercel service probe</p>
      <h1>{SLUG} service</h1>
      <a href={href(rawLang, '/layout-probe')}>Reload this service</a>
    </main>
  );
}
