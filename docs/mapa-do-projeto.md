# Mapa do ProspectOS

Referência de orientação: o que existe, onde fica e como as peças se ligam.
Não substitui `AGENTS.md` (regras de trabalho) nem `docs/empresa-contato-transicao.md`
(a transição de modelo de dados). Quando divergir do código, o código vence.

Levantado em 22/09/2026, sobre `main` em `96c0332`. Seções 15c e 15d atualizadas em 30/09/2026.

---

## 1. Objetivo do projeto

Automatizar prospecção B2B de ponta a ponta — do primeiro contato até a reunião
marcada — para que o vendedor gaste tempo só fechando.

A promessa está na própria tela de login: *"Sua prospecção no piloto automático, do
primeiro contato à reunião."*

### O ciclo que ele fecha

```
lead entra  →  motor aborda  →  follow-ups no timing certo  →  detecta resposta
                                                                    ↓
              renovação  ←  ganho  ←  proposta  ←  handoff para o closer
```

O diferencial não é cada etapa isolada — é o **loop inteiro rodando sem intervenção**.
O motor lê a caixa do Gmail, identifica quem respondeu, escala para o closer e segue
perseguindo quem não respondeu, por cron diário.

### De onde veio

`lib/engine/README.md` deixa a origem explícita: o motor **substitui os fluxos do n8n**,
trazendo a automação para dentro do próprio Next.js, sobre o mesmo Supabase.

Nasceu como reescrita de automação externa, com trava de migração gradual —
`leads.owner` defaulta para `'n8n'` e o motor só age em lead liberado à mão
(migration `0001`). Essa trava continua valendo.

### O que mudou depois

Duas evidências de que deixou de ser ferramenta interna e virou produto:

**Virou multi-tenant.** RBAC, RLS, isolamento por `organizacao_id`, configuração por
workspace. Um comentário em `app/api/organizacoes/criar/route.ts:18` entrega o modelo:
o código de convite é "o que o Chico entrega ao cliente" — há organizações clientes
entrando.

**Ganhou um vertical.** `laudo_ciclos`, `data_validade`, `servicos_recorrentes` e
`scripts/configurar-renovacao-art-laudos.ts` apontam para engenharia e inspeção técnica,
onde o serviço vence em data conhecida. Isso explica o módulo de renovação: não é só
captar cliente novo, é **reabordar antes do vencimento** — receita recorrente previsível.

### Em uma frase

Motor de prospecção B2B multi-tenant que a InovaCode construiu para si, substituindo
n8n, e hoje opera como plataforma para organizações clientes — com um ciclo de renovação
acoplado, voltado a serviços técnicos com validade.

### Os quatro subsistemas

| Subsistema | Onde | O que faz |
|---|---|---|
| **Motor de cadência** | `lib/engine/` | Abordagem e follow-up por e-mail, detecção de resposta, direcionamento ao closer |
| **Workflows** | `lib/workflows/` | Automações montadas na UI, versionadas e imutáveis após publicar |
| **Campanhas** | `lib/campanhas/` | Disparo em lote sobre um público, com prévia e trava de `dry_run` |
| **Comercial** | `lib/comercial/` | Handoff, acompanhamento, propostas e renovação |

> Esta seção é leitura de código, comentários e estrutura de dados. Não há documento de
> visão ou roadmap no repositório. Se existe um pitch oficial, ele mora fora daqui e pode
> enquadrar diferente.

---

## 2. Stack

- **Next.js 16.2.9** com App Router e Turbopack — a API difere de versões anteriores;
  consulte `node_modules/next/dist/docs/` antes de mexer
- React 19.2.4, Tailwind 4
- Supabase (Postgres + Auth + RLS) — cliente em quatro variantes, ver §6
- Vitest — 133 arquivos, 1276 testes
- Deploy na Vercel; crons e filas em `vercel.json`

---

## 3. Páginas

Todas passam pelo `proxy.ts`, que redireciona para `/login` sem sessão.
O menu lateral (`components/layout/Sidebar.tsx`) expõe só oito delas.

### No menu

| Rota | Arquivo | Função |
|---|---|---|
| `/dashboard` | `app/dashboard/page.tsx` | Visão geral. Widgets configuráveis por workspace |
| `/pipeline` | `app/pipeline/page.tsx` | Kanban + tabela. Duas visões: board e cadência |
| `/base-leads` | `app/base-leads/page.tsx` | Cadastro completo, paginado e virtualizado |
| `/reunioes` | `app/reunioes/page.tsx` | Agenda de reuniões marcadas |
| `/inteligencia-comercial` | `app/inteligencia-comercial/page.tsx` | Leitura por lead: dor, aderência, abordagem sugerida |
| `/comercial` | `app/comercial/page.tsx` | Handoff, acompanhamento e propostas |
| `/equipe` | `app/equipe/page.tsx` | Membros, convites e permissões |
| `/automacao` | `app/automacao/page.tsx` | Hub de campanhas e workflows |

### Fora do menu

