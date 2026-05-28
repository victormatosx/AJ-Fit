# Requisitos e Regras de Negócio

## 1. Objetivo deste documento

Definir:

* requisitos funcionais
* requisitos não funcionais
* regras de negócio
* restrições operacionais
* critérios de aceite

Este documento é a fonte principal de comportamento esperado do sistema.

---

# 2. Requisitos funcionais

## 2.1 Cadastro e autenticação

O sistema deve permitir:

* criação de conta
* login
* recuperação de senha
* autenticação persistente

O acesso ao aplicativo depende de autenticação válida.

---

## 2.2 Assinatura

O sistema deve:

* oferecer 7 dias de teste gratuito
* exigir método de pagamento antes da liberação
* bloquear acesso após cancelamento ou inadimplência

Após perda de acesso:

* dados do usuário permanecem armazenados
* funcionalidades ficam limitadas

---

## 2.3 Onboarding

O sistema deve possuir questionário inicial.

O questionário deve coletar informações relevantes para seleção de treino.

Critérios inicialmente considerados:

* limitações
* sexo
* frequência semanal
* experiência
* idade

A lógica exata de seleção será definida em documentação específica.

---

## 2.4 Seleção de treino

O sistema deve selecionar automaticamente um treino pré-definido.

O sistema não gera treinos livres na versão inicial.

O treino deve respeitar:

* perfil do usuário
* frequência semanal
* limitações
* experiência

---

## 2.5 Tipos de fase de treino

Cada tipo de treino deve possuir duas fases principais:

* treino adaptativo
* treino avançado

O treino adaptativo é destinado a usuários iniciantes.

O treino avançado é destinado aos demais usuários.

A definição entre adaptativo e avançado depende da resposta de experiência no questionário.

---

## 2.6 Atualização periódica de treino

O sistema deve atualizar a estrutura apresentada ao usuário aproximadamente a cada 60 dias.

A variação exata de dias pode ser ajustada para evitar percepção de ciclo fixo.

A atualização não significa geração livre de novo treino.

A atualização deve ocorrer por variação controlada.

A variação controlada pode:

* trocar exercícios por substituições pré-definidas
* alterar a ordem dos exercícios
* preservar a lógica original do treino
* preservar o estímulo principal do treino

---

## 2.7 Execução de treino

O usuário deve conseguir:

* visualizar treino
* iniciar treino
* concluir treino
* registrar execução
* registrar cargas
* usar cronômetro de descanso entre séries

O fluxo deve possuir baixa fricção.

---

## 2.8 Substituição de exercícios

Cada exercício pode possuir substituições pré-definidas.

As substituições devem:

* manter estímulo semelhante
* trabalhar o mesmo grupo muscular
* preservar lógica do treino

O usuário não pode trocar exercícios livremente fora das substituições disponíveis.

---

## 2.9 Histórico

O sistema deve registrar:

* frequência de treino
* exercícios executados
* cargas registradas manualmente
* evolução física
* medidas corporais
* fotos de progresso

---

## 2.10 Calculadora de dobras subcutâneas

O sistema deve permitir que o usuário insira medidas de dobras subcutâneas.

O sistema deve calcular automaticamente o percentual de gordura corporal estimado.

O cálculo deve ser apresentado como estimativa.

O método de cálculo utilizado deve ser definido em documentação específica.

---

## 2.11 Funcionamento offline

O sistema deve funcionar sem conexão ativa.

O usuário deve conseguir:

* visualizar treino
* executar treino
* registrar progresso

Os dados devem sincronizar automaticamente quando houver internet.

---

## 2.12 Notificações

O sistema deve permitir envio de notificações de:

* lembrete de treino
* retorno ao aplicativo
* continuidade de uso

---

## 2.13 Vídeos de execução

Cada exercício deve possuir vídeo demonstrativo quando disponível.

Os vídeos devem auxiliar execução correta do movimento.

---

## 2.14 Solicitação de novo treino

O usuário deve poder solicitar alteração estrutural de treino.

A alteração não deve ocorrer livremente pelo usuário.

A solicitação deve passar pela lógica controlada do sistema.

---

# 3. Requisitos não funcionais

## 3.1 Performance

O aplicativo deve iniciar rapidamente.

A execução do treino deve ocorrer sem travamentos perceptíveis.

---

## 3.2 Simplicidade

O sistema deve minimizar:

* excesso de telas
* excesso de configurações
* excesso de decisões

---

## 3.3 Consistência

O comportamento do sistema deve permanecer previsível entre versões.

---

## 3.4 Escalabilidade

A arquitetura deve suportar:

* crescimento de usuários
* aumento de treinos
* evolução futura da lógica de personalização

---

## 3.5 Offline first

Offline é requisito obrigatório.

O sistema não pode depender de conexão constante para funcionamento principal.

---

## 3.6 Segurança

As regras de segurança serão definidas em documento específico.

Documento relacionado:

* `12_seguranca_geral_do_app.md`

Este documento deve cobrir:

* autenticação
* autorização
* proteção de dados
* armazenamento local
* sincronização
* fotos do usuário
* dados corporais
* assinatura
* logs
* permissões

