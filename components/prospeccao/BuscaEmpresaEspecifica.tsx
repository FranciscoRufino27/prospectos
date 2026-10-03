'use client';

import { useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { UFS_BRASIL } from '@/lib/config/workspaceConfig';
import { PAISES_INTERNACIONAL, siteValido, type CodigoPais } from '@/lib/prospeccao/crustdata';
import { cnpjDoTexto, LIMITE_BUSCA_ESPECIFICA } from '@/lib/prospeccao/filtros';
import { NOME_UF } from '@/lib/prospeccao/estados';
import s from './Prospeccao.module.css';

// Busca de UMA empresa, independente dos filtros do perfil (fica no Perfil de
// busca). Brasil: nome ou CNPJ no catálogo da Receita, no estado escolhido
// (obrigatório, salvo CNPJ) e, se quiser, na cidade; o que não estiver na
// Receita segue na Crustdata. Internacional: nome na Crustdata, com país e
// estado/região obrigatórios e cidade opcional.

export type PedidoEmpresa =
  | { modo: 'brasil'; texto: string; uf: string | null; cidade: string; site: string | null }
  | { modo: 'internacional'; texto: string; pais: CodigoPais | ''; estado: string; cidade: string; site: string | null };

const UFS_POR_NOME = [...UFS_BRASIL].sort((a, b) => NOME_UF[a].localeCompare(NOME_UF[b], 'pt-BR'));

export default function BuscaEmpresaEspecifica({ modo, onBuscar }: {
  modo: 'brasil' | 'internacional';
  onBuscar: (pedido: PedidoEmpresa) => void;
}) {
  const [texto, setTexto] = useState('');
  const [uf, setUf] = useState('');
  const [pais, setPais] = useState('');
  const [estado, setEstado] = useState('');
  const [cidade, setCidade] = useState('');
  // Site: identifica a empresa sem ambiguidade (nome curto tem muitos homônimos).
  const [siteTexto, setSiteTexto] = useState('');
  const site = siteValido(siteTexto);
  const siteInvalido = siteTexto.trim() !== '' && !site;

  const nome = texto.trim();
  const ehCnpj = modo === 'brasil' && cnpjDoTexto(nome) !== null;
  // Com o site, o local deixa de ser obrigatório: o site já identifica a empresa.
  const falta =
    siteInvalido ? 'Site inválido (ex.: empresa.com.br)'
    : modo === 'brasil'
      ? (nome.length < 2 ? 'Digite o nome da empresa ou o CNPJ' : !ehCnpj && !uf && !site ? 'Escolha o estado' : null)
      : nome.length < 2 && !site ? 'Digite o nome ou o site da empresa'
      : site ? null
      : !pais ? 'Escolha o país'
      : estado.trim().length < 2 ? 'Informe o estado/região'
      : null;

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (falta) return;
    onBuscar(modo === 'brasil'
      ? { modo, texto: nome, uf: ehCnpj ? null : uf || null, cidade: ehCnpj ? '' : cidade.trim(), site }
      : { modo, texto: nome, pais: pais as CodigoPais | '', estado: estado.trim(), cidade: cidade.trim(), site });
  }

  return (
    <form onSubmit={enviar} className={s.profileSection} role="search" aria-label="Buscar uma empresa específica">
      <span className={s.profileLabel}>Buscar empresa específica</span>
      <p className={s.labelHelp}>
        Independe dos filtros do perfil. Traz até {LIMITE_BUSCA_ESPECIFICA} resultados, já com o decisor quando houver.
      </p>
      <div className="mt-2 grid gap-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            maxLength={80}
            placeholder={modo === 'brasil' ? 'Razão social, nome fantasia ou CNPJ' : 'Nome da empresa (ex.: Hilton)'}
            aria-label="Nome da empresa"
            className={`${s.field} pl-9 pr-3 focus-ring`}
          />
        </div>
        {modo === 'brasil' ? (
          <div className="grid grid-cols-2 gap-2">
            <Selecao rotulo="Estado (obrigatório)" valor={uf} onChange={setUf} desabilitado={ehCnpj}>
              <option value="">{ehCnpj ? 'Não precisa com CNPJ' : site ? 'Estado (opcional com o site)' : 'Estado *'}</option>
              {UFS_POR_NOME.map((u) => <option key={u} value={u}>{NOME_UF[u]}</option>)}
            </Selecao>
            <input value={cidade} onChange={(e) => setCidade(e.target.value)} maxLength={60} disabled={ehCnpj}
              placeholder="Cidade (opcional)" aria-label="Cidade (opcional)" className={`${s.field} px-3 focus-ring disabled:opacity-50`} />
          </div>
        ) : (
          <>
            <Selecao rotulo="País (obrigatório)" valor={pais} onChange={setPais}>
              <option value="">{site ? 'País (opcional com o site)' : 'País *'}</option>
              {PAISES_INTERNACIONAL.map((p) => <option key={p.codigo} value={p.codigo}>{p.nome}</option>)}
            </Selecao>
            <div className="grid grid-cols-2 gap-2">
              <input value={estado} onChange={(e) => setEstado(e.target.value)} maxLength={60}
                placeholder={site ? 'Estado/região (opcional)' : 'Estado/região *'} aria-label="Estado ou região" className={`${s.field} px-3 focus-ring`} />
              <input value={cidade} onChange={(e) => setCidade(e.target.value)} maxLength={60}
                placeholder="Cidade (opcional)" aria-label="Cidade (opcional)" className={`${s.field} px-3 focus-ring`} />
            </div>
          </>
        )}
        <input value={siteTexto} onChange={(e) => setSiteTexto(e.target.value)} maxLength={120}
          placeholder="Site da empresa (opcional, ex.: empresa.com)"
          aria-label="Site da empresa (opcional)" aria-invalid={siteInvalido}
          className={`${s.field} px-3 focus-ring ${siteInvalido ? 'border-amber-400/60' : ''}`} />
        <p className="text-xs text-slate-500">Com o site, a empresa certa é encontrada mesmo quando há outras com o mesmo nome; o local passa a ser opcional.</p>
        <button type="submit" disabled={!!falta} title={falta ?? undefined} className={`${s.primaryButton} justify-center disabled:opacity-50 focus-ring`}>
          <Search size={15} /> Buscar empresa
        </button>
      </div>
    </form>
  );
}

function Selecao({ rotulo, valor, onChange, desabilitado = false, children }: {
  rotulo: string; valor: string; onChange: (v: string) => void; desabilitado?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <select value={valor} onChange={(e) => onChange(e.target.value)} disabled={desabilitado} aria-label={rotulo}
        className={`${s.field} appearance-none pl-3 pr-9 cursor-pointer focus-ring disabled:opacity-50`}>
        {children}
      </select>
      <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
    </div>
  );
}
