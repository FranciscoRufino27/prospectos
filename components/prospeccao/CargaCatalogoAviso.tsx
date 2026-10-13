'use client';

// "Buscando na Receita": atividades da busca atual que o catálogo ainda não
// tem. Mostra o pedido de carga (fila / em andamento / erro) ou oferece pedir.
// Some sozinho quando a carga termina (useNichosOrg consulta o andamento).
import { useState } from 'react';
import { AlertCircle, Database, Loader2, RefreshCw } from 'lucide-react';
import { nichoDaAtividade, nomeAtividade } from '@/lib/prospeccao/nichos';
import type { NichosOrg } from './useNichosOrg';
import s from './Prospeccao.module.css';

const hora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null;

function listar(nomes: string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? '';
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}

export default function CargaCatalogoAviso({ cnaes, nichosOrg }: { cnaes: readonly string[]; nichosOrg: NichosOrg }) {
  const [pedindo, setPedindo] = useState(false);
  const [erroPedido, setErroPedido] = useState<string | null>(null);
  if (!nichosOrg.carregado) return null;

  const noCatalogo = new Set(nichosOrg.catalogoCnaes);
  const faltam = [...new Set(cnaes)].filter((c) => !noCatalogo.has(c));
  if (!faltam.length) return null;

  // Nome amigável: o nicho, quando falta ele inteiro; senão cada atividade que
  // falta (ex.: Hotelaria com Hotéis carregado e Campings não → "Campings").
  const faltando = new Set(faltam);
  const rotulos = [...new Set(faltam.map((c) => {
    const nicho = nichoDaAtividade(c, nichosOrg.nichos);
    if (nicho && nicho.atividades.every((a) => faltando.has(a.codigo))) return nicho.nome;
    return nomeAtividade(c, nichosOrg.nichos) ?? nichosOrg.nomesAtividades[c] ?? c;
  }))];
  const alvo = listar(rotulos);
  const doPedido = (c: string) => nichosOrg.pedidos.find((p) => p.cnaes.includes(c));
  const pedidos = faltam.map(doPedido);
  const emAndamento = nichosOrg.pedidos.find((p) => p.status === 'em_andamento' && p.cnaes.some((c) => faltam.includes(c)));
  const naFila = pedidos.some((p) => p?.status === 'pendente');
  // Sem pedido aberto: ou nunca foi pedido, ou o último deu erro.
  const comErro = !emAndamento && !naFila ? pedidos.find((p) => p?.status === 'erro') : undefined;
  const semPedido = !emAndamento && !naFila && !comErro;

  async function pedir() {
    setPedindo(true);
    setErroPedido(null);
    const erro = await nichosOrg.pedirCarga(faltam);
    setErroPedido(erro);
    setPedindo(false);
  }

  if (emAndamento || naFila) {
    return (
      <div className={s.infoNotice} role="status" aria-live="polite">
        <Loader2 size={15} className="shrink-0 animate-spin" aria-hidden="true" />
        <span>
          <strong>Buscando empresas de {alvo} na Receita Federal…</strong>{' '}
          {emAndamento
            ? `Começou às ${hora(emAndamento.iniciadoEm)}. Leva até 1h30.`
            : 'Na fila — começa em instantes. Leva até 1h30.'}{' '}
          Pode continuar usando o sistema: quando terminar, essas empresas passam a aparecer na busca.
        </span>
      </div>
    );
  }

  return (
    <div className={comErro ? s.errorNotice : s.warningNotice} role="status">
      {comErro ? <AlertCircle size={15} className="shrink-0" aria-hidden="true" /> : <Database size={15} className="shrink-0" aria-hidden="true" />}
      <span className="flex-1">
        {comErro
          ? <>Não conseguimos buscar {alvo} na Receita{comErro.erro ? ` (${comErro.erro})` : ''}.</>
          : <>Ainda não buscamos {alvo} na Receita: a busca não traz essas empresas por enquanto.</>}
        {!nichosOrg.podeEditar && ' Peça a um administrador para buscar.'}
        {erroPedido && <> {erroPedido}</>}
      </span>
      {nichosOrg.podeEditar && (
        <button type="button" onClick={pedir} disabled={pedindo} className={`${s.compactButton} shrink-0 focus-ring`}>
          {pedindo ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} {semPedido ? 'Buscar na Receita' : 'Tentar de novo'}
        </button>
      )}
    </div>
  );
}
