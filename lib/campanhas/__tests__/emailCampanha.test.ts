import { describe, expect, it } from 'vitest'
import { documentoPreviewHtml, extrairTextoHtmlEmail, montarEmailCampanhaHtml, sanitizarHtmlEmail } from '../emailCampanha'

describe('HTML da mensagem de campanha', () => {
  it('preserva o texto, escapa conteúdo e identifica o responsável no final', () => {
    const html = montarEmailCampanhaHtml('Olá <Ana>\nTudo bem?', {
      responsavelNome: 'Francisco & Equipe',
      nomeServico: 'InovaCode',
    })

    expect(html).toContain('Olá &lt;Ana&gt;<br>Tudo bem?')
    expect(html).toContain('Atenciosamente,')
    expect(html).toContain('Francisco &amp; Equipe')
    expect(html).toContain('InovaCode')
    expect(html).toContain('style="width:100%;max-width:640px')
    expect(html.indexOf('Atenciosamente,')).toBeGreaterThan(html.indexOf('Tudo bem?'))
  })

  it('renderiza HTML personalizado permitido e mantém a assinatura real ao final', () => {
    const html = montarEmailCampanhaHtml('fallback', { responsavelNome: 'Maria' }, '<div style="color:#222"><strong>Olá</strong>, {nome}</div>')

    expect(html).toContain('<strong>Olá</strong>, {nome}')
    expect(html).not.toContain('fallback')
    expect(html).toContain('Maria')
    expect(html.indexOf('Maria')).toBeGreaterThan(html.indexOf('{nome}'))
  })

  it('remove scripts, eventos e protocolos perigosos do HTML importado', () => {
    const html = sanitizarHtmlEmail('<script>alert(1)</script><img src="javascript:alert(1)" onerror="alert(2)"><a href="https://empresa.com" onclick="x()">Seguro</a>')

    expect(html).not.toContain('<script')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('onclick')
    expect(html).toContain('href="https://empresa.com"')
  })

  it('gera texto alternativo legível sem CSS ou conteúdo removido', () => {
    const texto = extrairTextoHtmlEmail(`
      <style>.titulo { color: red; }</style>
      <script>alert('não')</script>
      <h1>Olá &amp; bem-vindo</h1>
      <p>Primeira linha<br>Segunda linha</p>
      <ul><li>Item um</li><li>Item dois</li></ul>
    `)

    expect(texto).toBe('Olá & bem-vindo\n\nPrimeira linha\nSegunda linha\n\n• Item um\n\n• Item dois')
    expect(texto).not.toContain('color: red')
    expect(texto).not.toContain('alert')
  })
})

