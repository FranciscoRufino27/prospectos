// Subpáginas de campanha (nova, detalhe, edição, mensagens) herdam a paleta do
// módulo Campanhas. O grupo (paginas) não entra na URL: /campanhas/[id], /campanhas/nova.
// Cada uma mantém o próprio cabeçalho e espaçamento.
import { CoresModulo } from '@/components/tema/Modulo';

export default function CampanhasLayout({ children }: { children: React.ReactNode }) {
  return <CoresModulo>{children}</CoresModulo>;
}
