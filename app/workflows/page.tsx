// A LISTA de workflows saiu da sidebar (consolidação 11/08): agora é aba dentro
// de Automação. O editor continua em /workflows/[id]. A rota antiga redireciona.
import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/campanhas?tab=workflows');
}
