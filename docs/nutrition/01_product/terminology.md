# AJ Fit Nutrition — Terminologia Canônica

## 1. Objetivo

Este documento define os termos oficiais usados na documentação, produto, código e comunicação da Nutrição do AJ Fit.

Sempre que possível, novas implementações devem reutilizar estes conceitos em vez de criar sinônimos técnicos diferentes para a mesma entidade.

## 2. Nome do módulo

### Nutrição

Nome oficial da funcionalidade no produto.

Preferir **Nutrição** em navegação, documentação e comunicação de alto nível.

Evitar usar “Dieta” como nome do módulo completo, embora a palavra possa aparecer em textos naturais de interface quando fizer sentido.

## 3. Plano alimentar

Conjunto estruturado de refeições e alimentos recomendados ao usuário para um determinado período.

Um plano alimentar contém:

- metas nutricionais associadas;
- refeições;
- alimentos e quantidades;
- alternativas/opções;
- versão;
- estado ativo/inativo.

O plano alimentar representa **recomendação**, não necessariamente o consumo real.

## 4. Plano ativo

Versão do plano alimentar atualmente utilizada como referência pelo usuário.

Somente uma versão deve ser considerada ativa por vez.

## 5. Versão do plano

Snapshot imutável de um plano alimentar em determinado momento.

Trocas, alterações ou restaurações relevantes devem preservar histórico em vez de sobrescrever silenciosamente versões anteriores.

## 6. Refeição planejada

Refeição presente no plano alimentar recomendado.

Exemplos:

- café da manhã;
- almoço;
- lanche;
- jantar.

O número e os nomes finais das refeições podem variar conforme o plano e o usuário.

## 7. Opção de refeição

Uma alternativa nutricionalmente válida para uma refeição planejada.

Na V1, uma refeição poderá possuir aproximadamente 2–3 opções equivalentes.

Uma opção não representa uma nova refeição do dia; representa uma alternativa para cumprir aquela mesma refeição planejada.

## 8. Alimento planejado

Alimento recomendado dentro de uma refeição do plano.

Possui quantidade/porção associada e referência a um item do catálogo nutricional.

## 9. Consumo realizado

Registro do que o usuário efetivamente declarou ter consumido.

O consumo realizado é independente do plano recomendado.

Ele pode ser:

- idêntico ao planejado;
- parcialmente diferente;
- completamente diferente.

## 10. Registro alimentar

Entrada persistida no diário alimentar representando um alimento e sua quantidade efetivamente consumida.

Não confundir com `Alimento planejado`.

## 11. Diário alimentar

Conjunto de registros alimentares do usuário organizados por dia e refeição.

O diário representa a realidade declarada pelo usuário, e não a recomendação do AJ Fit.

## 12. Meta nutricional

Objetivo quantitativo diário calculado pelo sistema.

Na V1, pode incluir:

- calorias;
- proteína;
- carboidratos;
- gorduras;
- fibras.

As regras que produzem essas metas pertencem ao Nutrition Engine.

## 13. Planejado

Valor derivado do plano alimentar ativo.

Exemplo:

- calorias planejadas;
- proteína planejada;
- refeição planejada.

## 14. Consumido

Valor derivado dos registros reais feitos pelo usuário.

Exemplo:

- calorias consumidas;
- proteína consumida.

## 15. Aderência

Métrica que representa o grau de alinhamento entre o comportamento alimentar registrado e o plano/metas definidos.

A definição matemática de aderência ainda será especificada posteriormente.

Aderência não deve ser apresentada como julgamento moral, punição ou “sucesso/falha” binário.

## 16. Substituição de alimento

Troca de um alimento planejado por outro candidato adequado, preservando o objetivo nutricional da refeição dentro das tolerâncias definidas pelo sistema.

## 17. Substituição de refeição

Troca do conjunto principal de alimentos de uma refeição por outra alternativa adequada à mesma função nutricional.

## 18. Edição de quantidade

