'use client';

import { Globe2, Info } from 'lucide-react';
import SeletorEstados from './SeletorEstados';
import SeletorMunicipios from './SeletorMunicipios';
import s from './Prospeccao.module.css';

// Onde buscar: país (só Brasil por enquanto) e, dentro dele, estados/municípios.
// Sem mapa — a fonte de dados atual é só o catálogo da Receita Federal, então um
// seletor direto é mais simples e mais fiel do que uma engine geográfica visual.

export default function SeletorLocalizacao({
  ufs,
  municipios,
  desabilitado = false,
  onChangeUfs,
  onChangeMunicipios,
}: {
  ufs: string[];
  municipios: string[];
  desabilitado?: boolean;
  onChangeUfs: (ufs: string[]) => void;
  onChangeMunicipios: (municipios: string[]) => void;
}) {
  return (
    <div className={s.geoBlock}>
      <div className={s.geoTabs} role="tablist" aria-label="Abrangência geográfica">
        <button type="button" role="tab" aria-selected="true" className={s.geoTabAtiva}>
          <span aria-hidden="true">🇧🇷</span> Brasil
        </button>
        <button type="button" role="tab" aria-selected="false" disabled title="Busca internacional ainda não disponível — a fonte de dados hoje é só a Receita Federal">
          <Globe2 size={15} aria-hidden="true" /> Internacional
        </button>
      </div>

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
    </div>
  );
}