| Rota | Função |
|---|---|
| `/` | Entrada; redireciona |
| `/login`, `/definir-senha` | Autenticação |
| `/criar-organizacao` | Onboarding. Exige `ONBOARDING_SIGNUP_CODE`, senão fica desligado |
| `/leads/[id]` | Painel do lead — timeline, ações do motor, laudo, serviços |
| `/campanhas` | Lista de campanhas |
| `/automacao/campanhas/nova` | Criação guiada |
| `/automacao/campanhas/[id]` | Detalhe |
| `/automacao/campanhas/[id]/editar` | Edição |
| `/automacao/campanhas/[id]/mensagens` | Mensagens da cadência |
| `/workflows`, `/workflows/[id]` | Lista e editor de workflow |
| `/templates` | Biblioteca de templates da organização |
| `/tarefas` | Fila de tarefas |
| `/processo-comercial` | Processo comercial |
| `/simulador` | Simulador de propostas — preço, desconto, condições |
| `/copiloto` | Copiloto de IA |
| `/configuracoes` | Workspace, parâmetros do motor, distribuição |
| `/perfil`, `/meu-perfil` | Perfil do usuário |

> Existem `/perfil` e `/meu-perfil` em paralelo. Verifique qual está em uso antes de mexer.

---

## 4. Rotas de API

77 rotas em `app/api/`. **Todas as 77 têm guarda de autorização** — verificado uma a uma.

Legenda da coluna *Guarda*:

| Valor | Mecanismo |
|---|---|
| `RBAC` | `exigirPermissao()` — sessão + organização + permissão nomeada |
| `sessao+org` | `resolverAcesso()` ou `resolverContexto()` — org vem do perfil, nunca do payload |
| `sessao` | `auth.getUser()` direto, org resolvida na própria rota |
| `segredo interno` | `INTERNAL_SECRET` ou `CRON_SECRET`, via `autorizar()` (`lib/engine/http.ts`) |
| `segredo webhook` | Segredo do provedor — `validarSegredoWebhook`, `WHATSAPP_VERIFY_TOKEN` |
| `HMAC` | Token assinado por lead (`validarTokenOptout`) |
| `fila Vercel` | `handleCallback` do `@vercel/queue` |
| `código de convite` | `ONBOARDING_SIGNUP_CODE`; sem a variável, o cadastro fica desligado |

### Leads e pipeline

| Rota | Métodos | Guarda | Permissão |
|---|---|---|---|
| `/api/leads/[id]/entidades` | GET | sessao+org | — |
| `/api/leads/[id]/insight` | POST | sessao+org | — |
| `/api/leads/[id]/laudo` | GET POST | sessao+org | — |
| `/api/leads/[id]/mensagem` | POST | sessao+org | — |
| `/api/leads/[id]` | PATCH | sessao+org | — |
| `/api/leads/[id]/servicos` | GET POST | sessao+org | — |
| `/api/leads/importar` | POST | sessao+org | — |
| `/api/leads` | POST | sessao | — |
| `/api/pipelines/[id]/estagios` | PUT | sessao+org | workspace.configure |
| `/api/pipelines` | GET POST | sessao+org | workspace.configure |
| `/api/servicos/[id]` | PATCH | sessao+org | — |

### Motor de cadência

| Rota | Métodos | Guarda | Permissão |
|---|---|---|---|
| `/api/engine/detectar-resposta` | POST | segredo interno | — |
| `/api/engine/executar-acao` | POST | segredo interno | — |
| `/api/engine/follow-up` | (handler) | segredo interno | — |
| `/api/engine/relatorio-semanal` | (handler) | segredo interno | — |
| `/api/engine/respostas-email-watchdog` | GET | segredo interno | — |

### Campanhas

| Rota | Métodos | Guarda | Permissão |
|---|---|---|---|
| `/api/campanhas/[id]/agenda` | PATCH | RBAC | campaigns.manage |
| `/api/campanhas/[id]/ativar` | POST | RBAC | campaigns.manage |
| `/api/campanhas/[id]/enrollar` | POST | RBAC | campaigns.manage |
| `/api/campanhas/[id]/iniciar` | POST | RBAC | campaigns.manage |
| `/api/campanhas/[id]/linha-do-tempo` | GET | sessao+org | campaigns.view |
| `/api/campanhas/[id]/mensagens` | PATCH | RBAC | campaigns.manage campaigns.tipos.avancados |
| `/api/campanhas/[id]` | GET PATCH DELETE | RBAC | campaigns.manage campaigns.tipos.avancados campaigns.view |
| `/api/campanhas/metricas` | GET | sessao+org | campaigns.view |
| `/api/campanhas/opcoes` | GET | sessao+org | campaigns.view |
| `/api/campanhas/publico/previa` | POST | RBAC | campaigns.manage |
| `/api/campanhas` | GET POST | RBAC | campaigns.manage campaigns.tipos.avancados campaigns.view |
| `/api/campanhas/teste-email` | POST | RBAC | campaigns.manage |

### Workflows

| Rota | Métodos | Guarda | Permissão |
|---|---|---|---|
| `/api/workflows/[id]/acao` | POST | sessao+org | — |
| `/api/workflows/[id]/inscrever` | POST | sessao+org | — |
| `/api/workflows/[id]/previa` | GET | sessao+org | — |
| `/api/workflows/[id]` | GET PATCH DELETE | sessao+org | — |
| `/api/workflows/[id]/simular` | POST | sessao+org | — |
| `/api/workflows/execucoes` | GET | sessao+org | workflows.view |
| `/api/workflows/modelos` | GET | sessao+org | workflows.view |
| `/api/workflows/processar` | (handler) | segredo interno | — |
| `/api/workflows` | GET POST | sessao+org | — |

