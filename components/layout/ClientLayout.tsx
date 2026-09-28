'use client';

import { usePathname } from 'next/navigation';
import { AppProvider } from '@/contexts/AppContext';
import Sidebar from './Sidebar';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Páginas de autenticação/onboarding são renderizadas em tela cheia, sem o sidebar
  if (pathname === '/login' || pathname === '/definir-senha' || pathname === '/meu-perfil' || pathname === '/criar-organizacao') {
    return <>{children}</>;
  }

  return (
    <AppProvider>
      <div className="flex h-screen overflow-hidden bg-[var(--bg-base)]">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </AppProvider>
  );
}
