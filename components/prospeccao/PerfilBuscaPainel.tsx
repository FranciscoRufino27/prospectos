'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, Check, ChevronDown, Info, Lock, Mail, Phone, Plus, RotateCcw, Save, Search,
  SlidersHorizontal, UserRound, X,
} from 'lucide-react';
import SeletorLocalizacao from './SeletorLocalizacao';
import SeletorNichos from './SeletorNichos';
import SeletorOpcoesPerfil, { type OpcaoPerfil } from './SeletorOpcoesPerfil';
import {
  AREAS_ALVO_PROSPECCAO,
  CARGOS_ALVO_PROSPECCAO,
  FAIXAS_FUNCIONARIOS,
  PESQUISAS_LIMITES,
  PROSPECCAO_LIMITES,
  quantidadeValida,
  type AreaAlvoProspeccao,
  type CargoAlvoProspeccao,
  type FaixaFuncionarios,
  type ProspeccaoConfig,
} from '@/lib/config/workspaceConfig';
import { NICHOS, nichoDaAtividade } from '@/lib/prospeccao/nichos';
import { formatarCnae } from '@/lib/prospeccao/rotulos';
import s from './Prospeccao.module.css';

const LIMITE_CNAES = PROSPECCAO_LIMITES.cnaes;

const OPCOES_FUNCIONARIOS: OpcaoPerfil[] = FAIXAS_FUNCIONARIOS.map((valor) => ({ valor, rotulo: valor }));
const ROTULOS_CARGOS: Record<CargoAlvoProspeccao, string> = {
  proprietario: 'Proprietário', socio: 'Sócio', founder: 'Founder', diretor: 'Diretor', gerente: 'Gerente',
};
const OPCOES_CARGOS: OpcaoPerfil[] = CARGOS_ALVO_PROSPECCAO.map((valor) => ({ valor, rotulo: ROTULOS_CARGOS[valor] }));
const ROTULOS_AREAS: Record<AreaAlvoProspeccao, string> = {
  ti: 'TI', rh: 'RH', logistica: 'Logística', operacoes: 'Operações', comercial: 'Comercial',
  marketing: 'Marketing', financeiro: 'Financeiro', compras: 'Compras',
};
const OPCOES_AREAS: OpcaoPerfil[] = AREAS_ALVO_PROSPECCAO.map((valor) => ({ valor, rotulo: ROTULOS_AREAS[valor] }));
const ATIVIDADES = NICHOS.flatMap((nicho) => nicho.atividades.map((atividade) => ({ ...atividade, nicho: nicho.nome })));

