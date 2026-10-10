# C1 — Matriz de licença, cache e armazenamento

| Fonte | Pode armazenar? | Pode cachear? | Pode redistribuir? | Atribuição? | Share-alike? | Custo | Risco |
|---|---|---|---|---|---|---|---|
| TACO | Sim | Sim | Sim (domínio público de fato) | Recomendada, não obrigatória | Não | Zero | Baixo |
| TBCA | **Requer revisão jurídica** — termos proíbem reprodução/comercialização sem permissão | Sim, para uso interno não comercial | **Não** sem acordo com USP/FoRC | Sim, obrigatória (citação específica) | Não declarado | Zero (uso pontual) / **requer acordo para uso comercial em produto pago** | **Alto** sem permissão formal |
| FatSecret (Basic/Premier Free) | Conforme política de cache da FatSecret (requer confirmação contratual) | Sim, com atribuição | Não (uso via API, não redistribuição de dataset) | Obrigatória | Não | Grátis, mas **só dataset EUA** | Baixo tecnicamente, mas não resolve BR |
| FatSecret (Premier) | Sim, conforme contrato | Sim | Não (uso via API) | Opcional (plano sem atribuição disponível) | Não | **Pago, sob consulta, requer mercado BR** | Baixo técnico / médio comercial (custo recorrente) |
| Open Food Facts | Sim | Sim (recomendado via exports JSONL, não polling da API de busca) | Sim, mas **com obrigação de share-alike** se combinado com outra base | Obrigatória, com link para OFF e para a licença | **Sim** — base resultante deve ser liberada como dado aberto se combinada | Zero | Médio — risco de licença se fundido sem isolamento do banco proprietário |
| USDA (fallback) | Sim | Sim | Sim (domínio público) | Não obrigatória | Não | Zero | Baixo (mas não cobre BR) |
| Edamam (fallback) | Conforme contrato | Conforme contrato | Não | Obrigatória | Não | Pago (US$49–999+/mês) | Baixo técnico / alto custo |

## Notas importantes

1. **TBCA é a única fonte com risco jurídico real identificado nesta fase.** Antes de qualquer
   importação além de consulta pontual/manual, é necessário contato formal com
   `tbca.contato@usp.br` para negociar uso comercial. Até lá, tratar TBCA como **não disponível
   para importação em massa**.
2. **Open Food Facts exige isolamento arquitetural**, não apenas um campo de atribuição: para
   evitar acionar a obrigação de share-alike sobre o banco proprietário inteiro, os dados OFF
   devem viver em uma coleção/estrutura claramente separada, com proveniência explícita, e a UI
   deve atribuir claramente por item exibido (não só num rodapé genérico "powered by").
3. **FatSecret é a única fonte paga necessária para cobertura Brasil completa** — Basic/Premier
   Free gratuitos só cobrem EUA. Qualquer avaliação de custo real exige contato comercial direto
   com a FatSecret (fora do escopo de uma pesquisa técnica autônoma).
4. Nenhuma das fontes permite hoje "misturar e redistribuir livremente" sem alguma condição —
   mesmo TACO (atribuição recomendada) e USDA (sem condição, mas sem valor para BR).
