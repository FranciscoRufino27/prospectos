import 'server-only'

// Client HTTP isolado para a API do HubSpot (CRM v3, somente leitura). Nunca
// chamado direto de componente React — sempre por trás de uma rota
// app/api/integracoes/hubspot/**. O access token nunca é logado.
//
// POST existe só para endpoints de LEITURA que o HubSpot expõe como POST
// (search, batch/read). Nenhuma escrita no HubSpot passa por aqui.

const BASE = 'https://api.hubapi.com'

export type ResultadoHubspot<T> =
  | { ok: true; dados: T }
  | {
      ok: false
      codigo: 'falha_rede' | 'nao_autorizado' | 'erro_provider' | 'resposta_invalida'
      mensagem: string
      status?: number
    }

async function chamarHubspot<T>(url: string, init: RequestInit, doFetch: typeof fetch): Promise<ResultadoHubspot<T>> {
  let resposta: Response
  try {
    resposta = await doFetch(url, init)
  } catch (e) {
    return { ok: false, codigo: 'falha_rede', mensagem: e instanceof Error ? e.message : String(e) }
  }

  let json: unknown
  try {
    json = await resposta.json()
  } catch {
    json = undefined
  }

  if (resposta.status === 401 || resposta.status === 403) {
    return { ok: false, codigo: 'nao_autorizado', mensagem: 'Token HubSpot inválido, expirado ou sem escopo', status: resposta.status }
  }
  if (!resposta.ok) {
    const corpo = json as Record<string, unknown> | undefined
    const msg = typeof corpo?.message === 'string' ? corpo.message : `HTTP ${resposta.status}`
    return { ok: false, codigo: 'erro_provider', mensagem: msg, status: resposta.status }
  }
  if (json === undefined) {
    return { ok: false, codigo: 'resposta_invalida', mensagem: 'Resposta não é JSON', status: resposta.status }
  }
  return { ok: true, dados: json as T }
}

export async function buscarHubspot<T = unknown>(
  caminho: string,
  accessToken: string,
  params: Record<string, string | number | undefined> = {},
  doFetch: typeof fetch = fetch,
): Promise<ResultadoHubspot<T>> {
  const url = new URL(caminho, BASE)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v))
  }
  return chamarHubspot<T>(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } }, doFetch)
}

export async function consultarHubspot<T = unknown>(
  caminho: string,
  accessToken: string,
  corpo: unknown,
  doFetch: typeof fetch = fetch,
): Promise<ResultadoHubspot<T>> {
  return chamarHubspot<T>(
    new URL(caminho, BASE).toString(),
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    },
    doFetch,
  )
}
