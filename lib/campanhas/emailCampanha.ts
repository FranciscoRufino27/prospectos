// HTML client-safe para mensagens de campanha. O texto continua sendo a fonte
// do conteúdo; o HTML apenas preserva a leitura e acrescenta a identificação
// real do responsável ao final — exceto num documento HTML completo, que já
// traz layout e assinatura próprios (ver montarDocumentoHtmlCompleto).

export function escaparHtmlEmail(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

const TAGS_HTML_EMAIL = new Set([
  'a', 'b', 'blockquote', 'br', 'caption', 'center', 'div', 'em', 'font', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 'small', 'span', 'strong',
  'style', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
])
const ATRIBUTOS_HTML_EMAIL = new Set([
  'align', 'alt', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'class', 'colspan',
  'height', 'href', 'role', 'rowspan', 'src', 'style', 'target', 'title', 'valign', 'width',
])

function urlSeguraHtmlEmail(atributo: string, valor: string): boolean {
  const normalizada = valor.trim().replace(/[\u0000-\u001f\u007f\s]+/g, '').toLowerCase()
  if (atributo === 'href') {
    return normalizada.startsWith('https://') || normalizada.startsWith('http://')
      || normalizada.startsWith('mailto:') || normalizada.startsWith('tel:') || normalizada.startsWith('#')
  }
  return normalizada.startsWith('https://') || normalizada.startsWith('http://')
    || /^data:image\/(?:png|gif|jpe?g|webp);base64,/i.test(normalizada)
}

const ENTIDADES_NOMEADAS: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

// O valor de um atributo vem do HTML e pode já estar escapado (`&amp;`).
// Decodificar antes de conferir e reescapar é o que torna a sanitização
// IDEMPOTENTE: sem isso, sanitizar um HTML já sanitizado transformava
// `?a=1&amp;b=2` em `?a=1&amp;amp;b=2` e quebrava o link. Conferir a URL já
// decodificada também fecha disfarces como `&#106;avascript:`.
function decodificarEntidadesAtributo(valor: string): string {
  return valor.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,9});/gi, (original, corpo: string) => {
    const chave = corpo.toLowerCase()
    if (chave.startsWith('#')) {
      const hexadecimal = chave[1] === 'x'
      const codigo = Number.parseInt(chave.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10)
      return Number.isInteger(codigo) && codigo > 0 && codigo <= 0x10ffff ? String.fromCodePoint(codigo) : original
    }
    return ENTIDADES_NOMEADAS[chave] ?? original
  })
}

