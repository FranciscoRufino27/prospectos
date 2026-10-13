'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { EsqueletoLinhas } from './Esqueleto'

// Peças compartilhadas das tabelas paginadas de leads (Base de Leads e
// Pipeline > Tabela). Fonte única do rodapé de paginação e das linhas de
// estado (carregando / vazio) — antes duplicadas nas duas páginas.

// Linha única de estado do <tbody>: esqueleto enquanto carrega sem dados, ou
// mensagem de vazio. Renderizar só quando data.length === 0.
export function EstadoTabela({ colSpan, loading }: { colSpan: number; loading: boolean }) {
  return (
    <tr>
      <td colSpan={colSpan} className={loading ? 'px-5 py-5' : 'py-16 text-center text-slate-500 text-sm'}>
        {loading ? <EsqueletoLinhas linhas={8} /> : 'Nenhum lead encontrado com esses filtros.'}
      </td>
    </tr>
  )
}

// Rodapé "X–Y de Z" + Página N de M + Anterior/Próxima. Deriva início/fim/
// total de páginas de {total, page, pageSize}; o wrapper (borda, padding)
// vem via className porque difere entre as páginas.
export function PaginacaoTabela({
  total,
  page,
  pageSize,
  loading = false,
  onPageChange,
  className = '',
}: {
  total: number
  page: number
  pageSize: number
  loading?: boolean
  onPageChange: (page: number) => void
  className?: string
}) {
  const totalPaginas = Math.max(1, Math.ceil(total / pageSize))
  const inicio = total === 0 ? 0 : page * pageSize + 1
  const fim = Math.min((page + 1) * pageSize, total)
  const btnCls =
    'flex items-center gap-1 text-xs text-slate-300 border border-[var(--border)] px-2.5 py-1.5 rounded-lg hover:bg-[var(--bg-card)] disabled:opacity-40 disabled:cursor-not-allowed'

  return (
    <div className={`flex items-center justify-between ${className}`}>
      <span className="text-xs text-slate-500">
        {total > 0
          ? `${inicio.toLocaleString('pt-BR')}–${fim.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')}`
          : '0 leads'}
      </span>
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500">Página {page + 1} de {totalPaginas}</span>
        <button onClick={() => onPageChange(Math.max(0, page - 1))} disabled={page === 0 || loading} className={btnCls}>
          <ChevronLeft size={14} /> Anterior
        </button>
        <button
          onClick={() => onPageChange(page + 1 < totalPaginas ? page + 1 : page)}
          disabled={page + 1 >= totalPaginas || loading}
          className={btnCls}
        >
          Próxima <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}
