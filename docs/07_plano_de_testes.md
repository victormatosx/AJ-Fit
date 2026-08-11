# Plano de Testes

## 1. Objetivo deste documento

Definir a estratégia de testes do sistema.

Definir prioridades.

Definir critérios mínimos para publicação de novas versões.

Definir riscos que devem ser mitigados antes de liberar funcionalidades para usuários.

---

# 2. Objetivos dos testes

Os testes existem para garantir:

* estabilidade
* consistência
* integridade dos dados
* funcionamento offline
* funcionamento da assinatura
* experiência adequada ao usuário

---

# 3. Estratégia de testes

A primeira versão utiliza principalmente:

* testes manuais
* testes exploratórios
* testes internos

Participantes:

* equipe de desenvolvimento
* equipe do projeto
* grupo fechado de alunos

---

# 4. Ambientes

Ambientes previstos:

```txt
DEV
PROD
```

---

## DEV

Utilizado para:

* desenvolvimento
* validação inicial
* correções

---

## PROD

Utilizado por usuários finais.

---

# 5. Classificação de severidade

## Crítico

Problemas que impedem uso do sistema.

Exemplos:

* perda de dados
* falha de assinatura
* impossibilidade de login
* sincronização incorreta
* crash durante treino

---

## Alto

Problemas que prejudicam funcionalidades importantes.

Exemplos:

* treino incorreto
* falha de notificações
* erro de cálculo corporal

---

## Médio

Problemas que possuem solução alternativa.

---

## Baixo

Problemas visuais ou pequenos ajustes.

---

# 6. Prioridades de teste

Ordem de prioridade:

1. assinatura
2. funcionamento offline
3. sincronização
4. questionário
5. treino
6. evolução física

---

# 7. Testes de autenticação

Validar:

* cadastro
* login
* recuperação de senha
* login Google
* login Apple
* login com TOTP após e-mail/senha, Google e Apple
* código TOTP incorreto com retry na mesma tentativa
* cancelamento e expiração do challenge TOTP
* múltiplos fatores TOTP e hints não suportados
* retorno ao Dashboard (nunca Quiz) para usuário existente com questionário
* persistência de sessão
* troca de dispositivo

---

# 8. Testes de assinatura

Validar:

* início do teste gratuito
* cobrança após 7 dias
* cancelamento
* restauração de compra
* renovação automática
* perda de acesso
* recuperação de acesso

---

## Critério obrigatório

Nenhum usuário pode:

* perder acesso indevidamente
* receber acesso sem autorização válida

---

# 9. Testes do questionário

Validar:

* preenchimento completo
* salvamento local
* retomada após fechamento do aplicativo
* alteração de respostas
* seleção correta de treino

---

# 10. Testes de treino

Validar:

* exibição do treino
* exibição dos exercícios
* substituições disponíveis
* troca de treino
* atualização automática

---

# 11. Testes de execução

Validar:

* início do treino
* conclusão do treino
* registro de séries
* registro de cargas
* cronômetro de descanso
* finalização correta

---

# 12. Testes offline

Validar:

* abertura do treino sem internet
* execução sem internet
* registro de cargas sem internet
* histórico sem internet

---

## Cenários obrigatórios

* modo avião
* internet instável
* perda de conexão durante treino

---

# 13. Testes de sincronização

Validar:

* sincronização após retorno da internet
* sincronização após vários dias offline
* ausência de duplicação
* ausência de perda de dados

---

## Cenário crítico

O sistema deve sincronizar corretamente mesmo após:

```txt
30 dias offline
```

---

# 14. Testes de troca de dispositivo

Validar:

* Android para Android
* iPhone para iPhone
* Android para iPhone
* iPhone para Android

---

## Resultado esperado

Todos os dados devem permanecer consistentes.

---

# 15. Testes de evolução física

Validar:

* cadastro de peso
* cadastro de medidas
* cálculo de percentual de gordura
* fotos de progresso

---

# 16. Testes da calculadora de BF

Validar:

* Jackson & Pollock 3 dobras
* Jackson & Pollock 7 dobras

---

## Resultado esperado

O cálculo deve permanecer consistente para entradas iguais.

---

# 17. Testes de fotos

Validar:

* upload
* armazenamento
* recuperação
* comparação visual

---

## Limite

Validar:

```txt
4 fotos por semana
```

---

# 18. Testes de vídeos

Validar:

* carregamento
* reprodução
* funcionamento offline quando aplicável

---

## Regra

Falha no vídeo não deve impedir treino.

---

# 19. Testes de notificações

Validar:

* lembretes
* notificações de retorno
* notificações de evolução

---

# 20. Testes de atualização automática de treino

Validar:

* geração da nova versão
* manutenção do histórico
* ativação correta
* preservação da lógica do treino

---

# 21. Testes de desempenho

Validar:

* tempo de abertura
* tempo de carregamento do treino
* tempo de sincronização

---

# 22. Testes de interface

Validar:

* estados de carregamento
* estados vazios
* mensagens de erro
* responsividade

---

# 23. Critérios mínimos para publicação

Uma versão só pode ser publicada quando:

* não existirem bugs críticos conhecidos
* não existirem perdas de dados
* assinatura estiver funcionando corretamente
* sincronização estiver validada
* funcionamento offline estiver validado

---

# 24. Métricas recomendadas

Monitorar:

* taxa de crash
* retenção
* conversão de assinatura
* uso do aplicativo
* falhas de sincronização

---

# 25. Pedido para o Agente QA

Definir:

* casos de teste detalhados
* cenários de regressão
* matriz de dispositivos
* checklists de publicação
* plano de testes exploratórios

Respeitando todas as regras deste documento.
