// Transição ao trocar de aba do menu: o Next remonta este template quando o
// primeiro segmento da rota muda (/dashboard → /prospeccao), e a página nova
// entra subindo e aparecendo (.pagina-entrada, globals.css). Navegar mais
// fundo na mesma área ou só mudar a query não remonta, então não anima.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="pagina-entrada h-full">{children}</div>;
}
