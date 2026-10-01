'use client'

import type { AvaliacaoTela, Decisor } from './DetalheEmpresa'
import { normalizarPerfilLinkedIn } from '@/lib/prospeccao/contato'
import { iniciais } from '@/lib/prospeccao/rotulos'

// Coluna "Decisor" da lista: mesmo peso visual da coluna Empresa (avatar,
// nome, linha de apoio), sem caixa colorida, para não parecer um item aberto
// ou selecionado. O estado da consulta vira um ponto colorido com texto curto.
export default function DecisorCelula({ decisor, avaliacao }: { decisor: Decisor | null; avaliacao: AvaliacaoTela | null }) {
  if (!decisor?.nome) {
    return (
      <span className="text-xs text-slate-500">
        {avaliacao ? 'Sem decisor definido' : 'Não analisado'}
      </span>
    )
  }

  const donoDoEmail = !!avaliacao?.emailNominalDe && avaliacao.emailNominalDe === decisor.nome
  const precisaOutro = avaliacao?.status === 'precisa_outro_decisor'
  const socioServe = avaliacao?.status === 'socio_serve'
  const perfil = normalizarPerfilLinkedIn(decisor.linkedin)

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/5 text-[11px] font-semibold text-slate-300 ring-1 ring-inset ring-white/10">
        {iniciais(decisor.nome)}
      </span>
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm text-slate-100" title={decisor.nome}>{decisor.nome}</span>
          {perfil && (
            <a href={perfil} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
              title={`Abrir o perfil de ${decisor.nome} no LinkedIn`} aria-label={`Perfil de ${decisor.nome} no LinkedIn`}
              className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] bg-[#0a66c2] text-[9px] font-bold leading-none text-white hover:brightness-125">
              in
            </a>
          )}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-slate-500">
          {(socioServe || precisaOutro) && (
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${precisaOutro ? 'bg-amber-400' : 'bg-emerald-400'}`}
              title={precisaOutro ? 'Precisa de outro decisor' : 'Sócio serve: tem cargo-alvo do perfil'}
            />
          )}
          <span className="truncate" title={decisor.cargo || undefined}>
            {[decisor.cargo, precisaOutro ? 'precisa de outro' : null, donoDoEmail ? 'dono do e-mail' : null].filter(Boolean).join(' · ')}
          </span>
        </span>
      </span>
    </div>
  )
}
