'use client';

// Nichos criados pela organização + estado da carga deles no catálogo. Com
// pedido aberto (pendente/em andamento), consulta o andamento a cada 30 s;
// quando um pedido fecha (ou um nicho excluído muda o perfil salvo),
// `aoConcluir` avisa a tela para recontar a busca.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PedidoCarga } from '@/lib/prospeccao/catalogoRf/pedidos';
import type { Nicho } from '@/lib/prospeccao/nichos';

export interface RespostaNichosOrg {
  nichos: Nicho[];
  catalogoCnaes: string[];
  pedidos: PedidoCarga[];
  podeEditar: boolean;
  /** Nome IBGE das atividades dos pedidos (CNAE fora de qualquer nicho). */
  nomesAtividades: Record<string, string>;
}

export interface NichosOrg extends RespostaNichosOrg {
  carregado: boolean;
  /** Aplica a resposta de uma rota de nichos (criar/excluir). */
  aplicar: (resposta: Partial<RespostaNichosOrg>) => void;
  /** Pede a carga das atividades que faltam (POST /api/prospeccao/catalogo/pedidos). */
  pedirCarga: (cnaes: string[]) => Promise<string | null>;
  /** Avisa a tela que o perfil salvo mudou no servidor (ex.: nicho excluído). */
  recontar: () => void;
}

const INTERVALO_MS = 30_000;
const aberto = (p: PedidoCarga) => p.status === 'pendente' || p.status === 'em_andamento';

export function useNichosOrg(aoConcluir?: () => void): NichosOrg {
  const [estado, setEstado] = useState<RespostaNichosOrg>({ nichos: [], catalogoCnaes: [], pedidos: [], podeEditar: false, nomesAtividades: {} });
  const [carregado, setCarregado] = useState(false);
  const concluir = useRef(aoConcluir);
  useEffect(() => { concluir.current = aoConcluir; }, [aoConcluir]);

  const atualRef = useRef(estado);
  const aplicar = useCallback((resposta: Partial<RespostaNichosOrg>) => {
    const atual = atualRef.current;
    const novo = { ...atual, ...resposta };
    atualRef.current = novo;
    setEstado(novo);
    // Pedido que estava aberto e fechou: o catálogo mudou.
    if (atual.pedidos.some((p) => aberto(p) && novo.pedidos.some((n) => n.id === p.id && !aberto(n)))) concluir.current?.();
  }, []);

  useEffect(() => {
    let vivo = true;
    fetch('/api/prospeccao/nichos')
      .then((res) => (res.ok ? res.json() : null))
      .then((corpo: RespostaNichosOrg | null) => { if (vivo && corpo) aplicar(corpo); })
      .catch(() => {})
      .finally(() => { if (vivo) setCarregado(true); });
    return () => { vivo = false; };
  }, [aplicar]);

  const temAberto = estado.pedidos.some(aberto);
  useEffect(() => {
    if (!temAberto) return;
    const id = setInterval(() => {
      fetch('/api/prospeccao/catalogo/pedidos')
        .then((res) => (res.ok ? res.json() : null))
        .then((corpo: Pick<RespostaNichosOrg, 'pedidos' | 'catalogoCnaes' | 'nomesAtividades'> | null) => { if (corpo) aplicar(corpo); })
        .catch(() => {});
    }, INTERVALO_MS);
    return () => clearInterval(id);
  }, [temAberto, aplicar]);

  const pedirCarga = useCallback(async (cnaes: string[]) => {
    const res = await fetch('/api/prospeccao/catalogo/pedidos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cnaes }),
    });
    const corpo = await res.json().catch(() => ({}));
    if (!res.ok) return corpo?.erro || 'Não foi possível pedir a busca na Receita.';
    if (corpo.pedidos) aplicar({ pedidos: corpo.pedidos, nomesAtividades: corpo.nomesAtividades ?? {} });
    return null;
  }, [aplicar]);

  const recontar = useCallback(() => concluir.current?.(), []);

  return { ...estado, carregado, aplicar, pedirCarga, recontar };
}
