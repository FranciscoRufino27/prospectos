import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fixa a raiz do projeto: um package-lock.json numa pasta acima (ex.: a home
  // do usuário) faz o Turbopack inferir a raiz errada e as rotas de API com
  // `export const runtime` passam a responder 404 no dev.
  turbopack: {
    root: import.meta.dirname,
  },
  // O envio de proposta ao cliente gera o PDF no servidor lendo a imagem-base e
  // os thumbnails de public/proposta (lib/propostas/pdfServidor.ts). public/
  // não entra no trace das funções por padrão; sem isto a rota falha na Vercel.
  outputFileTracingIncludes: {
    '/api/propostas/**': ['./public/proposta/**/*'],
  },
};

export default nextConfig;