Alteração manual da quantidade de um alimento planejado ou consumido.

A alteração em um registro consumido representa apenas o que o usuário declarou ter comido.

A alteração no plano recomendado pode exigir revalidação nutricional.

## 19. Favorito

Refeição ou opção marcada explicitamente pelo usuário como preferida.

Favoritos podem receber maior prioridade em sugestões futuras, mas não devem se tornar obrigatórios.

## 20. Preferência alimentar

Informação persistente usada para personalizar o plano.

Pode incluir:

- alimentos de que gosta;
- alimentos de que não gosta;
- alimentos habituais;
- preferências aprendidas por feedback.

## 21. Restrição alimentar

Condição que limita alimentos permitidos no plano.

Pode incluir:

- vegetarianismo;
- veganismo;
- intolerâncias;
- alergias.

Restrições de segurança têm prioridade sobre preferências.

## 22. Feedback alimentar

Resposta explícita do usuário sobre uma sugestão de alimento ou refeição.

Pode influenciar sugestões futuras.

Exemplo conceitual:

- gostou;
- não gostou;
- não quer mais essa opção.

A taxonomia final será definida posteriormente.

## 23. Nutrition Profile / Perfil nutricional

Conjunto consolidado de informações necessárias para gerar e personalizar a experiência de Nutrição.

Pode combinar:

- dados globais já existentes no AJ Fit;
- respostas específicas do questionário nutricional;
- preferências aprendidas;
- restrições.

O Perfil nutricional não deve duplicar dados corporais que já tenham uma fonte autoritativa no perfil principal.

## 24. Nutrition Engine / Motor nutricional

Camada determinística responsável por regras e cálculos nutricionais.

Não é sinônimo de IA.

Exemplos de responsabilidades futuras:

- metas energéticas;
- distribuição de macronutrientes;
- validações quantitativas;
- tolerâncias.

## 25. IA de geração

Componente de inteligência artificial usado em fluxos controlados para montar ou adaptar recomendações.

A IA não deve ser tratada como fonte autoritativa de dados nutricionais nem como única camada de segurança.

## 26. Safety gate

Regra determinística que avalia se o usuário pode ou não seguir para determinada funcionalidade nutricional automática.

Em caso de bloqueio:

- o plano não é gerado;
- o usuário recebe orientação apropriada.

## 27. Elegível

Usuário que passou pelos safety gates necessários para utilizar a geração automática da Nutrição.

## 28. Inelegível

Usuário bloqueado por regra de segurança para geração automática.

“Inelegível” é um estado técnico; a interface deve usar linguagem humana e apropriada.

## 29. Catálogo de alimentos

Base estruturada e autoritativa de alimentos usados pelo AJ Fit.

O catálogo fornece dados nutricionais e metadados necessários ao plano e ao diário.

A IA não substitui o catálogo.

## 30. Porção

Quantidade de alimento expressa em unidade reconhecida pelo sistema.

Pode ser representada, conforme catálogo e regras futuras, por:

- gramas;
- mililitros;
- unidade;
- medida caseira vinculada a uma conversão estruturada.

## 31. Suplemento

Item consumível registrado separadamente ou como alimento, conforme modelagem posterior.

Na V1, o suporte previsto começa com whey/proteína em pó e cadastro de suplemento próprio, com escopo final ainda pendente.

## 32. Progresso nutricional

Conjunto de métricas relacionadas à execução do plano e evolução do usuário.

Pode incluir:

- aderência;
- consumo vs. metas;
- evolução semanal;
- métricas corporais reutilizadas do AJ Fit.

## 33. Termos a evitar em documentação técnica

Evitar tratar como equivalentes:

- `plano alimentar` e `consumo realizado`;
- `refeição planejada` e `registro alimentar`;
- `Nutrition Engine` e `IA`;
- `preferência` e `restrição`;
- `aderência` e `obediência`;
- `recomendação` e `consumo`.

Essa separação conceitual é fundamental para o domínio da Nutrição.
