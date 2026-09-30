'use client'

import { createContext, useContext, useState } from 'react'
import { AlertCircle } from 'lucide-react'

// Mini alerta ao lado de cada dado que veio da Receita Federal, só para
// administradores. É aviso de procedência, não controle de acesso: os dados
// em si são os mesmos para todos. Quem decide se aparece é o servidor
// (role da sessão), via `ehAdmin` da busca.

interface ContextoReceita {
  visivel: boolean
  /** Mês de referência do catálogo RF ('2026-09'), quando conhecido. */
  mesRf: string | null
}

const Contexto = createContext<ContextoReceita>({ visivel: false, mesRf: null })

export const ProvedorSeloReceita = Contexto.Provider

export default function SeloReceita({ via }: { via?: string }) {
  const { visivel, mesRf } = useContext(Contexto)
  const [posicao, setPosicao] = useState<{ x: number; y: number } | null>(null)
  if (!visivel) return null

  const detalhe = [via ? `Consultado via ${via}.` : 'Dados abertos do CNPJ.', mesRf && !via ? `Referência ${mesRf}.` : null, 'Pode estar desatualizado.']
    .filter(Boolean)
    .join(' ')

  // position:fixed escapa do overflow da tabela, que cortaria um balão absoluto.
  function mostrar(e: React.SyntheticEvent<HTMLSpanElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    setPosicao({ x: r.left + r.width / 2, y: r.top })
  }

  return (
    <span
      tabIndex={0}
      role="img"
      aria-label={`Informação da Receita Federal. ${detalhe}`}
      onMouseEnter={mostrar}
      onMouseLeave={() => setPosicao(null)}
      onFocus={mostrar}
      onBlur={() => setPosicao(null)}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex shrink-0 cursor-help align-middle text-amber-400/80 hover:text-amber-300 focus-ring rounded-full"
    >
      <AlertCircle size={12} aria-hidden="true" />
      {posicao && (
        <span
          role="tooltip"
          style={{ left: posicao.x, top: posicao.y - 8 }}
          className="pointer-events-none fixed z-50 w-60 -translate-x-1/2 -translate-y-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-card)] px-3 py-2 text-left text-xs font-normal normal-case tracking-normal text-slate-300 shadow-lg"
        >
          <strong className="block font-semibold text-amber-300">Informação da Receita Federal</strong>
          {detalhe}
        </span>
      )}
    </span>
  )
}