function estiloSeguroHtmlEmail(valor: string): boolean {
  return !/(?:expression\s*\(|javascript\s*:|vbscript\s*:|@import|behavior\s*:|-moz-binding|url\s*\(\s*['"]?\s*(?:javascript|data:text\/html))/i.test(valor)
}

// Allowlist compartilhada pelo preview e pelo envio. O iframe de preview ainda
// roda sem permissões de script, como segunda barreira contra HTML importado.
export function sanitizarHtmlEmail(valor: string): string {
  let html = valor
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // <title> sai com o conteúdo: é metadado do arquivo, não texto do e-mail.
    .replace(/<(script|iframe|object|embed|form|svg|math|title)[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?(?:script|iframe|object|embed|form|input|button|textarea|select|option|base|meta|link|svg|math)\b[^>]*>/gi, '')
    .replace(/@import[^;]+;?/gi, '')

  html = html.replace(/<\s*(\/?)\s*([a-z0-9-]+)([^>]*)>/gi, (_tag, fechamento: string, nomeBruto: string, atributosBrutos: string) => {
    const nome = nomeBruto.toLowerCase()
    if (!TAGS_HTML_EMAIL.has(nome)) return ''
    if (fechamento) return `</${nome}>`

    const atributos: string[] = []
    const attrRe = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
    let encontrado: RegExpExecArray | null
    while ((encontrado = attrRe.exec(atributosBrutos)) !== null) {
      const atributo = encontrado[1].toLowerCase()
      if (!ATRIBUTOS_HTML_EMAIL.has(atributo) || atributo.startsWith('on')) continue
      const bruto = decodificarEntidadesAtributo(encontrado[2] ?? encontrado[3] ?? encontrado[4] ?? '')
      if ((atributo === 'href' || atributo === 'src') && !urlSeguraHtmlEmail(atributo, bruto)) continue
      if (atributo === 'style' && !estiloSeguroHtmlEmail(bruto)) continue
      atributos.push(`${atributo}="${escaparHtmlEmail(bruto)}"`)
    }
    const autocontido = nome === 'br' || nome === 'hr' || nome === 'img'
    return `<${nome}${atributos.length ? ` ${atributos.join(' ')}` : ''}${autocontido ? ' /' : ''}>`
  })
  return html
}

// Gera o fallback em texto puro exigido pelos clientes de e-mail e pelo motor.
// A extração parte do HTML já sanitizado para nunca transformar conteúdo
// removido (scripts, formulários etc.) em texto visível para o destinatário.
export function extrairTextoHtmlEmail(valor: string): string {
  const decodificarEntidade = (_entidade: string, decimal?: string, hexadecimal?: string): string => {
    const codigo = Number.parseInt(decimal ?? hexadecimal ?? '', hexadecimal ? 16 : 10)
    return Number.isInteger(codigo) && codigo > 0 && codigo <= 0x10ffff
      ? String.fromCodePoint(codigo)
      : ''
  }

  return sanitizarHtmlEmail(valor)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<(?:br|hr)\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/(?:p|div|h[1-6]|li|tr|blockquote|pre)\s*>/gi, '\n')
    .replace(/<\/(?:td|th)\s*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#(\d+);|&#x([0-9a-f]+);/gi, decodificarEntidade)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function documentoPreviewHtml(html: string): string {
  const csp = "default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; font-src data:;"
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0">${sanitizarHtmlEmail(html)}</body></html>`
}

const ESTILO_EMBUTIDO = /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi

// Documento HTML completo (doctype, <html> ou <body>): o autor já definiu o
// layout e a assinatura. Sai como foi feito — sem o cartão do sistema e sem a
// assinatura automática, que duplicariam o que o próprio HTML já traz. Os
// <style> voltam para o <head> (media queries) e o estilo do <body> do autor é
// reaplicado ao <body> e a uma <div> sem visual próprio, porque o Gmail e a
// prévia (documentoPreviewHtml) descartam o <body>.
function ehDocumentoHtmlCompleto(html: string): boolean {
  return /<!doctype\s+html|<(?:html|body)\b/i.test(html)
}

function montarDocumentoHtmlCompleto(html: string): string {
  const conteudo = sanitizarHtmlEmail(html)
  const estilos = conteudo.match(ESTILO_EMBUTIDO) ?? []
  const atributosBruto = html.match(/<body\b([^>]*)>/i)?.[1] ?? ''
  // Mesma allowlist do conteúdo: `<div atributos>` sanitizada vira só os
  // atributos permitidos (style, bgcolor…), sem eventos nem estilo perigoso.
  const atributosBody = sanitizarHtmlEmail(`<div${atributosBruto}>`).replace(/^<div|>$/g, '')

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${estilos.join('\n')}
</head>
<body${atributosBody}>
<div${atributosBody}>
${conteudo.replace(ESTILO_EMBUTIDO, '').trim()}
</div>
</body>
</html>`
}

export function montarEmailCampanhaHtml(
  corpo: string,
  dados: { responsavelNome?: string | null; nomeServico?: string | null },
  htmlPersonalizado?: string | null,
): string {
  if (htmlPersonalizado?.trim() && ehDocumentoHtmlCompleto(htmlPersonalizado)) {
    return montarDocumentoHtmlCompleto(htmlPersonalizado)
  }
  const conteudo = htmlPersonalizado?.trim()
    ? sanitizarHtmlEmail(htmlPersonalizado)
    : escaparHtmlEmail(corpo).replace(/\r?\n/g, '<br>')
  const responsavel = dados.responsavelNome?.trim()
  const servico = dados.nomeServico?.trim()
  const assinatura = responsavel
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;border-top:1px solid #e5e7eb;">
        <tr><td style="padding-top:18px;color:#475569;font-size:14px;line-height:1.5;">
          <div>Atenciosamente,</div>
          <div style="color:#0f172a;font-weight:700;">${escaparHtmlEmail(responsavel)}</div>
          ${servico ? `<div style="color:#64748b;font-size:12px;">${escaparHtmlEmail(servico)}</div>` : ''}
        </td></tr>
      </table>`
    : ''

  return `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background-color:#f4f5f7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:12px;font-family:Arial,Helvetica,sans-serif;">
        <tr><td style="padding:28px;color:#1e293b;font-size:14px;line-height:1.7;overflow-wrap:anywhere;">
          ${conteudo}
          ${assinatura}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}