// Template HTML completo (arquivo com doctype/<html>/<body>, como os importados
// para a biblioteca): o destinatário recebe o layout do autor, sem o título do
// arquivo, sem o cartão do sistema e sem uma segunda assinatura.
describe('HTML completo da mensagem', () => {
  const documento = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Título interno do arquivo</title>
  <style>
    @media only screen and (max-width:620px) { .shell { width:100% !important; } }
    .cta { border-left:3px solid #6ee7b7; }
  </style>
</head>
<body style="margin:0;padding:0;background:#eef1f5;font-family:Arial,sans-serif;" onload="alert(1)">
  <table role="presentation" class="shell" width="600" style="width:600px;background:#ffffff;">
    <tr><td>
      <img src="https://exemplo.com/logo.png" width="72" alt="Logo">
      <p>Oi <strong>{{nome}}</strong>, tudo bem na {{empresa}}?</p>
      <div class="cta"><a href="https://exemplo.com/agenda?a=1&b=2">Agendar</a></div>
      <p>Francisco<br><span>Equipe</span></p>
    </td></tr>
  </table>
</body>
</html>`
  const responsavel = { responsavelNome: 'Maria Responsável', nomeServico: 'Serviço X' }

  it('não exibe o texto do <title> no e-mail, na prévia nem no texto alternativo', () => {
    const html = montarEmailCampanhaHtml('fallback', responsavel, documento)

    expect(html).not.toContain('Título interno do arquivo')
    expect(documentoPreviewHtml(html)).not.toContain('Título interno do arquivo')
    expect(extrairTextoHtmlEmail(documento)).not.toContain('Título interno do arquivo')
    expect(extrairTextoHtmlEmail(documento)).toMatch(/^Oi \{\{nome\}\}, tudo bem na \{\{empresa\}\}\?/)
  })

  it('não envolve o layout do autor no cartão do sistema', () => {
    const html = montarEmailCampanhaHtml('fallback', responsavel, documento)

    expect(html).not.toContain('max-width:640px')
    expect(html).not.toContain('#f4f5f7')
    expect(html).not.toContain('fallback')
    expect(html.match(/<html\b/gi)).toHaveLength(1)
    expect(html.match(/<body\b/gi)).toHaveLength(1)
    expect(html.match(/<table\b/gi)).toHaveLength(1)
  })

  it('não acrescenta a assinatura automática à assinatura do próprio HTML', () => {
    const html = montarEmailCampanhaHtml('fallback', responsavel, documento)

    expect(html).not.toContain('Atenciosamente')
    expect(html).not.toContain('Maria Responsável')
    expect(html).not.toContain('Serviço X')
    expect(html).toContain('Francisco<br /><span>Equipe</span>')
  })

  it('preserva logo, estilos responsivos, variáveis e links', () => {
    const html = montarEmailCampanhaHtml('fallback', responsavel, documento)
    const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'))

    expect(html).toContain('<img src="https://exemplo.com/logo.png" width="72" alt="Logo" />')
    expect(head).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">')
    expect(head).toContain('@media only screen and (max-width:620px) { .shell { width:100% !important; } }')
    expect(head).toContain('.cta { border-left:3px solid #6ee7b7; }')
    expect(html.match(/<style\b/gi)).toHaveLength(1)
    expect(html).toContain('class="shell"')
    expect(html).toContain('<strong>{{nome}}</strong>, tudo bem na {{empresa}}?')
    expect(html).toContain('href="https://exemplo.com/agenda?a=1&amp;b=2"')
  })

  it('reaplica o estilo do <body> do autor, sem eventos, também na prévia', () => {
    const estilo = 'style="margin:0;padding:0;background:#eef1f5;font-family:Arial,sans-serif;"'
    const html = montarEmailCampanhaHtml('fallback', responsavel, documento)

    expect(html).toContain(`<body ${estilo}>`)
    expect(html).toContain(`<div ${estilo}>`)
    expect(html).not.toContain('onload')
    // A prévia sanitiza de novo e descarta o <body>: a <div> mantém fonte e fundo.
    expect(documentoPreviewHtml(html)).toContain(`<div ${estilo}>`)
  })

  it('continua sanitizando o documento completo', () => {
    const html = montarEmailCampanhaHtml('fallback', responsavel,
      '<html><body><script>alert(1)</script><a href="javascript:alert(2)" onclick="x()">a</a><p>Olá</p></body></html>')

    expect(html).not.toMatch(/<script|javascript:|onclick/i)
    expect(html).toContain('<p>Olá</p>')
  })

  it('também reconhece documento só com <body>, sem doctype nem <html>', () => {
    const html = montarEmailCampanhaHtml('fallback', responsavel, '<body style="margin:0"><p>Olá</p></body>')

    expect(html).not.toContain('max-width:640px')
    expect(html).not.toContain('Atenciosamente')
    expect(html).toContain('<p>Olá</p>')
  })

  it('remover o <title> mantém a sanitização idempotente', () => {
    const uma = sanitizarHtmlEmail(documento)
    expect(uma).not.toContain('Título interno do arquivo')
    expect(sanitizarHtmlEmail(uma)).toBe(uma)
  })
})

// Texto puro e fragmentos HTML (modelo pronto, editor, colado sem <html>/<body>)
// seguem no cartão do sistema com a assinatura do responsável, como antes.
describe('mensagem simples ou fragmento HTML', () => {
  it('texto puro mantém cartão e assinatura', () => {
    const html = montarEmailCampanhaHtml('Olá {nome},\nsegue a proposta.', { responsavelNome: 'Maria', nomeServico: 'Serviço X' })

    expect(html).toContain('Olá {nome},<br>segue a proposta.')
    expect(html).toContain('max-width:640px')
    expect(html).toContain('Atenciosamente,')
    expect(html).toContain('Maria')
    expect(html).toContain('Serviço X')
  })

  it('fragmento HTML mantém cartão e assinatura', () => {
    const html = montarEmailCampanhaHtml('fallback', { responsavelNome: 'Maria' },
      '<table role="presentation"><tr><td><p>Olá {{nome}}</p></td></tr></table>')

    expect(html).toContain('max-width:640px')
    expect(html).toContain('<p>Olá {{nome}}</p>')
    expect(html).toContain('Atenciosamente,')
    expect(html.indexOf('Atenciosamente,')).toBeGreaterThan(html.indexOf('Olá {{nome}}'))
  })

  it('texto que menciona <html> não vira documento completo', () => {
    const html = montarEmailCampanhaHtml('Use a tag <html> no arquivo.', { responsavelNome: 'Maria' })

    expect(html).toContain('Use a tag &lt;html&gt; no arquivo.')
    expect(html).toContain('max-width:640px')
    expect(html).toContain('Atenciosamente,')
  })

  it('sem responsável, o fragmento segue no cartão sem assinatura', () => {
    const html = montarEmailCampanhaHtml('fallback', {}, '<p>Aviso</p>')

    expect(html).toContain('max-width:640px')
    expect(html).not.toContain('Atenciosamente')
  })
})

// O HTML passa pela sanitização mais de uma vez no caminho real (editor grava
// sanitizado → montarEmailCampanhaHtml sanitiza → documentoPreviewHtml sanitiza
// de novo na prévia). Antes, cada passagem reescapava os atributos e
// `?a=1&b=2` virava `?a=1&amp;amp;b=2` — link quebrado no e-mail enviado.
describe('sanitização idempotente', () => {
  const casos: [string, string][] = [
    ['link com query string', '<a href="https://art.com.br/renovar?a=1&b=2&utm=campanha">Renovar</a>'],
    ['link já escapado', '<a href="https://art.com.br/renovar?a=1&amp;b=2">Renovar</a>'],
    ['mailto com assunto', '<a href="mailto:contato@art.com.br?subject=Renova%C3%A7%C3%A3o&body=Ol%C3%A1">Escrever</a>'],
    ['imagem com atributos permitidos', '<img src="https://cdn.art.com.br/logo.png?v=2&x=1" alt="Logo &quot;ART&quot;" width="120" />'],
    ['acentos e entidade numérica', '<p title="Validade &#233; 30/09">Renovação — laudo técnico &amp; anexos</p>'],
    ['tabela com estilo inline', '<table role="presentation" style="width:100%;border:1px solid #e5e7eb"><tr><td align="left">Olá</td></tr></table>'],
    ['âncora interna', '<a href="#topo">Voltar ao topo</a>'],
  ]

  it.each(casos)('%s: sanitizar duas vezes dá o mesmo resultado', (_nome, html) => {
    const uma = sanitizarHtmlEmail(html)
    expect(sanitizarHtmlEmail(uma)).toBe(uma)
    expect(sanitizarHtmlEmail(sanitizarHtmlEmail(uma))).toBe(uma)
  })

  it('preserva a query string do link em qualquer número de passagens', () => {
    const uma = sanitizarHtmlEmail('<a href="https://art.com.br/r?a=1&b=2">x</a>')
    expect(uma).toContain('href="https://art.com.br/r?a=1&amp;b=2"')
    expect(sanitizarHtmlEmail(uma)).not.toContain('&amp;amp;')
  })

  it('o caminho real (editor → envio → prévia) não acumula escape', () => {
    const doEditor = sanitizarHtmlEmail('<a href="https://art.com.br/r?a=1&b=2">Renovar</a>')
    const enviado = montarEmailCampanhaHtml('Renovar', { responsavelNome: 'Aline' }, doEditor)
    const previa = documentoPreviewHtml(enviado)
    for (const saida of [enviado, previa]) {
      expect(saida).toContain('href="https://art.com.br/r?a=1&amp;b=2"')
      expect(saida).not.toContain('&amp;amp;')
    }
  })

  it('continua bloqueando script, eventos e URL disfarçada por entidade', () => {
    const html = sanitizarHtmlEmail(
      '<script>alert(1)</script><a href="&#106;avascript:alert(1)" onclick="x()">a</a>' +
      '<img src="javascript:alert(1)" onerror="y()"><p style="background:url(javascript:z)">t</p>',
    )
    expect(html).not.toMatch(/<script|onclick|onerror|javascript:/i)
    expect(html).not.toContain('href=')
    expect(html).not.toContain('src=')
    expect(sanitizarHtmlEmail(html)).toBe(html)
  })

  it('texto alternativo é o mesmo depois de passagens repetidas', () => {
    const html = '<p>Olá &amp; bem-vindo — <a href="https://x.com/?a=1&b=2">link</a></p>'
    const uma = extrairTextoHtmlEmail(sanitizarHtmlEmail(html))
    expect(extrairTextoHtmlEmail(sanitizarHtmlEmail(sanitizarHtmlEmail(html)))).toBe(uma)
    expect(uma).toContain('Olá & bem-vindo')
  })
})
