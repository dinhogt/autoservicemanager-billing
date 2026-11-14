# language: pt
Funcionalidade: Cobrança de uma ordem de serviço
  Como sistema de oficina
  Quero emitir e confirmar cobranças
  Para concluir a ordem com consistência financeira

  Cenário: Criar orçamento e solicitar PIX
    Dado um comando de orçamento válido ainda não processado
    Quando o orçamento é criado e o pagamento solicitado
    Então o PIX é criado com chave de idempotência do billing
    E os eventos de orçamento e pagamento são publicados

  Cenário: Repetir webhook
    Dado um webhook de pagamento já processado
    Quando a mesma identificação de requisição é recebida
    Então o estado financeiro não é alterado novamente

  Cenário: Compensar falha após aprovação
    Dado que o Mercado Pago confirmou o pagamento
    E o DynamoDB está indisponível para persistir a aprovação
    Quando o webhook é processado
    Então um refund compensatório é solicitado
    E a falha permanece visível para retentativa operacional
