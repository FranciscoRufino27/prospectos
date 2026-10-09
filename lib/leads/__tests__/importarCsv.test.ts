import { describe, it, expect } from 'vitest'
import {
  parseCSV,
  detectarDelimitador,
  emailValido,
  processarPlanilhaPadrao,
  dedupeInternaPorEmail,
  resumirNichosImportacao,
  parseDataValidade,
  ORIGEM_PADRAO_IMPORT,
  type LeadPadrao,
} from '../importarCsv'

describe('parseCSV', () => {
  it('respeita aspas com o delimitador dentro do campo', () => {
    const csv = 'nome;empresa\n"Silva; & Cia";"Acme, Inc"'
    const rows = parseCSV(csv, ';')
    expect(rows).toEqual([{ nome: 'Silva; & Cia', empresa: 'Acme, Inc' }])
  })

  it('aceita delimitador vírgula quando informado', () => {
    const rows = parseCSV('a,b\n1,2', ',')
    expect(rows).toEqual([{ a: '1', b: '2' }])
  })

  it('ignora linhas totalmente vazias', () => {
    const rows = parseCSV('a;b\n1;2\n\n', ';')
    expect(rows).toHaveLength(1)
  })
})

describe('detectarDelimitador', () => {
  it('detecta ; , e tab pela primeira linha', () => {
    expect(detectarDelimitador('a;b;c\n1;2;3')).toBe(';')
    expect(detectarDelimitador('a,b,c\n1,2,3')).toBe(',')
    expect(detectarDelimitador('a\tb\n1\t2')).toBe('\t')
  })
})

describe('emailValido', () => {
  it('valida formato básico', () => {
    expect(emailValido('a@b.com')).toBe(true)
    expect(emailValido('sem-arroba')).toBe(false)
    expect(emailValido('a@b')).toBe(false)
  })
})

