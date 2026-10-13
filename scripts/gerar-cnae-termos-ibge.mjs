/**
 * Gera lib/prospeccao/dados/cnae-termos-ibge.json: para cada subclasse CNAE, os
 * nomes populares das atividades que ela cobre, segundo o IBGE ("academia de
 * ginastica", "crossfit" → 9313-1/00). A pesquisa de atividades da Prospecção
 * usa isso, porque o nome oficial nem sempre tem a palavra que o usuário digita.
 *
 *   node scripts/gerar-cnae-termos-ibge.mjs
 *
 * Só lê a API pública do IBGE e escreve o arquivo de dados; não toca no banco.
 * Usa só a lista `atividades` (não as `observacoes`, que trazem também o que a
 * classe NÃO compreende). Termos sem acento, minúsculos, separados por "|",
 * com o complemento do IBGE na frente ("fabricacao de paes").
 */
import fs from 'node:fs'
import path from 'node:path'

const URL_IBGE = 'https://servicodados.ibge.gov.br/api/v2/cnae/subclasses'
const SAIDA = path.join(process.cwd(), 'lib/prospeccao/dados/cnae-termos-ibge.json')

const normalizar = (texto) =>
  texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

// "PÃES; FABRICAÇÃO DE" é "fabricacao de paes": o complemento depois do ";"
// muda o sentido e vai para a frente. Complemento genérico ("ACADEMIA DE
// GINÁSTICA; ATIVIDADE DE") não acrescenta nada: fica só o nome.
// Varejo também: para prospectar, a loja é o próprio negócio ("FARMÁCIA; COMÉRCIO VAREJISTA").
const GENERICOS = new Set(['atividade de', 'atividades de', 'servico de', 'servicos de', 'empresa de', 'comercio varejista', 'comercio varejista de'])
const termoDe = (atividade) => {
  const [nome, ...resto] = atividade.split(';')
  const complemento = normalizar(resto.join(' '))
  const base = normalizar(nome)
  return !complemento || GENERICOS.has(complemento) ? base : `${complemento} ${base}`
}

const res = await fetch(URL_IBGE)
if (!res.ok) throw new Error(`IBGE respondeu ${res.status}`)
const subclasses = await res.json()
const termos = {}
for (const s of subclasses) {
  const lista = [...new Set((s.atividades ?? []).map(termoDe).filter(Boolean))]
  if (lista.length) termos[s.id] = lista.join('|')
}
fs.writeFileSync(SAIDA, JSON.stringify(termos))
console.log(`${Object.keys(termos).length} subclasses → ${SAIDA}`)
