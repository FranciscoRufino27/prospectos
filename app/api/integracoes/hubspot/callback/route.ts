import { NextResponse } from 'next/server'
import { processarCallbackHubspot } from '@/lib/integracoes/hubspot/callback'

// Rota fina: toda a lógica (validar state, trocar code, buscar metadados,
// persistir) vive em lib/integracoes/hubspot/callback.ts, testável sem
// servidor. Em qualquer desfecho isto só redireciona — tokens nunca chegam
// ao frontend.
export const runtime = 'nodejs'

const DESTINO = '/configuracoes?tab=integracoes'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const resultado = await processarCallbackHubspot({
    code: url.searchParams.get('code'),
    state: url.searchParams.get('state'),
  })

  const destino = new URL(DESTINO, url.origin)
  if (!resultado.ok) destino.searchParams.set('hubspot_erro', resultado.motivo)
  return NextResponse.redirect(destino)
}