export default function PerfilBuscaPainel({
  catalogoCnaes,
  quantidadeTexto,
  soComEmail,
  filtrosDisponiveis,
  onQuantidadeChange,
  onSoComEmailChange,
  onSalvo,
}: {
  catalogoCnaes: string[] | null;
  quantidadeTexto: string;
  soComEmail: boolean;
  filtrosDisponiveis: boolean;
  onQuantidadeChange: (valor: string) => void;
  onSoComEmailChange: (ativo: boolean) => void;
  onSalvo: (perfil: ProspeccaoConfig | null) => void;
}) {
  const [perfil, setPerfil] = useState<ProspeccaoConfig>({});
  const [podeEditar, setPodeEditar] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [avancadosAbertos, setAvancadosAbertos] = useState(false);
  const [atividadeBusca, setAtividadeBusca] = useState('');
  const [cnaeDigitado, setCnaeDigitado] = useState('');

  useEffect(() => {
    fetch('/api/configuracoes/workspace')
      .then(async (res) => {
        if (!res.ok) throw new Error('Não foi possível carregar o perfil de busca.');
        return res.json();
      })
      .then(({ config, podeEditar: permitido }) => {
        setPerfil(config?.prospeccao ?? {});
        setPodeEditar(!!permitido);
      })
      .catch((e) => setErro(e instanceof Error ? e.message : 'Erro ao carregar'))
      .finally(() => setCarregando(false));
  }, []);

  const cnaes = perfil.cnaes ?? [];
  const ufs = perfil.ufs ?? [];
  const municipios = perfil.municipios ?? [];
  const faixasFuncionarios = perfil.faixasFuncionarios ?? [];
  const cargosAlvo = perfil.cargosAlvo ?? [];
  const areasAlvo = perfil.areasAlvo ?? [];
  const outras = cnaes.filter((codigo) => !nichoDaAtividade(codigo));
  const foraDoCatalogo = catalogoCnaes ? cnaes.filter((codigo) => !catalogoCnaes.includes(codigo)) : [];
  const quantidadeInvalida = quantidadeTexto.trim() !== '' && quantidadeValida(Number(quantidadeTexto)) === null;

  const atividadesFiltradas = useMemo(() => {
    const termo = atividadeBusca.trim().toLocaleLowerCase('pt-BR');
    if (!termo) return [];
    return ATIVIDADES.filter((atividade) =>
      atividade.nome.toLocaleLowerCase('pt-BR').includes(termo)
      || atividade.nicho.toLocaleLowerCase('pt-BR').includes(termo)
      || atividade.codigo.includes(termo.replace(/\D/g, '')),
    ).slice(0, 8);
  }, [atividadeBusca]);

  function definirCnaes(novos: string[]) {
    setAviso(null);
    setPerfil((atual) => ({ ...atual, cnaes: novos }));
  }

  function alternarAtividade(codigo: string) {
    if (!podeEditar) return;
    if (cnaes.includes(codigo)) definirCnaes(cnaes.filter((item) => item !== codigo));
    else if (cnaes.length >= LIMITE_CNAES) setAviso(`O perfil aceita até ${LIMITE_CNAES} atividades.`);
    else definirCnaes([...cnaes, codigo]);
  }

  function adicionarCodigo() {
    const codigo = cnaeDigitado.replace(/\D/g, '');
    if (!/^\d{7}$/.test(codigo)) return setAviso('O código CNAE precisa ter 7 dígitos, ex.: 5510-8/01.');
    setCnaeDigitado('');
    if (!cnaes.includes(codigo)) alternarAtividade(codigo);
  }

  function limpar() {
    setPerfil({ cnaes: [], ufs: [], municipios: [], faixasFuncionarios: [], cargosAlvo: [], areasAlvo: [] });
    setAviso(null);
    setAtividadeBusca('');
    setCnaeDigitado('');
    onQuantidadeChange('');
    onSoComEmailChange(false);
  }

  async function salvar() {
    if (!podeEditar || salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      // O porte jurídico legado sai ao salvar: a interface nova usa somente
      // faixas de funcionários como intenção de qualificação.
      const { portes: _portesLegados, ...perfilAtual } = perfil;
      const perfilSalvo = cnaes.length ? perfilAtual : null;
      const res = await fetch('/api/configuracoes/workspace', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospeccao: perfilSalvo }),
      });
      const corpo = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(corpo?.erro || 'Falha ao salvar o perfil');
      setPerfil(perfilSalvo ?? {});
      onSalvo(perfilSalvo);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <aside className={s.profilePanel} aria-labelledby="perfil-busca-titulo">
      <header className={s.profileHeader}>
        <span className={s.profileHeaderIcon}><SlidersHorizontal size={17} aria-hidden="true" /></span>
        <div className="min-w-0">
          <h2 id="perfil-busca-titulo" tabIndex={-1}>Perfil de busca</h2>
          <p>Defina onde e que tipo de empresa você deseja encontrar.</p>
        </div>
      </header>

      {carregando ? (
        <div className={s.profileBody}><p className="text-sm text-slate-400">Carregando perfil…</p></div>
      ) : (
        <div className={s.profileBody}>
          {!podeEditar && (
            <p className={s.readOnlyNotice}><Lock size={13} /> O perfil salvo é somente leitura para sua permissão atual.</p>
          )}

          <SeletorLocalizacao
            ufs={ufs}
            municipios={municipios}
            desabilitado={!podeEditar}
            onChangeUfs={(novas) => setPerfil((atual) => ({ ...atual, ufs: novas }))}
            onChangeMunicipios={(novos) => setPerfil((atual) => ({ ...atual, municipios: novos }))}
          />

          <section className={s.profileSection}>
            <label className={s.profileLabel} htmlFor="quantidade-desejada">Quantidade desejada</label>
            <div className={s.quantityField}>
              <input id="quantidade-desejada" type="number" inputMode="numeric" min={1} max={PESQUISAS_LIMITES.quantidadeMax} value={quantidadeTexto} disabled={!filtrosDisponiveis} onChange={(evento) => onQuantidadeChange(evento.target.value)} placeholder="100" className="focus-ring" />
              <span>leads válidos</span>
            </div>
            <p className={s.fieldHelp}><Info size={12} /> Nesta etapa, o campo limita resultados; a meta por validade será conectada ao motor.</p>
            {quantidadeInvalida && <p className="mt-1 text-xs text-amber-300">Informe um valor entre 1 e {PESQUISAS_LIMITES.quantidadeMax}.</p>}
          </section>

          <section className={s.profileSection}>
            <span className={s.profileLabel}>Critérios mínimos <Info size={12} aria-hidden="true" /></span>
            <div className={s.criteriaBox}>
              <button type="button" role="switch" aria-checked={soComEmail} disabled={!filtrosDisponiveis} onClick={() => onSoComEmailChange(!soComEmail)} className={`${s.criteriaRow} focus-ring`}>
                <Mail size={15} /><span className="flex-1 text-left">E-mail válido obrigatório</span><span className={`${s.switchTrack} ${soComEmail ? s.switchTrackAtivo : ''}`} aria-hidden="true"><span /></span>
              </button>
              <button type="button" role="switch" aria-checked="false" disabled className={s.criteriaRow} title="Disponível após enriquecimento de decisores">
                <UserRound size={15} /><span className="flex-1 text-left">Decisor obrigatório</span><span className={s.switchTrack} aria-hidden="true"><span /></span>
              </button>
              <button type="button" role="switch" aria-checked="false" disabled className={s.criteriaRow} title="Disponível quando a fonte trouxer telefone">
                <Phone size={15} /><span className="flex-1 text-left">Telefone obrigatório</span><span className={s.switchTrack} aria-hidden="true"><span /></span>
              </button>
            </div>
          </section>

          <section className={s.profileSection}>
            <span className={s.profileLabel}>Nichos de interesse <Info size={12} aria-hidden="true" /></span>
            <SeletorNichos cnaes={cnaes} desabilitado={!podeEditar} onChange={definirCnaes} onAviso={setAviso} />
          </section>

          <section className={s.profileSection}>
            <span className={s.profileLabel}>Tamanho da empresa <Info size={12} aria-hidden="true" /></span>
            <p className={s.labelHelp}>Com base no número de funcionários.</p>
            <SeletorOpcoesPerfil
              rotuloAcessivel="Tamanho da empresa"
              placeholder="Selecione faixas de funcionários"
              opcoes={OPCOES_FUNCIONARIOS}
              selecionados={faixasFuncionarios}
              desabilitado={!podeEditar}
              onChange={(valores) => setPerfil((atual) => ({ ...atual, faixasFuncionarios: valores as FaixaFuncionarios[] }))}
            />
          </section>

          <section className={s.profileSection}>
            <span className={s.profileLabel}>Quem você quer encontrar? <Info size={12} aria-hidden="true" /></span>
            <SeletorOpcoesPerfil
              rotuloAcessivel="Cargos desejados"
              placeholder="Selecione cargos"
              opcoes={OPCOES_CARGOS}
              selecionados={cargosAlvo}
              desabilitado={!podeEditar}
              onChange={(valores) => setPerfil((atual) => ({ ...atual, cargosAlvo: valores as CargoAlvoProspeccao[] }))}
            />
          </section>

          <section className={s.profileSection}>
            <span className={s.profileLabel}>Área (opcional)</span>
            <SeletorOpcoesPerfil
              rotuloAcessivel="Áreas desejadas"
              placeholder="Selecione áreas"
              opcoes={OPCOES_AREAS}
              selecionados={areasAlvo}
              desabilitado={!podeEditar}
              onChange={(valores) => setPerfil((atual) => ({ ...atual, areasAlvo: valores as AreaAlvoProspeccao[] }))}
            />
          </section>

          <section className={s.advancedSection}>
            <button type="button" onClick={() => setAvancadosAbertos((aberto) => !aberto)} aria-expanded={avancadosAbertos} className={`${s.profileAccordion} focus-ring`}>
              <SlidersHorizontal size={15} aria-hidden="true" />
              <span className="min-w-0 flex-1 text-left"><strong>Filtros avançados</strong><small>CNAE, atividade principal/secundária, excluir MEI e mais.</small></span>
              <ChevronDown size={15} className={avancadosAbertos ? 'rotate-180' : ''} />
            </button>

            {avancadosAbertos && (
              <div className={s.advancedBody}>
                <label className={s.profileFieldLabel}>
                  <span>Atividade econômica / CNAE</span>
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input value={atividadeBusca} onChange={(evento) => setAtividadeBusca(evento.target.value)} disabled={!podeEditar} placeholder="Buscar atividade ou código" className={`${s.field} pl-9 pr-3 focus-ring`} />
                    {atividadesFiltradas.length > 0 && (
                      <ul className={`${s.popover} ${s.activityResults}`}>
                        {atividadesFiltradas.map((atividade) => {
                          const ativa = cnaes.includes(atividade.codigo);
                          return (
                            <li key={atividade.codigo}>
                              <button type="button" onClick={() => alternarAtividade(atividade.codigo)} className={s.activityResultRow}>
                                <span className={`${s.atividadeCheck} ${ativa ? s.checkMarcado : ''}`}>{ativa && <Check size={11} />}</span>
                                <span className="min-w-0 flex-1 text-left"><strong>{atividade.nome}</strong><small>{atividade.nicho} · {formatarCnae(atividade.codigo)}</small></span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </label>

                {outras.length > 0 && <div className={s.profileChips}>{outras.map((codigo) => <span key={codigo} className={s.profileChip}><span className="font-mono">{formatarCnae(codigo)}</span><button type="button" aria-label={`Remover ${formatarCnae(codigo)}`} onClick={() => alternarAtividade(codigo)}><X size={12} /></button></span>)}</div>}

                {podeEditar && (
                  <div className="mt-2 flex gap-2">
                    <input value={cnaeDigitado} onChange={(evento) => setCnaeDigitado(evento.target.value)} onKeyDown={(evento) => { if (evento.key === 'Enter') adicionarCodigo(); }} placeholder="Código CNAE" aria-label="Código CNAE" className={`${s.field} min-w-0 flex-1 px-3 focus-ring`} />
                    <button type="button" onClick={adicionarCodigo} className={`${s.compactButton} focus-ring`}><Plus size={13} /> Adicionar</button>
                  </div>
                )}

                <div className="mt-2 grid gap-1.5">
                  <button type="button" disabled={!podeEditar} onClick={() => setPerfil((atual) => ({ ...atual, excluirMei: !atual.excluirMei }))} aria-pressed={!!perfil.excluirMei} className={`${s.advancedOption} ${perfil.excluirMei ? s.advancedOptionAtiva : ''}`}>
                    <span className={s.atividadeCheck}>{perfil.excluirMei && <Check size={11} />}</span><span>Excluir MEI</span>
                  </button>
                  <button type="button" disabled={!podeEditar} onClick={() => setPerfil((atual) => ({ ...atual, incluirCnaesSecundarios: !atual.incluirCnaesSecundarios }))} aria-pressed={!!perfil.incluirCnaesSecundarios} className={`${s.advancedOption} ${perfil.incluirCnaesSecundarios ? s.advancedOptionAtiva : ''}`}>
                    <span className={s.atividadeCheck}>{perfil.incluirCnaesSecundarios && <Check size={11} />}</span><span>Incluir atividade secundária</span>
                  </button>
                </div>
              </div>
            )}
          </section>

          <p className={s.profilePendingNote}><Info size={12} /> Funcionários, cargos e áreas ficam salvos no perfil; serão aplicados à busca quando a fonte de enriquecimento for conectada.</p>
          {foraDoCatalogo.length > 0 && <p className={s.infoNotice}>{foraDoCatalogo.length} atividade{foraDoCatalogo.length === 1 ? '' : 's'} ainda não {foraDoCatalogo.length === 1 ? 'está' : 'estão'} no catálogo atual.</p>}
          {aviso && <p className={s.warningNotice}><AlertCircle size={14} /> {aviso}</p>}
          {cnaes.length === 0 && <p className={s.warningNotice}><AlertCircle size={14} /> Selecione ao menos um nicho ou CNAE para habilitar a busca.</p>}
          {erro && <p className={s.errorNotice}><AlertCircle size={14} /> {erro}</p>}
        </div>
      )}

      {podeEditar && (
        <footer className={s.profileFooter}>
          <button type="button" onClick={limpar} disabled={salvando} className={`${s.clearButton} focus-ring`}><RotateCcw size={15} /> Limpar filtros</button>
          <button type="button" onClick={salvar} disabled={salvando || carregando} className={`${s.primaryButton} flex-1 justify-center disabled:opacity-60 focus-ring`}><Save size={15} /> {salvando ? 'Salvando…' : 'Salvar e buscar'}</button>
        </footer>
      )}
    </aside>
  );
}
