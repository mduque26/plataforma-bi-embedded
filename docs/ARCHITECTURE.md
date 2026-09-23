# Arquitetura

## Limites do sistema

Este repositório contém exclusivamente o portal de BI. Autenticação, tenant e auditoria existem porque são dependências diretas do compartilhamento seguro de relatórios. Não há código de outros domínios da aplicação de referência.

```text
Navegador
  -> Cloudflare Worker
     -> assets estáticos
     -> D1: tenant, usuário, sessão, catálogo, acesso, auditoria
     -> Microsoft Entra ID: login e tokens de aplicação
     -> Microsoft Graph: perfil e grupos
     -> Power BI REST API: workspaces, relatórios e embed token
```

## White label

O tenant é resolvido pelo header `x-tenant` e usa `DEFAULT_TENANT_SLUG` como padrão. Em produção, um proxy ou domínio customizado deve definir o tenant de forma confiável. Cada registro guarda nome, IDs públicos do Microsoft Entra e tokens visuais em `theme_json`.

Exemplo de tema:

```json
{
  "productName": "Analytics da Empresa",
  "logoText": "AE",
  "accent": "#1f4e78"
}
```

## Segurança

- consultas D1 sempre parametrizadas;
- segredo Entra disponível apenas no Worker;
- sessão aleatória com somente HMAC-SHA-256 persistido quando `SESSION_SECRET` está configurado;
- estado OAuth temporário e PKCE;
- catálogo isolado por `tenant_id` em todas as consultas;
- regras RLS são unidas, nunca usadas para ampliar acesso sem regra;
- CSP restringe scripts, conexões e frames, sem CDN de runtime;
- mutações rejeitam headers `Origin` que não correspondem à origem configurada;
- auditoria registra mutações e visualizações reais.

## Auditoria e governança

A área de auditoria preserva as três perspectivas operacionais do módulo de referência:

- usuários e grupos, com os dashboards e papéis RLS relacionados;
- dashboards, com principais autorizados, número de regras, acessos e diagnóstico RLS;
- eventos, com filtros por ação, ator, dashboard e período.

Eventos de catálogo persistem snapshots antes/depois, mas a API deriva uma visão pública restrita a nome, descrição, área, status e rótulo. Alterações de acesso exibem somente nomes, tipos de principal e papéis RLS. Object IDs, IDs técnicos do Power BI, URLs de embed, tokens e metadados privados não são renderizados.

Antes de produção, recomenda-se adicionar limitação de taxa, rotação de segredo, alertas de falha de autenticação, política de retenção de auditoria e validação do tenant por hostname.