### Comercial, propostas e renovação

| Rota | Métodos | Guarda | Permissão |
|---|---|---|---|
| `/api/comercial/handoff/acompanhamento` | (handler) | segredo interno | — |
| `/api/comercial/handoff/notificacoes/reprocessar` | POST | segredo interno | — |
| `/api/oportunidades/[id]` | PATCH | sessao+org | — |
| `/api/oportunidades` | GET POST | sessao+org | — |
| `/api/propostas/[id]/enviar` | POST | RBAC | conversations.send |
| `/api/propostas` | POST | sessao+org | — |
| `/api/renovacao/processar` | (handler) | segredo interno | — |
| `/api/roi` | GET | sessao+org | analytics.view |

### Canais e webhooks

| Rota | Métodos | Guarda | Permissão |
|---|---|---|---|
| `/api/email/enviar` | POST | RBAC | conversations.send |
| `/api/optout` | GET POST | HMAC | — |
| `/api/webhooks/whatsapp` | GET POST | RBAC | — |
| `/api/webhooks/zapi/delivery` | POST | segredo webhook | — |
| `/api/webhooks/zapi/received` | POST | segredo webhook | — |
| `/api/webhooks/zapi/status` | POST | segredo webhook | — |
| `/api/whatsapp/enviar` | POST | RBAC | campaigns.operate |
| `/api/whatsapp/send` | POST | RBAC | conversations.send |
| `/api/whatsapp/status` | GET | RBAC | conversations.send |

### Filas (Vercel Queue)

| Rota | Métodos | Guarda | Permissão |
|---|---|---|---|
| `/api/queues/campanhas-email` | (handler) | fila Vercel | — |
| `/api/queues/comercial-acompanhamento` | (handler) | fila Vercel | — |
| `/api/queues/respostas-email` | (handler) | fila Vercel | — |
| `/api/queues/workflows-retomada` | (handler) | fila Vercel | — |

### Plataforma

| Rota | Métodos | Guarda | Permissão |
|---|---|---|---|
| `/api/configuracoes/distribuicao-comercial` | GET PUT | RBAC | workspace.configure |
| `/api/configuracoes/motor` | GET POST | RBAC | workspace.configure |
| `/api/configuracoes/workspace` | GET PUT | RBAC | workspace.configure |
| `/api/copiloto` | POST | sessao | — |
| `/api/dashboard/resumo` | GET | sessao+org | — |
| `/api/equipe/[id]` | PATCH DELETE | RBAC | workspace.configure |
| `/api/equipe/convidar` | POST | RBAC | workspace.configure |
| `/api/equipe/listar` | GET | sessao | — |
| `/api/flags` | GET | sessao+org | — |
| `/api/notificacoes` | GET | sessao+org | — |
| `/api/organizacoes/criar` | POST | código de convite | — |
| `/api/perfil/avatar` | POST | sessao | — |
| `/api/perfil` | GET POST | sessao | — |
| `/api/rbac/permissoes` | GET | sessao+org | — |
| `/api/tarefas/[id]` | PATCH | sessao+org | — |
| `/api/tarefas` | GET | sessao+org | — |
| `/api/templates/[id]` | GET PATCH DELETE | RBAC | templates.manage templates.view |
| `/api/templates` | GET POST | RBAC | templates.manage templates.view |
| `/api/usuarios` | GET | sessao+org | — |

> **`/api/optout`** é pública de propósito, protegida por HMAC por lead. O `GET` só
> renderiza confirmação; a baixa acontece no `POST`. Isso existe porque scanners de link
> (Outlook SafeLinks, antivírus) fazem prefetch do `GET` e cancelariam leads sozinhos.

---

## 5. Crons

Definidos em `vercel.json`. Horários em **UTC** — 12:00 UTC ≈ 09:00 em Brasília.

| Horário | Rota | O que faz |
|---|---|---|
| `0 12 * * *` | `/api/engine/follow-up` | Varredura diária da cadência |
| `15 12 * * *` | `/api/engine/respostas-email-watchdog` | Rede de segurança da detecção |
| `30 12 * * *` | `/api/workflows/processar` | Tick dos workflows |
| `45 12 * * *` | `/api/comercial/handoff/acompanhamento` | Check-in do handoff |
| `0 13 * * *` | `/api/renovacao/processar` | Ciclo de renovação |
| `0 15 * * *` | `/api/engine/follow-up?modo=healthcheck` | Healthcheck |
| `0 12 * * 1` | `/api/engine/relatorio-semanal` | Resumo semanal (segundas) |

---

## 6. Clientes Supabase — qual usar

Escolher errado aqui é como se vaza dado entre organizações.

| Arquivo | Contexto | RLS |
|---|---|---|
| `lib/supabase-browser.ts` | Componentes client | aplicado |
| `lib/supabase-server.ts` | Server components e rotas | aplicado |
| `lib/supabase-admin.ts` | Rotas de sistema, motor, crons | **ignorado** |
| `lib/supabase.ts` | Legado + tipos compartilhados | aplicado |

> **`service_role` ignora RLS.** Toda leitura, escrita e exclusão com o client admin
> precisa filtrar `organizacao_id` explicitamente — inclusive operações por `id`.
> A organização vem da sessão ou de um iterador interno confiável, **nunca** do payload
> do cliente.

---

## 7. Estágios do lead

