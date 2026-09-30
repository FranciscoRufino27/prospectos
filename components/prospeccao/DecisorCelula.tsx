'use client'

import { AlertTriangle, CheckCircle2, Mail, UserRound, UserSearch } from 'lucide-react'
import type { AvaliacaoTela, Decisor } from './DetalheEmpresa'

// Coluna "Decisor" da lista: campo próprio, em destaque, separado dos dados
// da empresa. Mostra quem vai receber o contato e o que a consulta de sócios
// disse dele. Sem consulta feita, convida a abrir o "analisar".
export default function DecisorCelula({ decisor, avaliacao }: { decisor: Decisor | null; avaliacao: AvaliacaoTela | null }) {
  if (!decisor?.nome) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[var(--border-strong)] px-2 py-1 text-xs text-slate-500">
        <UserSearch size={13} className="shrink-0" />
        {avaliacao ? 'Sem decisor definido' : 'Ver decisor'}
      </span>
    )
  }

  const donoDoEmail = !!avaliacao?.emailNominalDe && avaliacao.emailNominalDe === decisor.nome
  const precisaOutro = avaliacao?.status === 'precisa_outro_decisor'

  return (
    <div
      className={`flex min-w-0 items-start gap-2 rounded-lg px-2 py-1.5 ring-1 ring-inset ${
        precisaOutro ? 'bg-amber-500/10 ring-amber-500/30' : 'bg-[var(--accent-soft)] ring-indigo-500/30'
      }`}
    >
      <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${precisaOutro ? 'bg-amber-500/20 text-amber-300' : 'bg-[var(--accent)] text-white'}`}>
        <UserRound size={13} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-slate-100" title={decisor.nome}>{decisor.nome}</span>
        {decisor.cargo && <span className="block truncate text-xs text-slate-400" title={decisor.cargo}>{decisor.cargo}</span>}
        <span className="mt-1 flex flex-wrap gap-1">
          {avaliacao?.status === 'socio_serve' && (
            <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
              <CheckCircle2 size={10} /> Sócio serve
            </span>
          )}
          {precisaOutro && (
            <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
              <AlertTriangle size={10} /> Precisa de outro
            </span>
          )}
          {donoDoEmail && (
            <span className="inline-flex items-center gap-1 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">
              <Mail size={10} /> Dono do e-mail
            </span>
          )}
        </span>
      </span>
    </div>
  )
}
