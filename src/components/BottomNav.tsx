'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { basketCount, onBasketChange } from '@/lib/basket-client';

const LINKS = [
  { href: '/', label: 'Căutare', icon: '🔍' },
  { href: '/cos', label: 'Coșul meu', icon: '🧺' },
  { href: '/admin', label: 'Admin', icon: '⚙️' }
];

export function BottomNav(): JSX.Element {
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(basketCount());
    return onBasketChange(() => setCount(basketCount()));
  }, []);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t bg-white shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
      <div className="mx-auto flex max-w-3xl">
        {LINKS.map((l) => {
          const active = pathname === l.href;
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`relative flex flex-1 flex-col items-center py-2 text-xs ${
                active ? 'font-semibold text-brand-600' : 'text-gray-500'
              }`}
            >
              <span className="text-xl">{l.icon}</span>
              {l.label}
              {l.href === '/cos' && count > 0 && (
                <span className="absolute right-1/4 top-1 rounded-full bg-brand-600 px-1.5 text-[10px] font-bold text-white">
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