Definidos em `lib/pipeline-stages.ts`, fonte única do agrupamento.

```
novo, novos_leads                                      → Novos Leads   (reservatório)
primeiro_contato, aguardando_resposta,
  follow_up, follow_up_1, follow_up_2                  → Em Prospecção (tempo real)
interessado, respondeu, com_closer                     → Respondeu
reuniao_agendada                                       → Reunião Agendada
ganho                                                  → Ganho
```

Também existem, fora das colunas: `perdido`, `sem_resposta`, `renovacao`.

O Kanban de `/pipeline` mostra **só** as três últimas colunas. Novos Leads e Em Prospecção
continuam existindo na tabela e no motor — sumiram apenas do board, por volume.

---

## 8. RBAC

`lib/rbac/permissoes.ts` define as permissões; `lib/rbac/servidor.ts` as impõe.

```
campaigns.view | manage | approve | operate | tipos.avancados
workflows.view | manage | publish | executions.manage
templates.view | manage
conversations.send
analytics.view
workspace.configure
```

Papéis padrão: `admin` (tudo) e `usuario` (view + manage de campanhas, view de
workflows/templates, `conversations.send`, `analytics.view`).

Em rota de usuário use `resolverAcesso()` / `exigirPermissao()`. Esconder botão no
frontend não é autorização.

---

## 9. Travas de envio

Nenhuma destas pode ser removida ou contornada:

| Trava | Onde | Efeito |
|---|---|---|
| `owner='engine'` | migration `0001` | Motor só age em lead liberado por humano |
| `MODO_ENSAIO` | `lib/engine/config.ts` | Default `true`. Motor loga, não envia |
| `WHATSAPP_MODO_ENSAIO` | `lib/whatsapp/outbound.ts` | Idem para WhatsApp |
| `campanhas.dry_run` | migration `0024` | Default seguro `true` |
| `RENOVACAO_ENVIO_REAL` | `lib/renovacao/cadenciaAutomatica.ts` | Renovação só envia se explícito |
| `PROSPECCAO_ENVIO_REAL` | `lib/campanhas/prospeccaoAutomatica.ts` | Idem para prospecção |
| Opt-out e bounce | `lib/engine/optout.ts`, migrations `0010`/`0027` | Lead marcado não volta à esteira |
| Idempotência | `lib/campanhas/acaoId.ts` | IDs de ação estáveis |

> `MODO_ENSAIO` trava **envio externo**, não escrita no banco. Rodar local apontando
> para produção altera dado real de cliente mesmo em ensaio.

`dryRun` e simulação precisam ser realmente sem efeito: não envia, não grava, não cria
tarefa, não altera execução real. Ao mexer numa ação externa, teste os dois caminhos.

---

## 10. Workflows — versionamento

Publicado é **imutável**. Cada execução fica presa à versão em que começou.
Edição vai para rascunho; publicar cria versão nova. `lib/workflows/versionamento.ts`.

Se o formato de configuração de um bloco mudar, **crie um tipo novo** — não reinterprete
versões antigas. Referências entre passos usam IDs estáveis, nunca índices.

---

## 11. Empresa × Contato — transição em curso

Leia `docs/empresa-contato-transicao.md` inteiro antes de mexer. A seção final
"Acabamento da Fase 2" é o estado atual; 2c/2d são histórico.

Direção vigente:
- `leads` continua **autoritativa** para os campos core compartilhados
- O trigger da migration `0018` sincroniza a projeção
- Campos exclusivos e o 1:N pertencem a `empresas` / `contatos`

Não contorne essa direção nem remova fallbacks/flags sem validar equivalência.

Dado legado nem sempre tem FK preenchida — preserve os fallbacks testados para
`responsavel_id` nulo e `responsavel_nome` legado.

---

## 12. Configuração por workspace

Feature flags e configuração por organização vivem no blob tipado
`organizacoes.configuracoes`, passam por `parseWorkspaceConfig` /
`serializeWorkspaceConfig` e são resolvidas no servidor.

**Não** use env, `NEXT_PUBLIC_*`, ID exposto ou flag global para habilitar uma única
organização. Esse desenho já falhou em produção.

---

## 13. Migrations

55 arquivos em `db/migrations/`, de `0001_engine_owner_trava` a
`0054_prospeccao_nota_qualidade`.

Marcos úteis para se localizar:

```
0001  trava owner='engine'
0006  RLS das organizações
0008  schema de workflows
0015  RBAC
0016  schema empresas/contatos
0018  trigger de sincronização da projeção
0022  oportunidades
0023  campanhas        0024  dry_run
0028  ciclos de renovação
0035  mensagens WhatsApp
0041  handoff comercial
0045  propostas
0047  retomada da prospecção
0050  catálogo RF      0051  busca/importação da Prospecção
0054  nota de qualidade que ordena a busca da Prospecção
```

> **As migrations não constroem o banco do zero.** `leads`, `interacoes`, `usuarios`,
> `perfis` e `templates` não são criadas por nenhuma delas — a `0001` já começa com
> `alter table leads`. Essas cinco antecedem a numeração e só existem dentro do Supabase.
> Ver §15b para como isso foi contornado ao montar o ambiente de teste.

Migration aplicada é **imutável**. Mudança de schema entra em arquivo novo numerado,
preferencialmente aditivo e idempotente. Operação destrutiva exige plano de dados e
rollback explícitos.