---

## 3.7 Sincronização

O sistema deve evitar:

* perda de dados
* duplicidade
* inconsistência entre dispositivos

---

## 3.8 Experiência premium

A interface deve transmitir:

* clareza
* velocidade
* simplicidade
* organização

---

# 4. Regras de negócio

## 4.1 Estrutura dos treinos

Treinos são pré-definidos.

A IA não cria treinos livres na versão inicial.

---

## 4.2 Controle de edição

O usuário não possui liberdade total de edição do treino.

As alterações permitidas são:

* substituições pré-definidas
* solicitação de novo treino
* variação controlada feita pelo sistema

---

## 4.3 Controle de carga

O sistema não define carga automaticamente.

O usuário registra cargas manualmente.

As cargas servem para acompanhamento de evolução.

---

## 4.4 Progressão contínua

O sistema não reinicia jornadas.

O usuário evolui continuamente.

---

## 4.5 Assinatura obrigatória

O acesso completo depende de assinatura ativa.

---

## 4.6 Modo limitado

Sem assinatura:

* treino fica bloqueado
* funcionalidades ficam limitadas
* parte do histórico permanece acessível

---

## 4.7 Critério de substituição

Uma substituição válida deve:

* manter padrão de estímulo semelhante
* respeitar objetivo do exercício original
* preservar coerência do treino

---

## 4.8 Regra de atualização de treino

A atualização periódica deve preservar coerência do treino.

O sistema não deve criar novo treino do zero.

O sistema deve variar:

* substituições
* ordem dos exercícios
* apresentação do treino

A variação deve gerar percepção de novidade sem comprometer a lógica do programa.

---

## 4.9 Regra de fases

Usuários iniciantes devem receber treino adaptativo.

Usuários não iniciantes devem receber treino avançado.

Cada tipo de treino possui apenas:

* uma fase adaptativa
* uma fase avançada

---

## 4.10 Calculadora de percentual de gordura

A calculadora de dobras subcutâneas deve gerar estimativa de percentual de gordura.

O resultado não deve ser apresentado como diagnóstico médico.

O sistema deve informar que o cálculo depende da precisão das medidas inseridas.

---

# 5. Casos de uso prioritários

Prioridade máxima:

1. onboarding
2. seleção de treino
3. execução de treino
4. funcionamento offline
5. sincronização
6. assinatura
7. histórico
8. substituição de exercícios
9. atualização periódica de treino
10. notificações
11. calculadora de dobras subcutâneas

---

# 6. Dependências críticas

Dependências principais:

* sincronização offline
* sistema de autenticação
* sistema de assinatura
* armazenamento local
* banco de dados estruturado
* catálogo de exercícios
* catálogo de substituições
* lógica de seleção de treino
* lógica de variação controlada
* método de cálculo de dobras subcutâneas
* documento de segurança geral

---

# 7. Critérios de aceite

## 7.1 Onboarding

Aprovado quando:

* usuário consegue concluir questionário
* sistema seleciona treino válido
* fluxo ocorre sem erro

---

## 7.2 Execução de treino

Aprovado quando:

* treino inicia corretamente
* exercícios são registrados
* cargas podem ser registradas
* cronômetro de descanso funciona
* fluxo permanece simples

---

## 7.3 Offline

Aprovado quando:

* treino funciona sem internet
* sincronização ocorre posteriormente
* não existe perda de dados

---

## 7.4 Histórico

Aprovado quando:

* registros permanecem consistentes
* evolução pode ser consultada
* dados persistem corretamente

---

## 7.5 Substituições

Aprovado quando:

* usuário consegue trocar exercício por alternativa válida
* lógica do treino permanece coerente

---

## 7.6 Atualização periódica

Aprovado quando:

* o treino é atualizado dentro da janela definida
* a atualização usa apenas variação controlada
* o treino mantém coerência
* o usuário percebe mudança na experiência

---

## 7.7 Calculadora de dobras

Aprovado quando:

* usuário consegue inserir medidas
* sistema calcula percentual de gordura estimado
* resultado é salvo no histórico
* resultado é apresentado como estimativa

---

# 8. Restrições do sistema

O sistema não deve:

* gerar complexidade desnecessária
* permitir edição irrestrita de treino
* depender de internet constante
* criar excesso de customização
* transformar experiência em sistema técnico complexo
* apresentar estimativas corporais como diagnóstico médico
* prometer geração livre de novo treino na versão inicial

---

# 9. Documentos específicos necessários

Devem existir documentos próprios para:

* `11_logica_de_selecao_de_treinos.md`
* `12_seguranca_geral_do_app.md`
* `13_logica_de_variacao_de_treinos.md`
* `14_calculadora_de_dobras_subcutaneas.md`

---

# 10. Pedido para o Agente Arquiteto

Analise estes requisitos.

Identifique:

* inconsistências
* ambiguidades
* riscos técnicos
* riscos operacionais
* lacunas de modelagem
* possíveis simplificações

Aponte requisitos que precisam de definição adicional antes da implementação.