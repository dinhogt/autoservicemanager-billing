# Auto Service Manager — Billing

Microsserviço independente da Entrega 4 para orçamento, pagamento PIX e estorno. Implementado em NestJS/TypeScript com arquitetura hexagonal, persistência DynamoDB, comandos SQS, eventos SNS e Mercado Pago atrás de uma porta HTTP.

## Arquitetura

- `src/domain`: regras e transições de estado sem dependências de framework.
- `src/application`: casos de uso e portas.
- `src/infrastructure`: adapters DynamoDB, SQS, SNS, Mercado Pago e assinatura de webhook.
- `src/presentation`: API HTTP, webhook, health e mapeamento de erros.
- `src/common`: correlação assíncrona e logs JSON.

Fluxo principal:

1. `CreateBudget` chega por SQS ou `POST /billing/budgets`.
2. O orçamento é salvo de forma idempotente no DynamoDB e `BudgetCreated` é publicado no SNS.
3. `RequestPayment` cria PIX no Mercado Pago usando o billing ID como chave de idempotência.
4. O webhook valida `x-signature`, deduplica `x-request-id`, consulta o pagamento e publica o resultado.
5. Se um pagamento aprovado não puder ser persistido, o caso de uso solicita refund compensatório e propaga a falha.

## Requisitos e execução

- Node.js 22
- Yarn Classic 1.x
- Credenciais AWS via runtime (IRSA no Kubernetes, perfil/variáveis no desenvolvimento)

```bash
cp .env.example .env
yarn install --frozen-lockfile
yarn start:dev
```

Swagger/OpenAPI: `http://localhost:3000/docs`.

Validação:

```bash
yarn lint
yarn test:cov
yarn build
yarn security
```

O Jest exige 90% em statements, lines, branches e functions. As únicas exclusões de cobertura são bootstrap, módulos Nest e DTOs convencionais; domínio e casos de uso permanecem integralmente medidos.

Evidência consolidada da Fase 4 (LCOV/HTML): no repositório `autoservicemanager-app`, pasta `docs/qa/coverage-artifacts/billing/` e relatório `docs/qa/coverage-evidence-fase4.md`.

## Contratos

Comandos aceitos pela fila:

```json
{"type":"CreateBudget","commandId":"01J...","orderId":"OS-1","customerEmail":"client@example.com","amount":199.9,"description":"Revisão"}
{"type":"RequestPayment","commandId":"01J...","billingId":"01J..."}
{"type":"RefundPayment","commandId":"01J...","billingId":"01J..."}
```

Eventos SNS: `BudgetCreated`, `PaymentRequested`, `PaymentApproved`, `PaymentRejected` e `PaymentRefunded`. Cada envelope contém `type`, `aggregateId`, `occurredAt` e `payload`.

### Webhook Mercado Pago

Endpoint: `POST /billing/webhooks/mercado-pago`.

A validação segue o manifesto `id:{data.id};request-id:{x-request-id};ts:{ts};`, HMAC-SHA256 com `MERCADO_PAGO_WEBHOOK_SECRET`, comparado em tempo constante ao campo `v1` de `x-signature`. `WEBHOOK_SIGNATURE_ENABLED=false` existe apenas para ambientes locais controlados.

O `x-request-id` é gravado condicionalmente no DynamoDB com TTL de 7 dias. Duplicatas retornam sem executar novamente o caso de uso.

## DynamoDB

Tabela single-table:

- Partition key `PK` (String)
- Sort key `SK` (String)
- GSI `GSI1`: partition key `GSI1PK` (String), usado por `PAYMENT#{paymentId}`
- TTL habilitado no atributo `expiresAt`
- billing: `PK=BILLING#{id}`, `SK=BILLING`
- deduplicação: `PK=WEBHOOK#{requestId}`, `SK=WEBHOOK`

Concessões IAM mínimas: `dynamodb:GetItem|PutItem|UpdateItem|Query` na tabela/índice, `sqs:ReceiveMessage|DeleteMessage|GetQueueAttributes` na fila e `sns:Publish` no tópico.

## Segurança e operação

Segredos nunca são versionados. O manifesto referencia `billing-secrets`, que deve ser criado em runtime por External Secrets/Secrets Manager ou processo equivalente. O pod é non-root, sem capabilities, com filesystem somente leitura, probes, requests/limits, HPA e PDB.

Logs são JSON e incluem `correlationId`: header `x-correlation-id` no HTTP e `commandId` no SQS. Health checks:

- `GET /health/live`
- `GET /health/ready`

O workflow executa lint, testes/cobertura, build, audit de dependências, Gitleaks, Trivy e SonarQube quando `SONAR_TOKEN` estiver configurado.

## Branches

Padrão do projeto (igual aos demais repos):

- `develop` — homologação / trabalho diário
- `master` — produção (somente via PR)

## Deploy

O ServiceAccount `autoservice-billing` corresponde ao subject IRSA provisionado
pelo Terraform. Substitua `ACCOUNT_ID`, a imagem e o ARN do IRSA em
`k8s/billing.yaml`; provisione `billing-secrets`; então:

```bash
kubectl apply -f k8s/billing.yaml
kubectl rollout status deployment/billing -n autoservice --timeout=180s
```

O workflow publica a imagem com a tag imutável do commit (`github.sha`) e só faz
CD quando `ENABLE_OIDC_CD=true`. Se o rollout falhar, ele executa
`kubectl rollout undo deployment/billing -n autoservice`. Para rollback manual,
execute o mesmo comando e confirme com `kubectl rollout status`.
