# Identidade visual por tenant

Cada tenant mantém sua configuração em `tenants.theme_json` e seus arquivos em `tenant_brand_assets`. A resolução continua sendo feita pelo cabeçalho `x-tenant`, portanto cores e logos nunca são compartilhados entre ambientes.

## Edição manual

Administradores podem editar em **Configuração → Identidade visual**:

- nome do produto e sigla;
- cor de destaque, fundo, superfície e textos;
- raio dos elementos;
- mensagem da tela de entrada.

O formulário mostra uma prévia antes de salvar. A alteração gera o evento de auditoria `tenant.branding_updated`.

## Importação do Microsoft Entra

O botão **Importar do Microsoft Entra** consulta primeiro uma prévia. A aplicação só ocorre após confirmação no modal. São considerados nome da organização, cores, texto de entrada, logos, imagem de fundo e favicon disponíveis no branding padrão do tenant.

Permissões de aplicação recomendadas no Microsoft Graph:

- `OrganizationalBranding.Read.All` para a identidade;
- `Organization.Read.All` apenas se o nome oficial da organização também precisar ser lido.

Sem `Organization.Read.All`, o importador conserva o nome já cadastrado no portal. Sem branding configurado ou licença compatível no Entra, a edição manual permanece funcional.

Arquivos aceitos: PNG, JPEG e favicon ICO, com limite de 1,5 MB por ativo. Os binários são copiados para o D1 e servidos por `/api/branding/assets/:tipo`; tokens e URLs protegidas do Graph não chegam ao navegador.
