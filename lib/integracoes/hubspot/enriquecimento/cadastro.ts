import { PROVEDORES_PESSOAIS } from '@/lib/prospeccao/qualidadeEmail'

// Diagnóstico do cadastro atual de uma empresa do HubSpot — puro, sem rede.
// Não infere empresa pelo nome da pessoa: só usa CNPJ, domínio e e-mail.

export function soDigitos(v: string | null | undefined): string {
  return (v ?? '').replace(/\D/g, '')
}

export function cnpjValido(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false
  const dv = (pesos: number[]) => {
    const s = pesos.reduce((a, p, i) => a + Number(cnpj[i]) * p, 0)
    const r = s % 11
    return r < 2 ? 0 : 11 - r
  }
  return dv([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(cnpj[12])
    && dv([6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(cnpj[13])
}

const MASCARA_CNPJ = /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/

export function formatarCnpj(c: string): string {
  return /^\d{14}$/.test(c) ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : c
}

// Provedores de e-mail pessoal (lista única do projeto, lib/prospeccao/qualidadeEmail).
export function ehProvedorGenerico(dominio: string | null | undefined): boolean {
  return !!dominio && PROVEDORES_PESSOAIS.has(dominio.toLowerCase())
}

// Domínio de escritório de contabilidade identificaria o contador, não a empresa.
const SINAL_CONTABILIDADE = /contab|contador|escritorio|assessoria|fiscal|tributar/

export function dominioDeEmail(email: string | null | undefined): string | null {
  const e = (email ?? '').trim().toLowerCase()
  const at = e.lastIndexOf('@')
  if (at <= 0 || at === e.length - 1) return null
  return normalizarDominio(e.slice(at + 1))
}

// "https://www.Empresa.com.br/contato" → "empresa.com.br"
export function normalizarDominio(v: string | null | undefined): string | null {
  let d = (v ?? '').trim().toLowerCase()
  if (!d) return null
  d = d.replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0].split('@').pop()!.split(':')[0].replace(/^www\./, '').replace(/\.$/, '')
  return /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d) ? d : null
}

export type EstadoNome = 'valido' | 'vazio' | 'invalido' | 'cnpj_como_nome'
export type EstadoDocumento = 'valido' | 'digito_invalido' | 'cpf' | 'ausente' | 'formato_invalido'
export type EstadoDominio = 'disponivel' | 'provedor_generico' | 'ausente'
export type EstadoEmailContato = 'corporativo' | 'apenas_generico' | 'sem_email' | 'sem_contato'

export interface CadastroAtual {
  nome: EstadoNome
  documento: EstadoDocumento
  dominio: EstadoDominio
  email_contato: EstadoEmailContato
  empresa_valida: boolean // nome utilizável + alguma evidência (CNPJ, domínio ou e-mail corporativo)
}

const NOMES_PLACEHOLDER = /^(teste|test|n\/?a|sem nome|empresa|cliente|nome|x+|-+|\.+|\?+|null|undefined)$/i

export function estadoNome(nome: string | null | undefined): EstadoNome {
  const n = (nome ?? '').trim()
  if (!n) return 'vazio'
  const semCnpj = n.replace(MASCARA_CNPJ, '').replace(/[\s.\-/]/g, '')
  if (MASCARA_CNPJ.test(n) && semCnpj.length <= 4) return 'cnpj_como_nome'
  if (n.length < 3 || !/[a-zà-ú]/i.test(n) || NOMES_PLACEHOLDER.test(n)) return 'invalido'
  return 'valido'
}

// CNPJ dentro do nome (ex.: nome = "12.345.678/0001-90"), se válido.
export function cnpjNoNome(nome: string | null | undefined): string | null {
  const m = (nome ?? '').match(MASCARA_CNPJ)
  const c = m ? soDigitos(m[0]) : ''
  return cnpjValido(c) ? c : null
}

export function estadoDocumento(valor: string | null | undefined): EstadoDocumento {
  const d = soDigitos(valor)
  if (!d) return 'ausente'
  if (d.length === 14) return cnpjValido(d) ? 'valido' : 'digito_invalido'
  if (d.length === 11) return 'cpf' // documento de pessoa física: nunca consultado
  return 'formato_invalido'
}

export function estadoEmailContato(emails: readonly (string | null)[], temContato: boolean): EstadoEmailContato {
  if (!temContato) return 'sem_contato'
  const dominios = emails.map(dominioDeEmail).filter((d): d is string => !!d)
  if (!dominios.length) return 'sem_email'
  return dominios.some((d) => !ehProvedorGenerico(d)) ? 'corporativo' : 'apenas_generico'
}

// E-mail da própria empresa: domínio preenchido, não é provedor pessoal nem escritório de contabilidade.
export function ehEmailCorporativo(email: string | null | undefined): boolean {
  const d = dominioDeEmail(email)
  return !!d && !ehProvedorGenerico(d) && !SINAL_CONTABILIDADE.test(d)
}

// Domínios corporativos úteis como evidência (sem provedor pessoal nem contador).
export function dominiosCorporativos(emails: readonly (string | null)[]): string[] {
  const out: string[] = []
  for (const e of emails) {
    const d = dominioDeEmail(e)
    if (d && !ehProvedorGenerico(d) && !SINAL_CONTABILIDADE.test(d) && !out.includes(d)) out.push(d)
  }
  return out
}

export function diagnosticarCadastro(e: {
  nome: string | null
  documento: string | null
  dominio: string | null
  emailsContatos: readonly (string | null)[]
  temContato: boolean
}): CadastroAtual {
  const nome = estadoNome(e.nome)
  const documento = estadoDocumento(e.documento)
  const dominioBruto = normalizarDominio(e.dominio)
  const dominio: EstadoDominio = !dominioBruto ? 'ausente' : ehProvedorGenerico(dominioBruto) ? 'provedor_generico' : 'disponivel'
  const email_contato = estadoEmailContato(e.emailsContatos, e.temContato)
  const evidencia = documento === 'valido' || nome === 'cnpj_como_nome' || dominio === 'disponivel' || email_contato === 'corporativo'
  return { nome, documento, dominio, email_contato, empresa_valida: nome === 'valido' && evidencia }
}

// Semelhança entre o nome no HubSpot e razão social/fantasia (coeficiente de
// sobreposição de palavras relevantes). Só REFORÇA um CNPJ já achado por
// evidência; nunca é usada para achar empresa.
const PALAVRAS_VAZIAS = new Set([
  'ltda', 'me', 'epp', 'eireli', 'sa', 's', 'a', 'cia', 'companhia', 'comercio', 'comercial', 'industria', 'industrial',
  'servicos', 'servico', 'de', 'da', 'do', 'das', 'dos', 'e', 'the', 'grupo', 'group', 'brasil', 'holding', 'mei', 'limitada',
  'empresa', 'empresas', 'com', 'br', 'www', 'solucoes', 'tecnologia',
])

function palavras(v: string | null | undefined): Set<string> {
  return new Set(
    (v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .split(/[^a-z0-9]+/).filter((p) => p.length >= 3 && !PALAVRAS_VAZIAS.has(p)),
  )
}

export function semelhancaNome(a: string | null | undefined, b: string | null | undefined): number {
  const x = palavras(a)
  const y = palavras(b)
  if (!x.size || !y.size) return 0
  let comum = 0
  for (const p of x) if (y.has(p)) comum++
  return comum / Math.min(x.size, y.size)
}

// Domínio contém uma palavra relevante (≥ 5 letras) da razão social/fantasia.
export function dominioCombinaComNome(dominio: string | null, ...nomes: (string | null)[]): boolean {
  if (!dominio) return false
  const rotulo = dominio.split('.')[0]
  return nomes.some((n) => [...palavras(n)].some((p) => p.length >= 5 && rotulo.includes(p)))
}
