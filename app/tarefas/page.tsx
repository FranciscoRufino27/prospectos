// Tarefas deixou de ser item de sidebar (consolidação 11/08): aparece
// contextualmente em Automação › Execuções (backend de tarefas preservado).
// A rota antiga redireciona.
import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/campanhas?tab=execucoes');
}