---

## 14. Validação

Na ordem, proporcional ao risco:

```bash
npx vitest run <arquivo>   # teste focado
npm test                   # suíte completa
npx tsc --noEmit           # tipos
npm run build              # build de produção
```

Não existe script `lint` — não alegue ter rodado lint.

---

## 15. Ambiente local

`.env.local` não é versionado. Obrigatórias para subir:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
INTERNAL_SECRET  +  NEXT_PUBLIC_INTERNAL_SECRET   (mesmo valor)
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Travas a manter em dev: `MODO_ENSAIO=true`, `WHATSAPP_MODO_ENSAIO=true`, e **não**
definir `RENOVACAO_ENVIO_REAL` nem `PROSPECCAO_ENVIO_REAL`.

`DATABASE_URL` só é usada pelos scripts de `scripts/`, não pela app.

> `MAX_FOLLOWUPS` aparece em envs antigos mas o código **ignora** — foi substituído por
> `DIAS_FOLLOWUPS` (`lib/engine/config.ts:41,48`). Sobrevive só no setup de teste.

### Latência

O Supabase de **produção** está em `us-west-2` (Oregon). De Brasil, cada ida e volta
custa ~200ms. `/api/dashboard/resumo` encadeia **13 ondas sequenciais** de query
(`route.ts`, 1054 linhas) — daí os ~2,6s observados rodando local contra produção.

`vercel.json` não declara região; o default é `iad1` (Virgínia), costa oposta ao banco.
Em produção o RTT é bem menor que de Brasil, mas a travessia EUA-costa-a-costa persiste.

O ambiente de teste (§15b) fica em São Paulo — RTT de ~20ms, e a esteira acelerada roda
muito mais rápido que contra Oregon.

---

## 15a. O que foi validado da cadência

Validação executada em 22/09/2026, no ambiente de teste (§15b) e em produção.
Resultado: **8 de 8**.

| Exigência | Onde foi provado | Evidência |
|---|---|---|
| Etapas avançam corretamente | teste | `passo_atual` percorre a definição na ordem |
| Tempos de espera funcionam | **produção** | ciclo `aguardando → retomada_enfileirada → retomada_reivindicada → concluído` |
| Pausa bloqueia | teste | `executor.ts:84` retorna antes de qualquer passo |
| Retomada pós-pausa | teste | despausada, seguiu do passo 2 — não reiniciou nem pulou |
| Sem envio duplicado | teste + **produção** | 2ª tentativa com a mesma chave devolve `enviado=false` sem tentar |
| Resposta interrompe | teste | execução vai de `aguardando` a `cancelado`, só no lead da resposta |
| Histórico registrado | teste | `workflow_execucao_eventos` cobre cada passo |
| Retomar erro sem redisparar | teste | `resultado='envio_incerto'` em `mensagens_processadas` barra repetição |
| Ponta a ponta | **produção** | execução completa rastreada na campanha `TESTE FLUXO 21-09` |

### As cinco travas em série antes de um envio

`lib/workflows/ambiente.ts`, na ordem em que executam:

| # | Gate | Linha | Efeito |
|---|---|---|---|
| 1 | `simular` | ~345 | `enviado:false` — execução **avança** |
| 2 | `MODO_ENSAIO` | 348 | **lança exceção** — execução **trava em `erro`** |
| 3 | status da campanha ≠ ativa/concluída | ~372 | `enviado:false` — avança |
| 4 | `campanhas.dry_run = true` | ~376 | `enviado:false` — avança |
| 5 | opt-out / bounce / perdido / resposta | ~388-402 | `enviado:false` — avança |

Só depois disso vem a reserva de idempotência em `mensagens_processadas` e o SMTP.

> **`MODO_ENSAIO` não simula neste caminho — ele lança erro.** É o oposto do motor de
> cadência (`lib/engine`), onde o `SimulatedProvider` devolve sucesso. Para exercitar a
> esteira sem enviar, a trava correta é `campanhas.dry_run = true` com
> `MODO_ENSAIO=false`. Com `MODO_ENSAIO=true` toda execução morre no primeiro envio.

> **Três gates retornam silenciosamente** (1, 3 e 4). Um envio que "não saiu" tem cinco
> causas possíveis e nenhuma mensagem as distingue nos eventos da execução. Não é bug,
> mas é fonte provável de confusão operacional.

### Execução de prospecção em espera exige claim

`executor.ts:96` recusa processar uma execução `aguardando` de campanha `prospeccao`
quando quem chama não é o dono do `claim_token`:

```ts
if (campanhaTipo === 'prospeccao' && ex.status === 'aguardando'
  && (!opcoes.claimToken || ex.claim_token !== opcoes.claimToken)) return
```

É a trava de concorrência entre o cron diário e os callbacks da fila. Consequência
prática: rodar `npm run workflows:tick-teste` sobre execuções em espera reporta
`processadas: 0` — não é falha, é a trava agindo. O destravamento passa por
`retomarProspeccao()` (`lib/workflows/retomadaProspeccao.ts`), que é o que o handler
`app/api/queues/workflows-retomada/route.ts` chama.

Para testar sem a fila, basta invocar `retomarProspeccao()` direto — a fila é só o
gatilho, a lógica de retomada está na função.

### O despertar durável só funciona na infra da Vercel

