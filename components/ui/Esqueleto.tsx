// Esqueletos de carregamento: blocos no formato do que vai aparecer, com o
// brilho de .esqueleto (globals.css). Mostram que a tela respondeu enquanto os
// dados chegam — no lugar do texto "Carregando…". Leitor de tela ouve só
// "Carregando".

export function Esqueleto({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`esqueleto ${className}`} />;
}

/** Linhas de lista ou tabela: um avatar/ícone, título e subtítulo por linha. */
export function EsqueletoLinhas({ linhas = 5, className = '' }: { linhas?: number; className?: string }) {
  return (
    <div role="status" className={`space-y-3 ${className}`}>
      <span className="sr-only">Carregando</span>
      {Array.from({ length: linhas }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Esqueleto className="h-9 w-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Esqueleto className={`h-3 ${i % 3 === 0 ? 'w-2/5' : i % 3 === 1 ? 'w-1/2' : 'w-1/3'}`} />
            <Esqueleto className="h-2.5 w-1/4" />
          </div>
          <Esqueleto className="hidden h-6 w-20 sm:block" />
        </div>
      ))}
    </div>
  );
}

/** Página inteira (app/loading.tsx): título, abas, quatro indicadores e um painel. */
export function EsqueletoPagina() {
  return (
    <div role="status" className="space-y-6 p-6">
      <span className="sr-only">Carregando</span>
      <div className="space-y-2">
        <Esqueleto className="h-3 w-32" />
        <Esqueleto className="h-7 w-56" />
        <Esqueleto className="h-3 w-80 max-w-full" />
      </div>
      <div className="flex gap-2">
        <Esqueleto className="h-9 w-28" />
        <Esqueleto className="h-9 w-28" />
        <Esqueleto className="h-9 w-28" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-3 rounded-xl border border-[var(--border)] p-4">
            <div className="flex items-center gap-3">
              <Esqueleto className="h-9 w-9" />
              <div className="flex-1 space-y-2">
                <Esqueleto className="h-3 w-2/3" />
                <Esqueleto className="h-5 w-1/3" />
              </div>
            </div>
            <Esqueleto className="h-2.5 w-1/2" />
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-[var(--border)] p-5">
        <EsqueletoLinhas linhas={6} />
      </div>
    </div>
  );
}