describe('processarPlanilhaPadrao', () => {
  it('mapeia cabeçalhos pt/en e acentos e normaliza e-mail', () => {
    const csv = 'Nome;E-mail;Empresa;Nicho;Responsável;Origem;Telefone;Cargo;Cidade;Estado\n' +
      'Ana;ANA@X.COM;Acme;Ótica;Aline Muller;LinkedIn;(11) 99999-0000;CEO;São Paulo;SP'
    const { validos, pulados } = processarPlanilhaPadrao(csv)
    expect(pulados).toHaveLength(0)
    expect(validos[0]).toEqual<LeadPadrao>({
      contato_nome: 'Ana',
      contato_email: 'ana@x.com',
      empresa: 'Acme',
      segmento: 'oticas',
      responsavel: 'Aline Muller',
      origem: 'LinkedIn',
      contato_telefone: '11999990000',
      contato_cargo: 'CEO',
      cidade: 'São Paulo',
      estado: 'SP',
      data_validade: null,
    })
  })

  it('mapeia o header composto Nicho/Segmento anunciado pelo modal de importação', () => {
    const csv = 'Nome,E-mail,Empresa,Nicho/Segmento,Origem,Responsavel\n' +
      'Ana,ana@x.com,Acme,Laudos de Brinquedos,Planilha,Ana'
    const { validos, pulados } = processarPlanilhaPadrao(csv)
    expect(pulados).toHaveLength(0)
    expect(validos[0].segmento).toBe('laudos_de_brinquedos')
  })

  it('pula linhas sem nome, e-mail válido, empresa ou responsável', () => {
    const csv = 'nome;email;empresa;nicho;responsavel\n' +
      ';a@x.com;Acme;Varejo;Ana\n' +      // sem_nome
      'B;;Acme;Varejo;Ana\n' +            // sem_email
      'C;invalido;Acme;Varejo;Ana\n' +    // email_invalido
      'D;d@x.com;;Varejo;Ana\n' +         // sem_empresa
      'E;e@x.com;Acme;Varejo;\n' +        // sem_responsavel
      'F;f@x.com;Acme;Varejo;Ana'         // válido
    const { validos, pulados } = processarPlanilhaPadrao(csv)
    expect(validos).toHaveLength(1)
    expect(validos[0].contato_email).toBe('f@x.com')
    expect(pulados.map((p) => p.motivo).sort()).toEqual(
      ['email_invalido', 'sem_email', 'sem_empresa', 'sem_nome', 'sem_responsavel'],
    )
  })

  // A coluna é obrigatória: planilha sem ela não importa NADA, em vez de
  // carimbar um dono qualquer como o importador antigo fazia.
  it('planilha SEM a coluna Responsável pula todas as linhas', () => {
    const { validos, pulados } = processarPlanilhaPadrao(
      'nome;email;empresa;nicho\nA;a@x.com;Acme;Varejo\nB;b@x.com;Beta;Varejo',
    )
    expect(validos).toHaveLength(0)
    expect(pulados.map((p) => p.motivo)).toEqual(['sem_responsavel', 'sem_responsavel'])
  })

  it('aceita os aliases de responsável do HubSpot', () => {
    for (const cab of ['Responsável', 'Comercial', 'Owner', 'Contact owner', 'Proprietario', 'Vendedor']) {
      const { validos } = processarPlanilhaPadrao(
        `nome;email;empresa;${cab}\nA;a@x.com;Acme;aline@empresa.com`,
      )
      expect(validos[0]?.responsavel, cab).toBe('aline@empresa.com')
    }
  })

  it('importa lead SEM segmento — a planilha externa raramente traz nicho', () => {
    const csv = 'nome;email;empresa;nicho;responsavel\n' +
      'Sem nicho;sem@x.com;Acme;;Ana\n' +
      'Com nicho;com@x.com;Acme;Varejo;Ana'
    const { validos, pulados, semSegmento } = processarPlanilhaPadrao(csv)

    expect(pulados).toHaveLength(0)
    expect(validos).toHaveLength(2)
    expect(validos.find((l) => l.contato_email === 'sem@x.com')?.segmento).toBeNull()
    expect(validos.find((l) => l.contato_email === 'com@x.com')?.segmento).toBe('varejo')
    // A prévia precisa do número para avisar que esses ficam fora da esteira.
    expect(semSegmento).toBe(1)
  })

  it('planilha sem NENHUMA coluna de nicho importa tudo', () => {
    const { validos, pulados, semSegmento } = processarPlanilhaPadrao(
      'nome;email;empresa;responsavel\nA;a@x.com;Acme;Ana\nB;b@x.com;Beta;Ana',
    )
    expect(pulados).toHaveLength(0)
    expect(validos).toHaveLength(2)
    expect(semSegmento).toBe(2)
  })

  it('resumo de nichos ignora quem não tem segmento, sem quebrar', () => {
    const { validos } = processarPlanilhaPadrao(
      'nome;email;empresa;nicho;responsavel\nA;a@x.com;Acme;;Ana\nB;b@x.com;Beta;Varejo;Ana',
    )
    expect(resumirNichosImportacao(validos, ['varejo'])).toEqual([
      { nicho: 'varejo', leads: 1, templateAtivo: true },
    ])
  })

  it('usa origem padrão quando a coluna Origem falta/está vazia', () => {
    const { validos } = processarPlanilhaPadrao('nome;email;empresa;nicho;responsavel\nA;a@x.com;Acme;Indústria;Ana')
    expect(validos[0].origem).toBe(ORIGEM_PADRAO_IMPORT)
  })

  it('aceita aliases de nicho e mantém taxonomia aberta normalizada', () => {
    const { validos } = processarPlanilhaPadrao(
      'Name,Email,Company,Industry,Owner\nA,a@x.com,Acme,Mineração,Ana',
    )
    expect(validos[0].segmento).toBe('mineracao')
  })

  // --- Validade do laudo (opcional) -----------------------------------------

  it('lê a coluna de validade (aliases pt/en, com acento) e grava em ISO', () => {
    for (const cab of ['Validade', 'Data de Validade', 'Vencimento', 'Validade do Laudo', 'Expiration']) {
      const { validos, validadeInvalida } = processarPlanilhaPadrao(
        `nome;email;empresa;responsavel;${cab}\nA;a@x.com;Acme;Ana;15/03/2027`,
      )
      expect(validos[0].data_validade, cab).toBe('2027-03-15')
      expect(validadeInvalida).toBe(0)
    }
  })

  it('planilha SEM coluna de validade importa tudo com validade null — o campo é opcional', () => {
    const { validos, pulados, validadeInvalida } = processarPlanilhaPadrao(
      'nome;email;empresa;responsavel\nA;a@x.com;Acme;Ana\nB;b@x.com;Beta;Ana',
    )
    expect(pulados).toHaveLength(0)
    expect(validos.map((l) => l.data_validade)).toEqual([null, null])
    expect(validadeInvalida).toBe(0)
  })

  it('célula de validade vazia não pula a linha nem conta como inválida', () => {
    const { validos, pulados, validadeInvalida } = processarPlanilhaPadrao(
      'nome;email;empresa;responsavel;validade\nA;a@x.com;Acme;Ana;\nB;b@x.com;Beta;Ana;01/01/2027',
    )
    expect(pulados).toHaveLength(0)
    expect(validos[0].data_validade).toBeNull()
    expect(validos[1].data_validade).toBe('2027-01-01')
    expect(validadeInvalida).toBe(0)
  })

  it('validade que não é data: lead ENTRA (sem validade) e a prévia recebe a contagem', () => {
    const { validos, pulados, validadeInvalida } = processarPlanilhaPadrao(
      'nome;email;empresa;responsavel;validade\n' +
      'A;a@x.com;Acme;Ana;31/02/2027\n' +      // dia inexistente
      'B;b@x.com;Beta;Ana;em breve\n' +        // texto
      'C;c@x.com;Gama;Ana;15/03/27\n' +        // ano de 2 dígitos (ambíguo)
      'D;d@x.com;Delta;Ana;2027-03-15',        // válida
    )
    expect(pulados).toHaveLength(0)
    expect(validos).toHaveLength(4)
    expect(validos.slice(0, 3).map((l) => l.data_validade)).toEqual([null, null, null])
    expect(validos[3].data_validade).toBe('2027-03-15')
    expect(validadeInvalida).toBe(3)
  })
})