`publicarRetomadaProspeccao` usa `@vercel/queue`. Sem projeto vinculado, falha com:

```
Failed to get OIDC token for local development.
```

O README do pacote diz que as filas funcionam em dev (`NODE_ENV=development`) — o erro é
**falta de credencial**, não limitação de arquitetura. `vercel link` + `vercel env pull`
resolveriam. Em produção o mecanismo está comprovado (ver tabela acima).

### Teste de e-mail da campanha

`enviarTesteEmailCampanha` (`lib/campanhas/testeEmailServidor.ts:63`), exposta em
`POST /api/campanhas/teste-email`: envia **para a própria conta remetente do workspace**,
com prefixo `[TESTE]` no assunto. Não aceita destinatário digitado, não persiste campanha,
não cria execução.

> Ela **não recebe `campanhaId`**, então não passa pelo gate de `dry_run` — só o
> `MODO_ENSAIO` a barra. Em produção, com `MODO_ENSAIO=false`, o teste envia de verdade
> (para a caixa do próprio workspace) independente de qualquer campanha estar em `dry_run`.

---

## 15b. Ambiente de teste isolado

Montado em 22/09/2026 para a validação ponta a ponta da cadência, sem tocar produção.

| | |
|---|---|
| Projeto Supabase | `prospectos-teste` · ref `krdbouliizfpifhbglpw` |
| Região | South America (São Paulo), `sa-east-1` |
| Organização | `508bdd3c-c93d-4e50-be68-39af2acc07da` |
| Login | `teste@prospectos.local` |
| Leads | 5 hotéis fictícios, `owner='engine'`, `estagio='novos_leads'` |

`.env.local` aponta para ele; o env de produção está em `.env.local.producao-backup`.

### Como o schema foi criado

As migrations **não constroem o banco do zero** — `leads`, `interacoes`, `usuarios`,
`perfis` e `templates` nunca são criadas por nenhuma delas (a `0001` já faz
`alter table leads`). Essas cinco nasceram à mão no painel, na era do n8n, e não estão
versionadas em lugar nenhum.

O ambiente foi montado copiando só a estrutura da produção:

```bash
pg_dump --schema-only --no-owner --no-acl --schema=public "<DATABASE_URL>" -f schema.sql
psql -h aws-0-sa-east-1.pooler.supabase.com -p 5432      -U postgres.krdbouliizfpifhbglpw -d postgres -f schema.sql
```

Resultado: 31 tabelas, 85 índices, 34 triggers, 31 policies de RLS. Zero linha de dado.

> **Risco aberto:** o projeto não pode ser reconstruído a partir do repositório. Uma
> migration `0000_schema_base.sql` gerada por esse mesmo `pg_dump` resolveria — decisão
> pendente com o dono do repo.

### Uma diferença deliberada em relação à produção

O trigger `prospectOS-novo-lead` **não** foi aplicado: ele chama
`supabase_functions.http_request` para um webhook do n8n a cada `INSERT` em `leads`, e
esse schema não existe no projeto novo. É o comportamento desejado num ambiente de teste
— cada lead fictício dispararia uma chamada para a automação real. É o único dos 35
triggers que ficou de fora.

### Modo acelerado

`lib/workflows/blocos.ts:105-122` comprime "1 dia configurado" em N minutos reais. Exige
as duas variáveis, e só age em campanhas `prospeccao` da organização indicada por UUID:

```
PROSPECCAO_TESTE_ORGANIZACAO_ID=508bdd3c-c93d-4e50-be68-39af2acc07da
PROSPECCAO_TESTE_INTERVALO_MINUTOS=2
```

Com 2 min/dia, uma cadência de 3/7/14 dias roda inteira em ~48 minutos.

O motor do teste é `npm run workflows:tick-teste`: bate em `POST /api/workflows/processar`
a cada 15s — o mesmo endpoint do cron, com o mesmo `INTERNAL_SECRET`. Só aponta para
localhost, salvo `WORKFLOWS_TICK_PERMITIR_REMOTO=true` explícito.

### Por que dá para rodar com envio travado

Com `MODO_ENSAIO=true`, o `SimulatedProvider` (`lib/engine/email/simulatedProvider.ts:16`)
**retorna sucesso** e registra o envio numa lista, logando `[ENSAIO] e-mail NÃO enviado`.
A máquina de estados roda inteira — estágio avança, interação é gravada,
`followups_enviados` incrementa — sem um e-mail sair.

No ambiente de teste não há `GMAIL_*`, `WHATSAPP_*` nem chaves de IA, então o envio não
acontece nem por engano.

> `MODO_ENSAIO` trava envio externo, **não** escrita no banco. É por isso que o ambiente
> separado importa: rodando contra produção, cada teste altera dado real de cliente.

---

## 15c. Tela de Prospecção: de onde vem cada dado

A tela `/prospeccao` segue o fluxo **buscar → analisar → selecionar → importar**. Toda
rota abaixo resolve a organização pela sessão (`resolverAcesso()`), nunca pelo corpo da
requisição. O catálogo RF é global e fica invisível ao cliente: só o servidor o lê, com
`service_role`.

### Rotas e quem as chama

