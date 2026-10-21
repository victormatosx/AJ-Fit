# Estratégia de limpeza histórica — sem execução

A aplicação atual ignora os campos retirados. Nenhuma limpeza é necessária para liberar geração normal ou troca manual. A remoção física dos dados remotos exige autorização específica após um inventário com contagens e caminhos exatos.

## Escopo candidato

| Local | Campos candidatos |
| --- | --- |
| `users/{uid}/questionnaires/{id}` | `answers.limits`, `answers.limitationImpact`; retirar somente o valor `musculoskeletal_limitation` de `answers.specialConditions` |
| `users/{uid}/programInstances/{id}` e snapshots equivalentes encontrados no inventário | `prescriptionInputSnapshot.inputs.limits`, `limitationImpact` e o valor removido de `specialConditions` |
| `users/{uid}/workoutPrograms/{id}` e planos de `pendingEvolutions` | `limitationDatasetVersion`, `limitationDatasetHash`, `versions.limitationResolver`, traces/decisões/omissões exclusivamente clínicos |
| `exercises/{id}` | `limitationProfile`, `substitution.limitationVariantIds` |
| `limitationDatasetState` e `limitationDatasetVersions` | Conteúdo auxiliar exclusivamente clínico, somente depois de confirmar ausência de consumidores remotos |
| `users/{uid}/workoutExecutions/{id}` | `substitutionPolicySnapshot`, com a restrição abaixo |

Os nomes efetivamente presentes devem ser descobertos por leitura; esta tabela não autoriza varredura com gravação nem presume que todo caminho exista.

## Proteções necessárias

1. Fazer inventário somente de leitura, com contagem por coleção/campo, presença de sessões em andamento e exemplos de caminhos anonimizados. Não exportar dados pessoais para o repositório.
2. Separar registros imutáveis/selados de documentos auxiliares. Confirmar como hashes e snapshots são conferidos por consumidores remotos antes de remover campos. Não recalcular ou renomear `programId`, `planId`, `contentIdentity`, `prescriptionIdentity`, `snapshotId`, ciclos ou referências do histórico.
3. Produzir um plano de alterações de campos, com diff e backup protegido. Não excluir documentos de usuários, treinos, execuções, históricos, cargas, avaliações ou preferências manuais.
4. Excluir do lote qualquer execução `IN_PROGRESS` com `substitutionPolicySnapshot`. A compatibilidade de finalização usa a presença desse metadado para conservar uma troca já materializada; limpá-lo prematuramente poderia impedir a continuidade de uma troca histórica que não pertence às alternativas atuais. Depois de terminalizada, conferir consumidores antes de limpar o campo, preservando o exercício e seu marcador de troca.
5. Não substituir retrospectivamente exercícios nem reconstruir planos antigos para corresponder ao template novo. O histórico deve continuar registrando o que foi prescrito/executado.
6. Submeter as contagens, caminhos e diffs para autorização separada. Só então implementar/executar uma ferramenta de limpeza com modo de simulação padrão, checkpoint, precondição de versão do documento, lotes pequenos, idempotência e validação posterior.
7. Comparar antes/depois: mesmos documentos e referências, mesmas sessões/séries/repetições/cargas, mesmas preferências; apenas os campos autorizados desapareceram. Preservar backup e relatório conforme a política de retenção aplicável.

Os recibos e backups locais de antigas publicações são evidência inerte para esta delimitação. Não são fonte de configuração e não devem ser republicados. Não foi criado nem executado um script que possa alterar produção nesta fase.
