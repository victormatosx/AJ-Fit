# Nutrition — Legal Pre-launch Checklist

**Isto é uma análise de engenharia/compliance para orientar revisão
humana — NÃO é parecer jurídico definitivo.** Nenhum item marcado como
"requires legal review" foi resolvido aqui. Nenhuma aprovação jurídica foi
inventada ou presumida.

Pesquisa externa realizada em 2026-10-08 via busca na web, priorizando fontes
oficiais (planalto.gov.br, cfn.org.br, crn*.org.br, gov.br/anpd). Fontes
secundárias (blogs, imprensa) usadas apenas para localizar/contextualizar a
fonte primária, nunca como autoridade final.

---

## 1. Confirmed in code

| Item | Evidência |
|---|---|
| Gravidez/amamentação bloqueiam geração, revalidado em toda chamada (request, worker, retry) | `functions/src/nutrition/generation/context.ts:75-76`, chamado em `request.ts`, `worker.ts`, `mealAlternativeRequest.ts` |
| Idade mínima 18 anos aplicada tanto no produto geral (`PROFILE_MIN_AGE=18`, `src/lib/userProfileValidation.ts:6`) quanto no Nutrition Engine (`ageYears < 18`, `context.ts:85`) | Consistente entre as duas camadas |
| Nenhum dado de identificação direta (uid, email, nome) é enviado à OpenAI | `functions/src/nutrition/ai/prompt.ts`, `provider.ts:85` (`store:false`, sem campo `user`) |
| Nenhum plano é persistido sem passar pelo validator determinístico pós-IA | `functions/src/nutrition/generation/worker.ts:111` só executa após `validateAndBuildPlan` |
| Feature flags falham fechado (config ausente/inválida = desligado) | `rolloutCore.ts`, `rollout.ts`, `useNutritionEnabled.ts` |
| Logs de Nutrição não contêm prompt, output bruto, peso, alergias ou diário | Varredura de todos os `logInfo`/`logWarn` em `functions/src/nutrition`, `functions/src/notifications/nutritionNotifications.ts` |
| Notificações push não expõem kcal/peso/diagnóstico no título/corpo | `functions/src/notifications/contentPolicy.ts:283-326`, copy fixa validada por allowlist |
| Account deletion remove todas as coleções Firestore específicas de Nutrição | `functions/src/accountDeletion/firestoreCleanup/resources.ts` — ver seção 6 |
| Analytics de Nutrição é no-op em produção e tem firewall de regex contra propriedades sensíveis | `src/nutrition/analytics/index.ts`, `contract.ts` (`SENSITIVE_PROPERTY` regex) |

---

## 2. Requires legal review

### 2.1 Exercício da profissão de Nutricionista (Lei 8.234/1991) — **CRÍTICO**

