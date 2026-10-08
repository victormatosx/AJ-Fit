# AJ Fit Nutrition — Secrets e API Keys

## 1. OpenAI

A chave da OpenAI deve ficar no Google Secret Manager/Firebase Functions Secrets.

Nunca:

- `EXPO_PUBLIC_*`;
- bundle mobile;
- Firestore legível;
- Remote Config público;
- source code.

---

## 2. Injeção

Functions que chamam a OpenAI declaram explicitamente o secret necessário.

Serviços internos recebem cliente/provider já configurado.

---

## 3. Ambientes

Separar credenciais por ambiente:

- development/emulator;
- staging quando existir;
- production.

Nunca usar chave de produção em testes locais normais.

---

## 4. Rotação

A arquitetura deve permitir troca de chave sem release mobile.

---

## 5. Configuração não secreta

Pode ficar em config backend:

- provider;
- model;
- max tokens;
- prompt version;
- budgets;
- feature flags;
- rate limits.

Não colocar informação secreta junto.

---

## 6. Permissões

Aplicar least privilege aos service accounts e secrets.

O mobile nunca tem acesso direto ao provider de IA.

---

## 7. Logs

Nunca logar:

- API key;
- Authorization headers;
- payload completo contendo PII sem necessidade.
