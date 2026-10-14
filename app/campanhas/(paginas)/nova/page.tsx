// Nova campanha — wizard em página própria (não modal). Cria em `campanhas`.
import CampanhaWizardPage from '@/components/automacao/CampanhaWizardPage';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string; leads?: string }>;
}) {
  const query = await searchParams;
  const leadIds = (query.leads ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 2000);
  return <CampanhaWizardPage inicial={{ tipo: query.tipo, leadIds }} />;
}