A Lei 8.234/1991 reserva ao nutricionista registrado no CRN a elaboração de
planos alimentares e a prescrição dietética (`art. 3º`,
[planalto.gov.br/ccivil_03/leis/1989_1994/l8234.htm](https://planalto.gov.br/ccivil_03/leis/1989_1994/l8234.htm)).
O Sistema CFN/CRN já denunciou publicamente ao menos um aplicativo
estrangeiro de "nutricionista de bolso" por IA a uma deputada federal,
caracterizando a oferta de planos alimentares/orientação nutricional por
pessoa/entidade não habilitada como possível **exercício ilegal da
profissão** (contravenção penal, art. 47 do Decreto-Lei 3.688/1941), segundo
nota pública do CRN-5 ([crn5.org.br](https://crn5.org.br/crn-5-se-reune-com-deputada-federal-denuncia-aplicativo-e-estuda-medidas-para-barrar-uso-no-pais/);
[cfn.org.br/exercicio-ilegal-da-profissao](https://cfn.org.br/exercicio-ilegal-da-profissao/)).

O módulo de Nutrição do AJ Fit gera automaticamente um "plano alimentar"
personalizado via IA, sem um nutricionista humano interagindo
individualmente com cada usuário. Isso é estruturalmente próximo ao padrão
que o CFN/CRN já sinalizou publicamente como risco.

**Isto não significa que o produto é ilegal** — significa que a
qualificação jurídica exata (o produto é uma ferramenta de bem-estar/fitness
generalista, ou está "elaborando plano alimentar" no sentido da lei?)
depende de análise jurídica específica, possivelmente incluindo:

- ter um nutricionista com CRN ativo como responsável técnico do produto;
- posicionamento de marketing/copy que não prometa "plano alimentar
  personalizado por nutricionista" nem linguagem equivalente;
- escopo do termo "recomendação" vs. "prescrição" no contexto legal
  brasileiro.

**Requires legal review**: avaliação formal por advogado especializado em
direito da saúde/regulatório antes de qualquer rollout além de um beta
interno fechado e explicitamente avisado.

### 2.2 Resolução CFN nº 856/2026 (Código de Ética atualizado para IA)

Segundo cobertura da resolução publicada em 25/04/2026
([sisnormas.cfn.org.br/viewPage.html?id=856](https://sisnormas.cfn.org.br/viewPage.html?id=856);
[legisweb.com.br](https://www.legisweb.com.br/legislacao/?id=494878)), o novo
código de ética do CFN exige que:

- o uso de IA/automação seja divulgado nos materiais produzidos;
- a IA não substitua o profissional na interação direta com o paciente;
- conflitos de interesse sejam declarados.

Esta resolução regula a conduta de **nutricionistas**, não diretamente uma
empresa de software. Mas se o AJ Fit tiver (ou vier a ter) um nutricionista
responsável técnico, essas regras passam a se aplicar à conduta dele(a)
dentro do produto. **Requires legal review**: confirmar se e como essa
resolução se aplica ao modelo de negócio do AJ Fit.

### 2.3 LGPD — dados de saúde como dado sensível (Lei 13.709/2018, art. 5º/11)

Peso, gravidez/amamentação, alergias e diário alimentar são, no mínimo,
dados pessoais relacionados à saúde — a LGPD classifica dado de saúde como
dado sensível (`art. 5º, II`), sujeito a base legal mais restrita (`art. 11`)
do que dados comuns ([planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm)).
A ANPD sinalizou fiscalização intensificada de dados de saúde para
2025-2027, com RIPD (Relatório de Impacto à Proteção de Dados) obrigatório
para tratamento de alto risco, categoria em que dado sensível de saúde se
encaixa.

**Requires legal/DPO review**:
- base legal específica (art. 11) usada para cada categoria de dado de
  Nutrição;
- necessidade de RIPD para o módulo de Nutrição;
- se consentimento explícito e específico (não só aceite geral de termos)
  é necessário para gravidez/amamentação/alergias.

### 2.4 Claims de saúde / publicidade (CDC art. 37; ANVISA RDC 2/2002 por analogia)

O Código de Defesa do Consumidor proíbe publicidade enganosa/abusiva (art.
37). A ANVISA proíbe alegações terapêuticas, medicamentosas ou de
emagrecimento garantido em rótulos/publicidade de alimentos (RDC nº 2/2002)
— não se aplica diretamente a um app, mas reflete o padrão regulatório
geral contra esse tipo de promessa. Nenhuma claim de alto risco foi
encontrada no copy já implementado (ver relatório principal), mas o
disclaimer completo descrito em `09_safety/disclaimers_and_legal.md` não
está totalmente implementado. **Requires legal + professional review** do
texto final antes do lançamento.

---

## 3. Requires privacy review (LGPD/DPO)

- Política de retenção de dados de Nutrição: **não existe hoje**, nem no
  código nem na documentação. Nenhum TTL/expiração automática foi
  encontrado para `nutritionDailyLogs`, `nutritionPlans`,
  `nutritionProfile`. Isso não é necessariamente uma violação (retenção
  indefinida pode ser justificável enquanto a conta existir), mas precisa
  de uma decisão documentada, não um vácuo.
- Confirmar se a OpenAI precisa ser formalmente listada como subprocessador
  no Aviso de Privacidade (ela processa dados — mesmo que minimizados — em
  nome do AJ Fit).
- Confirmar se Zero Data Retention da OpenAI está habilitado para a conta
  usada em produção (ver seção 4 abaixo — é um item contratual/operacional,
  não verificável pelo código).
- Confirmar necessidade de RIPD (ver 2.3).

---

## 4. Requires product decision

- **Terms of Use / Privacy Policy do app inteiro são placeholder.**
  `src/components/legal/LegalDocumentModal.tsx` renderiza
  `common:legal.placeholderTitle`/`placeholderBody`, cujo texto real é:
  *"Conteúdo jurídico pendente" / "PLACEHOLDER — o conteúdo jurídico
  definitivo será inserido aqui posteriormente."* Isso é um achado de
  código objetivo, não interpretação: **não existe Política de Privacidade
  nem Termos de Uso reais no produto hoje**, para nenhum módulo, não só
  Nutrição. Decisão de produto: isso bloqueia beta interno com testers
  reais? Avaliação própria deste agente (não jurídica): para qualquer
  usuário fora de uma lista pequena e explicitamente avisada da equipe,
  isso é um bloqueador — Nutrição introduz dado de saúde num produto que
  juridicamente ainda não tem termos/política reais.
- Decisão sobre ter (ou divulgar) um nutricionista com CRN ativo como
  responsável técnico do produto.
- Decisão sobre o texto final do disclaimer e onde ele aparece (ver gap de
  implementação na seção "Claims/copy" do relatório principal).

---

## 5. Fontes pesquisadas (2026-10-08)

- [planalto.gov.br/ccivil_03/leis/1989_1994/l8234.htm](https://planalto.gov.br/ccivil_03/leis/1989_1994/l8234.htm) — Lei 8.234/1991 (profissão de Nutricionista)
- [planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm) — LGPD
- [cfn.org.br/exercicio-ilegal-da-profissao](https://cfn.org.br/exercicio-ilegal-da-profissao/) — CFN sobre exercício ilegal
- [crn5.org.br](https://crn5.org.br/crn-5-se-reune-com-deputada-federal-denuncia-aplicativo-e-estuda-medidas-para-barrar-uso-no-pais/) — denúncia de app estrangeiro de IA
- [sisnormas.cfn.org.br/viewPage.html?id=856](https://sisnormas.cfn.org.br/viewPage.html?id=856) — Resolução CFN nº 856/2026
- [openai.com/index/offering-zero-data-retention-for-frontier-models](https://openai.com/index/offering-zero-data-retention-for-frontier-models/) — OpenAI Zero Data Retention
- RDC ANVISA nº 2/2002 (alegações de propriedade funcional/saúde) — mencionada por analogia, não diretamente aplicável a software

Nenhuma conclusão jurídica definitiva foi tirada dessas fontes. Elas apontam
a direção da revisão especializada necessária.