| Rota | Quem chama | O que faz |
|---|---|---|
| `POST /api/prospeccao/busca` | `app/prospeccao/page.tsx` | Busca paginada no catálogo RF, com as melhores empresas primeiro (ver abaixo). Devolve empresas, contagens dos cards, filtros efetivos e `ehAdmin` |
| `GET /api/prospeccao/socios?cnpj=` | `DetalheEmpresa.tsx` (botão "Ver sócios") | Quadro societário via OpenCNPJ, avaliação do decisor e e-mail nominal. Só aceita CNPJ que está no catálogo |
| `GET /api/prospeccao/municipios` | `SeletorMunicipios.tsx` | Cidades do catálogo para o filtro e o perfil |
| `GET/PUT /api/configuracoes/workspace` | `PerfilBuscaPainel.tsx` | Lê e salva o perfil de busca (`organizacoes.configuracoes.prospeccao`) |
| `GET/POST /api/prospeccao/pesquisas`, `PATCH/DELETE .../[id]` | `page.tsx` | Pesquisas salvas da organização |
| `POST /api/prospeccao/descartar` | `page.tsx` | Esconde CNPJs das próximas buscas da organização |
| `POST /api/prospeccao/importar` | `ImportarProspeccaoModal.tsx` | `modo=previa` simula sem gravar; `modo=confirmar` cria empresa + lead + contato. Não envia nada |

### Campo a campo

| Na tela | Rota | Origem | Cálculo nosso |
|---|---|---|---|
| Nome, CNPJ, cidade/UF, porte, MEI, atividade | busca | Receita Federal (catálogo RF) | — |
| Razão social, abertura, capital, endereço, CEP, atividades secundárias (no "analisar") | busca | Receita Federal | — |
| E-mail | busca | Receita Federal: é o e-mail cadastral **da empresa**, não o do sócio | Etiqueta de qualidade (`classificarEmail()`): corporativo, caixa genérica, provedor pessoal, provável contador, erro de digitação |
| Telefone | busca | Receita Federal | — |
| Site provável | busca | Domínio do e-mail da Receita | `dominioDaEmpresa()`: diz se confere com o nome ou se pode ser de terceiro |
| Ordem da lista | busca | Nota gravada no catálogo | `notaDoCatalogo()`, ver "Busca ordenada" abaixo |
| Cards "Empresas avaliadas" e "Com e-mail válido" | busca (1ª página) | Contagem no catálogo | E-mail válido = corporativo, genérico ou pessoal |
| "Já na base" | busca | Empresas e leads da própria organização | Casa por CNPJ ou e-mail |
| Sócios (nome, qualificação, desde) | socios | Receita Federal, via OpenCNPJ (grátis, consulta sob demanda) | — |
| Aviso "Sócio serve" / "Precisa de outro decisor" | socios | Perfil de busca da organização | `avaliarDecisor()`: cargos-alvo + porte de corte |
| "Nominal: é o e-mail de …" e etiqueta "dono do e-mail" | socios | E-mail da Receita × nomes dos sócios | `donoDoEmail()` |
| Coluna "Decisor" (campo em destaque: nome, cargo, "Sócio serve" / "Precisa de outro" / "Dono do e-mail") e contato do lead | socios ou digitação | Sócio sugerido ou escolhido; pode ser digitado à mão | O dono do e-mail nominal tem prioridade se estiver no cargo-alvo. Antes da consulta mostra "Ver decisor" (`DecisorCelula.tsx`) |

Na importação, o lead recebe o e-mail da Receita e o nome/cargo do decisor escolhido. O
domínio ainda **não** é gravado em `empresas.dominio`.

### Selo "Informação da Receita Federal"

Para administradores, cada dado que veio da Receita ganha um mini alerta. Ao passar o
mouse, ele avisa a procedência e o mês de referência do catálogo. Os sócios são marcados
como consultados via OpenCNPJ. Dados calculados por nós (qualidade do e-mail, site
provável, avisos de decisor) não levam o selo. Componente: `SeloReceita.tsx`. Quem decide
é o servidor, pelo `role` da sessão (`ehAdmin` na resposta da busca). É só exibição: os
dados em si são os mesmos para todos.

### Busca ordenada pela qualidade do dado

Desde a migration `0054`, a busca (`prospeccao_buscar_por_nota`) vem das melhores empresas
para as piores. Pedindo 10, vêm as 10 melhores. A nota é `faixa × 10 + telefone`:

| Faixa | E-mail |
|---|---|
| 5 | corporativo com domínio que confere com o nome |
| 4 | outro corporativo |
| 3 | caixa genérica |
| 2 | provedor pessoal |
| 1 | contador, typo ou sem e-mail |

A nota fica gravada em `catalogo_estabelecimentos` (`nota`, `qualidade_email`) e é calculada
por `notaDoCatalogo()` (`lib/prospeccao/notaCatalogo.ts`). A carga do catálogo grava a nota
sozinha. Para as linhas já existentes, ou quando a regra mudar, use
`npx tsx scripts/catalogo-rf-nota.ts`: é ensaio por padrão e só grava com `--confirmar`.
"E-mail válido obrigatório" exclui contador e typo. Sócio e e-mail nominal não entram
na nota, porque dependem da OpenCNPJ; eles seguem confirmados no "analisar".

Em produção a ordem é esta: aplicar a 0054, rodar o script com `--confirmar` e só então
fazer o deploy do código. Sem a 0054, a busca da tela quebra, e a carga do catálogo também
falha.

### Números de referência (banco de teste, 30/09/2026)

