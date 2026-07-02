import type { Metadata, Viewport } from 'next';
import './globals.css';
import { BottomNav } from '@/components/BottomNav';
import { RegisterSW } from '@/components/RegisterSW';

export const metadata: Metadata = {
  title: 'Coșul Ieftin — compară prețurile la cumpărături',
  description:
    'Caută produse din Lidl, Kaufland, Profi și alte supermarketuri din România și află unde e cel mai ieftin coșul tău.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Coșul Ieftin' }
};

export const viewport: Viewport = {
  themeColor: '#16a34a',
  width: 'device-width',
  initialScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <html lang="ro">
      <body className="min-h-screen pb-20">
        <header className="sticky top-0 z-20 bg-brand-600 text-white shadow">
          <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
            <span className="text-xl">🛒</span>
            <h1 className="text-lg font-bold">Coșul Ieftin</h1>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-4">{children}</main>
        <BottomNav />
        <RegisterSW />
      </body>
    </html>
  );
}