describe('parseDataValidade', () => {
  it('aceita dd/mm/aaaa (com /, - ou .) e aaaa-mm-dd', () => {
    expect(parseDataValidade('15/03/2027')).toBe('2027-03-15')
    expect(parseDataValidade('5/3/2027')).toBe('2027-03-05')
    expect(parseDataValidade('15-03-2027')).toBe('2027-03-15')
    expect(parseDataValidade('15.03.2027')).toBe('2027-03-15')
    expect(parseDataValidade('2027-03-15')).toBe('2027-03-15')
    expect(parseDataValidade('  31/12/2026  ')).toBe('2026-12-31')
  })

  it('rejeita data inexistente, ano de 2 dígitos, formato americano ambíguo e lixo', () => {
    expect(parseDataValidade('31/02/2027')).toBeNull()
    expect(parseDataValidade('00/01/2027')).toBeNull()
    expect(parseDataValidade('15/13/2027')).toBeNull()
    expect(parseDataValidade('15/03/27')).toBeNull()
    expect(parseDataValidade('2027/03/15')).toBeNull()
    expect(parseDataValidade('março 2027')).toBeNull()
    expect(parseDataValidade('')).toBeNull()
    expect(parseDataValidade('   ')).toBeNull()
  })

  it('não escorrega o dia por fuso horário (usa UTC)', () => {
    expect(parseDataValidade('01/01/2027')).toBe('2027-01-01')
    expect(parseDataValidade('2026-12-31')).toBe('2026-12-31')
  })
})

describe('resumirNichosImportacao', () => {
  it('conta novos leads por nicho e informa se há template ativo', () => {
    const leads = [
      { segmento: 'Ótica' },
      { segmento: 'oticas' },
      { segmento: 'Mineração' },
    ]
    expect(resumirNichosImportacao(leads, ['Óticas'])).toEqual([
      { nicho: 'mineracao', leads: 1, templateAtivo: false },
      { nicho: 'oticas', leads: 2, templateAtivo: true },
    ])
  })
})

describe('dedupeInternaPorEmail', () => {
  it('mantém o primeiro de cada e-mail (case-insensitive)', () => {
    const leads = [
      { contato_email: 'a@x.com', v: 1 },
      { contato_email: 'A@X.COM', v: 2 },
      { contato_email: 'b@x.com', v: 3 },
    ]
    const { unicos, duplicados } = dedupeInternaPorEmail(leads)
    expect(duplicados).toBe(1)
    expect(unicos.map((u) => u.v)).toEqual([1, 3])
  })
})
