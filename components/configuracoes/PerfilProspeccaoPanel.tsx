'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, ArrowRight, Check, Loader2, Radar, RotateCcw, Save } from 'lucide-react'
import type { ProspeccaoConfig } from '@/lib/config/workspaceConfig'
import { gruposDoPerfil } from '@/lib/prospeccao/nichos'
import { NOME_UF } from '@/lib/prospeccao/estados'
import { ROTULO_PORTE } from '@/lib/prospeccao/rotulos'
import CamposPerfilBusca from '@/components/prospeccao/CamposPerfilBusca'
import { estilosModulo as m, TituloSecao } from '@/components/tema/Modulo'

// Perfil de busca da tela de Prospecção (organizacoes.configuracoes.prospeccao).
// É o ponto de partida dos filtros da busca e define quais CNAEs o catálogo da
// Receita precisa carregar para esta organização. Os campos são os mesmos do
// painel lateral da Prospecção (CamposPerfilBusca); o PUT substitui o objeto.

const igual = (a: ProspeccaoConfig, b: ProspeccaoConfig) => JSON.stringify(a) === JSON.stringify(b)

export default function PerfilProspeccaoPanel() {
  const [perfil, setPerfil] = useState<ProspeccaoConfig>({})
  const [salvoNoServidor, setSalvoNoServidor] = useState<ProspeccaoConfig>({})
  const [podeEditar, setPodeEditar] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/configuracoes/workspace')
      .then(async (res) => {
        if (!res.ok) throw new Error('Não foi possível carregar o perfil de busca.')
        return res.json()
      })
      .then(({ config, podeEditar: permitido }) => {
        const atual = config?.prospeccao ?? {}
        setPerfil(atual)
        setSalvoNoServidor(atual)
        setPodeEditar(!!permitido)
      })
      .catch((e) => setErro(e instanceof Error ? e.message : 'Erro ao carregar'))
      .finally(() => setCarregando(false))
  }, [])

  const alterado = !igual(perfil, salvoNoServidor)
  const cnaes = perfil.cnaes ?? []
  const ufs = perfil.ufs ?? []
  const municipios = perfil.municipios ?? []
  const portes = perfil.portes ?? []
  const grupos = useMemo(() => gruposDoPerfil(cnaes), [cnaes])

  async function salvar() {
    if (!podeEditar || salvando) return
    setSalvando(true)
    setSalvo(false)
    setErro(null)
    try {
      const res = await fetch('/api/configuracoes/workspace', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospeccao: cnaes.length ? perfil : null }),
      })
      const corpo = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(corpo?.erro || 'Falha ao salvar o perfil')
      const gravado = corpo?.config?.prospeccao ?? {}
      setPerfil(gravado)
      setSalvoNoServidor(gravado)
      setSalvo(true)
      setTimeout(() => setSalvo(false), 2500)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar')
    } finally {
      setSalvando(false)
    }
  }

  if (carregando) return <p className="text-sm text-slate-400">Carregando…</p>

  const regiao = ufs.length === 0
    ? 'Brasil inteiro'
    : ufs.length <= 3 ? ufs.map((u) => NOME_UF[u as keyof typeof NOME_UF] ?? u).join(', ') : `${ufs.length} estados`

  const linhas: { rotulo: string; valor: string; alerta?: boolean }[] = [
    {
      rotulo: 'Atividades',
      valor: cnaes.length === 0 ? 'Nenhuma — busca desligada' : `${cnaes.length} em ${grupos.map((g) => g.nome).join(', ')}`,
      alerta: cnaes.length === 0,
    },
    { rotulo: 'Região', valor: regiao },
    { rotulo: 'Municípios', valor: municipios.length === 0 ? 'Todos' : `${municipios.length} selecionado${municipios.length === 1 ? '' : 's'}` },
    { rotulo: 'Porte', valor: portes.length === 0 ? 'Todos' : portes.map((p) => ROTULO_PORTE[p]).join(', ') },
    { rotulo: 'MEI', valor: perfil.excluirMei ? 'Excluído' : 'Incluído' },
    { rotulo: 'Atividade secundária', valor: perfil.incluirCnaesSecundarios ? 'Incluída' : 'Só a principal' },
  ]

  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      {/* Campos */}
      <section className={m.painel}>
        <div className={m.painelBarra}>
          <TituloSecao
            icone={Radar}
            titulo="Perfil de busca da prospecção"
            subtitulo="O que a tela de Prospecção busca por padrão no catálogo da Receita Federal. As atividades também dizem o que o catálogo precisa carregar."
          />
        </div>
        <div className="grid gap-3 p-4">
          <CamposPerfilBusca perfil={perfil} onChange={setPerfil} podeEditar={podeEditar} colunasNichos={3} />
        </div>
      </section>

      {/* Resumo + salvar */}
      <aside className={`${m.painel} xl:sticky xl:top-4`}>
        <div className={m.painelBarra}>
          <TituloSecao icone={Check} titulo="Resumo" subtitulo={alterado ? 'Alterações ainda não salvas.' : 'É o que está valendo agora.'} />
        </div>
        <dl className="grid gap-2.5 p-4 text-sm">
          {linhas.map((l) => (
            <div key={l.rotulo} className="grid gap-0.5">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{l.rotulo}</dt>
              <dd className={l.alerta ? 'text-amber-300' : 'text-slate-100'}>{l.valor}</dd>
            </div>
          ))}
        </dl>

        <div className="grid gap-2 border-t border-[var(--m-border-subtle,#17496e)] p-4">
          {erro && (
            <p className="flex items-center gap-2 text-sm text-red-300"><AlertCircle size={14} /> {erro}</p>
          )}
          {podeEditar && (
            <>
              <button type="button" onClick={salvar} disabled={salvando || !alterado} className={`${m.primaryButton} w-full justify-center focus-ring`}>
                {salvando ? <Loader2 size={15} className="animate-spin" /> : salvo ? <Check size={15} /> : <Save size={15} />}
                {salvando ? 'Salvando…' : salvo ? 'Perfil salvo' : 'Salvar perfil'}
              </button>
              {alterado && !salvando && (
                <button type="button" onClick={() => { setPerfil(salvoNoServidor); setErro(null) }} className={`${m.outlineButton} w-full justify-center focus-ring`}>
                  <RotateCcw size={14} /> Descartar alterações
                </button>
              )}
            </>
          )}
          <Link href="/prospeccao" className="mt-1 inline-flex items-center justify-center gap-1.5 text-xs text-indigo-300 hover:text-indigo-200">
            Abrir a Prospecção <ArrowRight size={12} />
          </Link>
        </div>
      </aside>
    </div>
  )
}