- Hotelaria em SP: 1.213 empresas, das quais 690 (57%) com e-mail válido.
- Em 400 empresas, 132 ganharam site provável e 38 conferem com o nome.
- Em 25 empresas consultadas na OpenCNPJ, 2 tinham e-mail nominal.

---

## 15d. Enriquecimento pago de decisor e e-mail — planejado, não implementado

Registrado em 30/09/2026. Crustdata, Google Places e Anymail **não existem no código**.
São pagos e ficam parados até haver decisão de contratar; não há integração, chave nem
flag para eles no repositório.

A parte grátis que decide quando cada um seria chamado já existe (§15c):

- `avaliarDecisor()`: se o resultado for "precisa de outro decisor", aí sim se chamaria a Crustdata.
- `donoDoEmail()`: se já houver e-mail nominal, não se chama a Anymail.
- `dominioDaEmpresa()`: é o domínio que as duas precisam.

### Cadeia prevista

A ideia é compor as fontes, sem trocar uma pela outra:

```
Nacional, sócio serve      OpenCNPJ → sócio adequado → (pula Crustdata) → Anymail
Nacional, empresa grande   OpenCNPJ → sócio não é o comprador → Crustdata People Search → Anymail
Internacional local        Google Places → domínio → Crustdata (owner) → Anymail
Internacional B2B          Crustdata Company Search → Crustdata People Search → Anymail
```

Exemplo: indústria com 800 funcionários. A OpenCNPJ traz um sócio que não compra, a Crustdata
acha o gerente de logística e a Anymail acha o e-mail dele.

### Regra de custo

Nunca chamar uma API paga se o dado já existe:

- Se a OpenCNPJ já resolveu o decisor, a Crustdata não é chamada.
- Se já existe um e-mail nominal válido, a Anymail não é chamada.
- Só se a Anymail não achar o e-mail é que se avalia um fallback.

### Decisões tomadas (30/09/2026)

- **Escopo inicial:** só a cadeia nacional. A internacional fica para depois.
- **Sócio "adequado":** valem os dois critérios juntos, cargos-alvo da organização e corte de
  porte. Uma empresa acima do corte vai para a Crustdata mesmo com sócio encontrado.
  Atenção: o catálogo RF só tem o porte da Receita (`micro`, `pequeno`, `demais`, além da
  marcação de MEI) e nenhum número de funcionários. Na prática o corte é `demais` e não
  "800 funcionários"; a contagem real de funcionários só viria da própria Crustdata.
- **Quando roda (recomendado):** sob demanda, empresa por empresa, no passo "analisar".
  O custo só aparece quando alguém abre uma empresa que lhe interessa, e o resultado passa
  por revisão humana antes de importar. Enriquecimento em lote fica para uma segunda fase,
  sempre com estimativa de custo e confirmação.
- **Chaves/planos e fallback da Anymail:** fora de foco por enquanto.

### Pontos em aberto para quando for implementar

- **Domínio da empresa.** Hoje sai do e-mail da Receita (§15c) e cobre cerca de 1/3 das
  empresas. Para o restante, as opções são busca da Crustdata por nome + cidade ou Places no Brasil.
- **Cache.** O resultado pago fica guardado por CNPJ/domínio, com origem e data, isolado por
  organização, para não cobrar duas vezes pela mesma empresa.
- **Fallback da Anymail** (adiado). Falta decidir se o lead fica com o e-mail genérico da RF,
  marcado como tal, ou sem e-mail e com revisão humana.

---

## 16. Scripts

`scripts/` contém utilitários que **aplicam migrations, escrevem no Supabase, inscrevem
leads e enviam mensagens de verdade**.

Antes de rodar qualquer um: inspecione o arquivo, prefira `dry-run` ou modo relatório, e
confirme a organização-alvo. Mutação contra banco conectado, flip de flag ou envio real
exigem autorização explícita.

Os de uso comum estão no `package.json`: `engine:cadencia-dry`, `engine:detectar`,
`workflows:tick-teste`, `import:hubspot`, `popular:responsavel`.

---

## 17. Material sensível — nunca versionar

```
.env.local            .claude/settings.local.json
hubspot_leads.csv     backups/
data/prospeccao/      lote-*.log
```

Artefatos criados ao montar o ambiente de teste (§15b) e que **não** devem ser
commitados como estão:

- `.env.local.producao-backup` — env de produção, com chaves reais
- `schema.sql` — sem dado nenhum, mas expõe a estrutura inteira. Só entra no repo se for
  como `db/migrations/0000_schema_base.sql`, por decisão do dono
- `supabase/` — pasta do CLI; já coberta pelo `.gitignore`

Não reproduza valores reais em log, diff ou resposta. Exemplo de env leva só placeholder.

---

## 18. Onde a verdade mora

| Assunto | Fonte |
|---|---|
| Comportamento atual | Código, migrations, testes, `package.json`, `vercel.json` |
| Next.js | `node_modules/next/dist/docs/` — nunca API lembrada de outra versão |
| Empresa × Contato | `docs/empresa-contato-transicao.md`, seção final |
| Motor | `lib/engine/README.md` é anterior a evoluções; confirme em `lib/engine/**` e testes |
| Specs de feature | `spec-*.md` registra entrega pontual — não é backlog nem prova de pendência |
| README raiz | Boilerplate do Create Next App. Não é documentação do projeto |
