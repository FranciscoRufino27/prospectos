'use client';

import { Globe2, Info } from 'lucide-react';
import SeletorEstados from './SeletorEstados';
import SeletorMunicipios from './SeletorMunicipios';
import SeletorOpcoesPerfil, { type OpcaoPerfil } from './SeletorOpcoesPerfil';
import { PAISES_INTERNACIONAL, type CodigoPais } from '@/lib/prospeccao/crustdata';
import s from './Prospeccao.module.css';

// Onde buscar: Brasil (estados/municípios do catálogo da Receita) ou
// internacional (países da Crustdata, com os mesmos nichos do perfil). Sem
// mapa — um seletor direto é mais simples e fiel às duas fontes.

export type AbaLocalizacao = 'brasil' | 'internacional';

const OPCOES_PAISES: OpcaoPerfil[] = PAISES_INTERNACIONAL.map((p) => ({ valor: p.codigo, rotulo: p.nome }));

export default function SeletorLocalizacao({
  aba,
  onAba,
  ufs,
  municipios,
  paises,
  nichosSemSetor = [],
  desabilitado = false,
  onChangeUfs,
  onChangeMunicipios,
  onChangePaises,
}: {
  aba: AbaLocalizacao;
  onAba: (aba: AbaLocalizacao) => void;
  ufs: string[];
  municipios: string[];
  paises: CodigoPais[];
  /** Nichos do perfil sem setor equivalente lá fora (a busca internacional ignora). */
  nichosSemSetor?: string[];
  desabilitado?: boolean;
  onChangeUfs: (ufs: string[]) => void;
  onChangeMunicipios: (municipios: string[]) => void;
  onChangePaises: (paises: CodigoPais[]) => void;
}) {
  return (
    <div className={s.geoBlock}>
      <div className={s.geoTabs} role="tablist" aria-label="Abrangência geográfica">
        <button type="button" role="tab" aria-selected={aba === 'brasil'} onClick={() => onAba('brasil')} className={aba === 'brasil' ? s.geoTabAtiva : undefined}>
          <span aria-hidden="true">🇧🇷</span> Brasil
        </button>
        <button type="button" role="tab" aria-selected={aba === 'internacional'} onClick={() => onAba('internacional')} className={aba === 'internacional' ? s.geoTabAtiva : undefined}>
          <Globe2 size={15} aria-hidden="true" /> Internacional{paises.length > 0 ? ` (${paises.length})` : ''}
        </button>
      </div>

      {aba === 'brasil' ? (
        <>
          {/* div, não <label>: dentro de um label, o clique numa opção do menu
              "clica" também o primeiro botão do campo (o X da 1ª etiqueta). */}
          <div className={s.profileFieldLabel}>
            <span>Estados</span>
            <SeletorEstados selecionadas={ufs} desabilitado={desabilitado} onChange={onChangeUfs} />
          </div>

          <div className={s.profileFieldLabel}>
            <span>Municípios</span>
            <SeletorMunicipios selecionados={municipios} ufs={ufs} desabilitado={desabilitado} onChange={onChangeMunicipios} />
          </div>

          <p className={s.fieldHelp}>
            <Info size={12} />
            {ufs.length === 0 ? 'Sem estado selecionado, a busca cobre o Brasil inteiro.' : `Buscando em ${ufs.length} estado${ufs.length === 1 ? '' : 's'}.`}
          </p>
        </>
      ) : (
        <>
          <div className={s.profileFieldLabel}>
            <span>Países</span>
            <SeletorOpcoesPerfil
              rotuloAcessivel="Países da busca internacional"
              placeholder="Selecione países"
              opcoes={OPCOES_PAISES}
              selecionados={paises}
              desabilitado={desabilitado}
              onChange={(valores) => onChangePaises(valores as CodigoPais[])}
            />
          </div>

          <p className={s.fieldHelp}>
            <Info size={12} />
            {paises.length === 0
              ? 'Sem país selecionado, a busca internacional cobre o mundo todo. Usa os mesmos nichos abaixo (fonte: Crustdata).'
              : `Buscando em ${paises.length} país${paises.length === 1 ? '' : 'es'}, com os mesmos nichos abaixo (fonte: Crustdata).`}
          </p>
          {nichosSemSetor.length > 0 && (
            <p className={s.fieldHelp}><Info size={12} /> {nichosSemSetor.join(', ')}: sem setor equivalente lá fora; a busca internacional não usa.</p>
          )}
        </>
      )}
    </div>
  );
}
