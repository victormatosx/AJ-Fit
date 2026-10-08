# AJ Fit Nutrition — Matriz de Funcionalidades

## 1. Objetivo

Esta matriz define o que pertence à V1, o que está fora da V1 e o que ainda depende de decisão.

| Área | Funcionalidade | V1 | Observações |
|---|---|---:|---|
| Acesso | Disponível para usuário em free trial | Sim | Desde que o acesso geral ao AJ Fit esteja válido |
| Acesso | Disponível para assinante pagante | Sim | — |
| Acesso | Plano gratuito independente | Não | Não existe acesso ao app sem assinatura válida |
| Navegação | Área própria de Nutrição | Sim | Módulo com navegação própria |
| Geração | Plano alimentar gerado com IA | Sim | IA nos bastidores |
| Geração | Refeições específicas | Sim | Não apenas metas de macros |
| Geração | 2–3 opções por refeição | Sim | Opções equivalentes |
| Geração | Emagrecimento | Sim | Regras no Nutrition Engine |
| Geração | Ganho de massa | Sim | Regras no Nutrition Engine |
| Geração | Manutenção | Sim | Regras no Nutrition Engine |
| Geração | Definição/composição corporal | Sim | Regras no Nutrition Engine |
| Preferências | Alimentos que gosta | Sim | Considerados na geração |
| Preferências | Alimentos que não gosta | Sim | Considerados na geração |
| Preferências | Alimentos que já costuma consumir | Sim | Considerados quando possível |
| Preferências | Vegetarianismo | Sim | Restrição obrigatória |
| Preferências | Veganismo | Sim | Restrição obrigatória |
| Preferências | Intolerâncias | Sim | Restrição obrigatória conforme regras de segurança |
| Preferências | Alergias | Sim | Restrição crítica |
| Preferências | Quantidade de refeições | Sim | Definida pelo usuário dentro de limites futuros |
| Preferências | Horários obrigatórios | Não definido | Não foi definido como requisito obrigatório da V1 |
| Preferências | Orçamento | Não | Fora das preferências obrigatórias definidas para a V1 |
| Preferências | Tempo para cozinhar | Não | Fora das preferências obrigatórias definidas para a V1 |
| Preferências | Restrições religiosas | Não | Fora das preferências obrigatórias definidas para a V1 |
| Diário | Registrar refeições consumidas | Sim | Diário alimentar completo |
| Diário | Registrar alimento diferente do plano | Sim | Deve ser permitido sem bloqueio |
| Diário | Registrar quantidade consumida | Sim | — |
| Diário | Ação rápida “consumi conforme planejado” | Sim | Recomendado como parte da experiência principal |
| Diário | Comparar planejado vs. consumido | Sim | Elemento central do produto |
| Diário | Calorias consumidas | Sim | — |
| Diário | Proteínas | Sim | — |
| Diário | Carboidratos | Sim | — |
| Diário | Gorduras | Sim | — |
| Diário | Fibras | Sim | — |
| Diário | Micronutrientes completos | Não | Fora da V1 |
| Edição | Trocar alimento | Sim | Ajuste parcial |
| Edição | Trocar refeição inteira | Sim | Mostrar opções antes de confirmar |
| Edição | Editar quantidade do plano | Sim | Sujeito a regras nutricionais futuras |
| Edição | Regenerar dieta inteira livremente | Não | Não faz parte do fluxo padrão |
| Feedback | Informar que não gostou | Sim | — |
| Feedback | Perguntar motivo | Sim | Deve alimentar personalização futura |
| Feedback | Persistir preferência aprendida | Sim | — |
| Favoritos | Favoritar refeição | Sim | — |
| Histórico | Guardar versões anteriores | Sim | Necessário para restauração |
| Histórico | Restaurar plano antigo | Sim | Preservando histórico |
| Aderência | Aderência diária | Sim | Fórmula ainda será definida |
| Aderência | Aderência semanal | Sim | — |
| Progresso | Exibir métricas corporais | Sim | Reutilizar sistema existente do AJ Fit |
| Progresso | Cadastrar peso em sistema separado da Nutrição | Não | Evitar fonte duplicada |
| Ajustes | Ajuste automático com base em progresso | Não | Fora da V1 |
| Ajustes | Revisão automática semanal | Não | Fora da V1 |
| Ajustes | Revisão automática mensal | Não | Fora da V1 |
| Treino | Dieta diferente em dia de treino | Não | Fora da V1 |
| Treino | Dieta diferente em dia de descanso | Não | Fora da V1 |
| Treino | Estratégia automática pré/pós-treino | Não | Fora da V1 |
| IA | Chat nutricional | Não | Fora da V1 |
| IA | IA explicitamente apresentada como personagem | Não | IA deve ficar nos bastidores |
| IA | Substituições geradas/assistidas por IA | Sim | Dentro de fluxos controlados |
| Safety | Bloqueio de públicos não elegíveis | Sim | Lista final ainda pendente |
| Safety | Gerar plano “conservador” para caso bloqueado | Não | Deve interromper geração |
| Safety | Orientar acompanhamento profissional | Sim | Em casos bloqueados |
| Mercado | Prioridade para alimentos brasileiros | Sim | Brasil primeiro |
| Idiomas | Português do Brasil | Sim | — |
| Idiomas | Inglês | Sim | Desde o início |
| Idiomas | Espanhol | Sim | Desde o início |
| Suplementos | Whey/proteína em pó | Sim | Escopo mínimo |
| Suplementos | Cadastro de suplemento próprio | Sim | Escopo exato ainda pendente |
| Suplementos | Catálogo amplo de suplementos | Não | Fora da V1 |
| Captura | Reconhecimento por foto | Não | Fora da V1 |
| Captura | Código de barras | Não | Fora da V1 |
| Conteúdo | Receitas completas | Não | V1 usa alimentos + quantidades |
| Conteúdo | Lista de compras | Não | Fora da V1 |
| Integrações | Apple Health | Não | Fora da V1 |
| Integrações | Health Connect | Não | Fora da V1 |

## 2. Prioridades funcionais da V1

### P0 — Obrigatório para lançamento

- elegibilidade e safety gates;
- questionário nutricional complementar;
- geração inicial do plano;
- plano com refeições e opções;
- diário alimentar;
- registro de alimentos consumidos;
- comparação planejado vs. consumido;
- calorias + macros + fibras;
- substituição de alimento;
- substituição de refeição;
- edição de quantidades;
- aderência diária/semanal;
- métricas de evolução reutilizando dados AJ Fit;
- histórico/versionamento de planos;
- restauração de plano anterior;
- PT-BR, inglês e espanhol.

### P1 — Importante na V1, mas posterior ao caminho crítico

- favoritos;
- persistência de preferências aprendidas;
- múltiplas opções equivalentes por refeição;
- suporte mínimo a whey/proteína em pó;
- cadastro de suplemento próprio.

### Fora da V1

- foto de alimentos;
- barcode;
- chat com IA;
- receitas completas;
- lista de compras;
- micronutrientes completos;
- ajustes automáticos;
- diferenciação treino/descanso;
- integração com plataformas de saúde.

## 3. Decisões ainda pendentes

1. lista exata de públicos/condições bloqueadas pelos safety gates;
2. mínimo e máximo de refeições por dia;
3. se horários de refeição entram como dado obrigatório ou opcional;
4. escopo exato de “suplemento próprio”;
5. critérios e fórmula de aderência;
6. limites de edição manual de quantidade antes de o plano precisar ser revalidado;
7. comportamento de preferências persistentes e tela para revisão pelo usuário.
