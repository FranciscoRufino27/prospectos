import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import './globals.css';
import ClientLayout from '@/components/layout/ClientLayout';
import { COOKIE_TEMA, parseTema } from '@/lib/tema/tema';

export const metadata: Metadata = {
  title: 'ProspectOS — InovaCode',
  description: 'Plataforma de prospecção B2B automatizada',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Tema do usuário vem do cookie já no servidor: a página chega pintada certa.
  const tema = parseTema((await cookies()).get(COOKIE_TEMA)?.value);
  return (
    <html lang="pt-BR" className="h-full" data-tema={tema}>
      <body className="h-full">
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}
