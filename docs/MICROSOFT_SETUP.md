# Configuração Microsoft: Entra ID, Graph e Power BI Embedded

Este guia configura o ShipBI como aplicação web confidencial. O frontend inicia o login, mas o Cloudflare Worker recebe o callback e troca o authorization code. Por isso, registre a Redirect URI como **Web**, mesmo usando PKCE. Não configure o segredo no navegador.

## 1. Escolher single-tenant ou multi-tenant

- **Single-tenant:** recomendado para uma implantação dedicada a uma única organização. Reduz a superfície de consentimento e simplifica governança.
- **Multi-tenant:** indicado para um SaaS que atende diretórios Entra diferentes. Exige onboarding, admin consent por cliente, validação do tenant emissor e revisão jurídica/operacional.

Para isolamento máximo, use Worker, D1 e segredo separados por cliente. Para uma operação compartilhada, mantenha todas as consultas vinculadas ao `tenant_id` e nunca confie em tenant enviado no corpo da requisição.

## 2. Criar o App Registration

1. Acesse **Microsoft Entra admin center > Identity > Applications > App registrations > New registration**.
2. Selecione o tipo de conta definido acima.
3. Em **Authentication > Add a platform**, escolha **Web**.
4. Cadastre `https://YOUR_DOMAIN/api/auth/callback`. Para desenvolvimento, adicione `http://localhost:8787/api/auth/callback`.
5. Não habilite implicit grant. O projeto usa `response_type=code`, `state`, `code_challenge` e `S256`.
6. Em **Certificates & secrets**, prefira certificado em ambientes regulados. Para o boilerplate, crie um client secret com expiração curta e registre a rotação.

Referência: [OAuth 2.0 authorization code flow com PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow).

## 3. Permissões Microsoft Graph

Permissões delegadas usadas no login:

- `openid`, `profile`, `email`;
- `User.Read`.

Permissões de aplicação para tarefas do backend:

- `User.Read.All`: consultar usuários e a associação transitiva de outro usuário;
- `GroupMember.Read.All`: busca e leitura de grupos quando a política do tenant exigir;
- `OrganizationalBranding.Read.All`: importar logos, cores e textos da organização;
- `Organization.Read.All`: opcional, para importar `displayName` e metadados da organização.

Conceda **Grant admin consent** após revisão. Use o menor privilégio aceito pela política do cliente. A API de associação transitiva documenta `User.Read.All` como menor privilégio de aplicação para outro usuário: [List user transitiveMemberOf](https://learn.microsoft.com/en-us/graph/api/user-list-transitivememberof?view=graph-rest-1.0).

## 4. Como o ShipBI usa o Graph

Após o login, o Worker lê `/me` com o token delegado e cria/atualiza o usuário local. Ao autorizar um relatório, obtém token de aplicação e consulta:

```text
GET /users/{entra-object-id}/transitiveMemberOf/microsoft.graph.group?$select=id
```

Os IDs retornados são combinados ao object ID do usuário e comparados somente com `access_rules` do mesmo `tenant_id`. O portal administrativo também pesquisa usuários/grupos e pode importar `/organization/{tenant-id}/branding` e `/organization` para preencher identidade visual. Ativos binários ficam no D1; o frontend não depende de URLs privadas do Graph.

## 5. Habilitar Power BI Embedded para service principal

1. Crie um security group dedicado e adicione o service principal.
2. No Power BI/Fabric Admin portal, abra **Tenant settings > Developer settings**.
3. Habilite **Embed content in apps** para esse grupo.
4. Habilite **Allow service principals to use Power BI APIs** para esse grupo.
5. No workspace que contém os relatórios, adicione o service principal ou grupo como **Member** ou **Admin**.
6. Se relatório e semantic model estiverem em workspaces distintos, conceda acesso adequado a ambos.

Para service principal, a Microsoft recomenda não adicionar permissões Power BI delegadas no App Registration; a autorização é feita por tenant settings e papel no workspace. Referência: [Embed with service principal and application secret](https://learn.microsoft.com/en-us/power-bi/developer/embedded/embed-service-principal).

## 6. Embed token e EffectiveIdentity

O Worker obtém um token de aplicação com o escopo:

```text
https://analysis.windows.net/powerbi/api/.default
```

Depois chama `GenerateToken` no relatório. Para modelos protegidos por RLS, o payload contém:

```json
{
  "accessLevel": "View",
  "identities": [
    {
      "username": "signed-in-user@example.test",
      "roles": ["AuthorizedRole"],
      "datasets": ["YOUR_DATASET_ID"]
    }
  ]
}
```

`username` vem da identidade autenticada. `roles` vem da união das regras autorizadas para o usuário e seus grupos no D1. O navegador recebe apenas o embed token temporário. Para service principal com Cloud RLS, a identidade efetiva é obrigatória: [Generate an embed token](https://learn.microsoft.com/en-us/power-bi/developer/embedded/generate-embed-token) e [Cloud RLS](https://learn.microsoft.com/en-us/power-bi/developer/embedded/cloud-rls).

## 7. Configurar o Worker

Copie `.dev.vars.example` para `.dev.vars` e preencha os placeholders. Em produção:

```powershell
npx wrangler secret put ENTRA_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
```

Valores não secretos ficam no `wrangler.toml`. Você pode usar `ENTRA_TENANT_ID` e `ENTRA_CLIENT_ID` como fallback, mas os campos `entra_tenant_id` e `entra_client_id` por tenant têm precedência.

Checklist antes de liberar produção:

- `APP_ENV="production"` e `DEV_AUTH_ENABLED="false"`;
- `APP_BASE_URL` exatamente igual à origem pública;
- redirect Web cadastrada e testada;
- admin consent confirmado;
- segredo fora de Git, D1, frontend e logs;
- service principal restrito a security group e workspaces necessários;
- papéis RLS validados no modelo semântico;
- política de rotação de segredo/certificado e resposta a incidentes registrada.
