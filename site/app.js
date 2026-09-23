const app = document.querySelector("#app");
const state = { config: null, user: null, catalog: [], departments: [], adminCatalog: [], powerBiWorkspaces: [], powerBiReports: [], providerRequestSequence: 0, rlsRequestSequence: 0, principalRequestSequence: { access: 0, catalog: 0 }, editingReportId: null, rlsInspection: null, accessDraft: [], catalogAccessDraft: [], catalogPrincipal: null, auditEvents: [], accessOverview: { principals: [], dashboards: [] }, auditTab: "users", brandingPreview: null, route: location.hash || "#catalog", loading: true };

const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const initials = (value = "") => value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "BI";
const icon = (name, label = "") => `<span class="material-symbols-rounded" aria-hidden="true">${escapeHtml(name)}</span>${label ? `<span>${escapeHtml(label)}</span>` : ""}`;
const assetUrl = (type) => `/api/branding/assets/${encodeURIComponent(type)}`;
const brandMark = (theme, className = "brand-mark") => theme.logoAsset
  ? `<span class="${className} has-image"><img src="${assetUrl(theme.logoAsset)}" alt="" onerror="this.parentElement.classList.remove('has-image');this.remove()"><span>${escapeHtml(theme.logoText || "BI")}</span></span>`
  : `<span class="${className}"><span>${escapeHtml(theme.logoText || "BI")}</span></span>`;
const date = (value) => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "Sem atualização";
const storedThemeMode = () => localStorage.getItem("portal-theme") || "system";
const resolvedThemeMode = (preference = storedThemeMode()) => preference === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : preference;
function setThemeMode(preference = "system", persist = true) {
  if (!['system','light','dark'].includes(preference)) preference = "system";
  if (persist) localStorage.setItem("portal-theme", preference);
  document.documentElement.dataset.theme = resolvedThemeMode(preference);
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.style.colorScheme = resolvedThemeMode(preference);
  document.querySelectorAll("#theme-mode").forEach((select) => { select.value = preference; });
  applyTheme();
}
const toast = (message) => {
  const element = document.createElement("div"); element.className = "toast"; element.textContent = message;
  document.querySelector("#toast-region").append(element); setTimeout(() => element.remove(), 4200);
};
const setBusy = (button, busy) => { if (!button) return; button.disabled = busy; button.toggleAttribute("aria-busy", busy); };
const actionIcons = { newReport: "add", configureReport: "tune", manageAccess: "manage_accounts", openReport: "open_in_new", refreshAudit: "refresh", reload: "refresh", diagnose: "policy", removeAccess: "delete", saveAccess: "save", inspectRls: "verified_user", loadWorkspaces: "sync", newDepartment: "create_new_folder", createDepartment: "add", addCatalogAccess: "group_add", fullscreen: "fullscreen", logout: "logout", togglePublisher: "close" };
function decorateActions(root = document) {
  root.querySelectorAll?.("button:not([data-icon-ready]), a.button:not([data-icon-ready])").forEach((button) => {
    const key = Object.keys(actionIcons).find((name) => button.dataset[name] !== undefined);
    if (!key || button.querySelector(".material-symbols-rounded")) return;
    button.insertAdjacentHTML("afterbegin", icon(actionIcons[key])); button.dataset.iconReady = "true";
  });
  root.querySelectorAll?.(".detail-dialog .dialog-heading:not([data-close-ready])").forEach((heading) => {
    heading.dataset.closeReady = "true";
    if (!heading.querySelector(".icon-button")) heading.insertAdjacentHTML("beforeend", `<button class="icon-button dialog-close" type="button" data-close-dialog aria-label="Fechar">${icon("close")}</button>`);
  });
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(body?.error?.message || "Não foi possível concluir a solicitação."); error.status = response.status; throw error;
  }
  return body;
}

function applyTheme() {
  const theme = state.config?.tenant?.theme || {};
  document.title = theme.productName || state.config?.tenant?.name || "Portal Analytics";
  const variables = { accent: "--accent", canvas: "--canvas", surface: "--surface", text: "--ink", muted: "--muted" };
  Object.entries(variables).forEach(([key, variable]) => {
    if (key === "accent" || document.documentElement.dataset.theme !== "dark") {
      if (typeof theme[key] === "string" && /^#[0-9a-f]{6}$/i.test(theme[key])) document.documentElement.style.setProperty(variable, theme[key]);
    } else document.documentElement.style.removeProperty(variable);
  });
  if (Number.isFinite(Number(theme.radius))) document.documentElement.style.setProperty("--radius", `${Math.min(24, Math.max(4, Number(theme.radius)))}px`);
  document.documentElement.style.setProperty("--login-art", theme.backgroundAsset ? `url('${assetUrl(theme.backgroundAsset)}')` : "none");
  if (theme.faviconAsset) document.querySelector("link[rel=icon]")?.setAttribute("href", assetUrl(theme.faviconAsset));
}

function loginView() {
  const theme = state.config?.tenant?.theme || {};
  const azure = state.config?.auth?.azureConfigured;
  const dev = state.config?.auth?.devEnabled;
  app.innerHTML = `<main class="login" id="main">
    <section class="login-copy">
      <div class="login-top"><a class="brand" href="/">${brandMark(theme)}<span>${escapeHtml(theme.productName || "Portal Analytics")}</span></a><label class="theme-control"><span class="hidden">Aparência</span><select id="theme-mode" aria-label="Aparência"><option value="system" ${storedThemeMode() === "system" ? "selected" : ""}>Sistema</option><option value="light" ${storedThemeMode() === "light" ? "selected" : ""}>Claro</option><option value="dark" ${storedThemeMode() === "dark" ? "selected" : ""}>Escuro</option></select></label></div>
      <div class="login-main">
        <p class="section-label">Portal corporativo de dados</p>
        <h1>Decisões começam com contexto.</h1>
        <p class="lead">${escapeHtml(theme.signInPageText || "Acesse seus relatórios Power BI com segurança, em um portal preparado para a identidade da sua organização.")}</p>
        <div class="login-actions">
          ${azure ? '<a class="button button-primary" href="/api/auth/login">Entrar com Microsoft</a>' : ''}
          ${dev ? '<button class="button button-primary" data-dev-login="admin">Entrar no ambiente local</button><button class="button button-secondary" data-dev-login="viewer">Simular leitor</button>' : ''}
        </div>
        ${!azure && !dev ? '<p class="text-danger">O provedor de identidade ainda não foi configurado.</p>' : ''}
      </div>
      <small class="muted">Acesso protegido por Microsoft Entra ID</small>
    </section>
    <aside class="login-art" aria-hidden="true"><div class="login-art-content">${brandMark(theme, "login-brand-mark")}<span>${escapeHtml(theme.productName || "Portal Analytics")}</span><strong>Informação confiável para decisões de negócio.</strong><p>Relatórios, acessos e governança em um único ambiente.</p></div></aside>
  </main>`;
}

function shell(content, current = "catalog") {
  const theme = state.config?.tenant?.theme || {};
  return `<div class="shell">
    <header class="topbar">
      <a class="brand" href="#catalog" data-route="catalog">${brandMark(theme)}<span class="brand-name">${escapeHtml(theme.productName || state.config?.tenant?.name || "Portal Analytics")}</span></a>
      <nav class="nav" aria-label="Principal">
        <button class="nav-link" data-route="catalog" ${current === "catalog" ? 'aria-current="page"' : ""}>Relatórios</button>
        ${state.user?.isAdmin ? `<button class="nav-link" data-route="admin" ${current === "admin" ? 'aria-current="page"' : ""}>Catálogo</button><button class="nav-link" data-route="audit" ${current === "audit" ? 'aria-current="page"' : ""}>Auditoria</button><button class="nav-link" data-route="settings" ${current === "settings" ? 'aria-current="page"' : ""}>Configuração</button>` : ""}
      </nav>
      <div class="account"><label class="theme-control" title="Aparência"><span class="hidden">Aparência</span><select id="theme-mode" aria-label="Aparência"><option value="system" ${storedThemeMode() === "system" ? "selected" : ""}>Sistema</option><option value="light" ${storedThemeMode() === "light" ? "selected" : ""}>Claro</option><option value="dark" ${storedThemeMode() === "dark" ? "selected" : ""}>Escuro</option></select></label><span class="avatar">${initials(state.user?.displayName)}</span><span class="account-copy"><strong>${escapeHtml(state.user?.displayName)}</strong><small>${state.user?.isAdmin ? "Administrador" : "Leitor"}</small></span><button class="button button-quiet" data-logout>Sair</button></div>
    </header>
    ${content}
  </div>`;
}

function loadingCards() {
  return `<div class="catalog-grid"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>`;
}

function catalogView() {
  app.innerHTML = shell(`<main class="container" id="main">
    <header class="page-head"><div><p class="section-label">Biblioteca de dados</p><h1>Relatórios</h1><p class="lead">Consulte os painéis disponibilizados para sua área.</p></div></header>
    <div class="filters"><label class="search"><span class="hidden">Buscar relatórios</span><input id="catalog-search" type="search" placeholder="Buscar por nome ou descrição"></label><div id="department-filters"></div></div>
    <section id="catalog-content" aria-label="Catálogo de relatórios">${state.loading ? loadingCards() : ""}</section>
  </main>`, "catalog");
  renderCatalogItems();
}

function renderCatalogItems() {
  const target = document.querySelector("#catalog-content"); if (!target) return;
  const query = document.querySelector("#catalog-search")?.value.toLowerCase().trim() || "";
  const active = document.querySelector(".chip.active")?.dataset.department || "all";
  const items = state.catalog.filter((item) => (active === "all" || item.department?.slug === active) && (!query || `${item.name} ${item.description || ""}`.toLowerCase().includes(query)));
  const filters = document.querySelector("#department-filters");
  if (filters && !filters.children.length) filters.innerHTML = `<button class="chip active" data-department="all">Todos</button> ${state.departments.map((item) => `<button class="chip" data-department="${escapeHtml(item.slug)}">${escapeHtml(item.name)}</button>`).join(" ")}`;
  if (state.loading) { target.innerHTML = loadingCards(); return; }
  if (!items.length) { target.innerHTML = `<div class="empty"><div><h2>Nenhum relatório encontrado</h2><p>Ajuste a busca ou solicite acesso a uma área para visualizar novos conteúdos.</p></div></div>`; return; }
  target.innerHTML = `<div class="catalog-grid">${items.map((item) => `<article class="report-card">
    <div class="report-card-icon" aria-hidden="true">${icon("monitoring")}</div>
    <div class="report-card-copy"><span class="report-area">${escapeHtml(item.department?.name || "Geral")}</span><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.description || "Relatório corporativo")}</p></div>
    <div class="card-meta"><span class="report-type">Power BI</span><button class="button button-secondary" data-open-report="${item.id}">Abrir relatório</button></div>
  </article>`).join("")}</div>`;
}

function demoReport(item) {
  return `<div class="demo-report"><div class="demo-kpis">
    <div class="demo-kpi"><span>Receita líquida</span><strong>R$ 8,42 mi</strong><small class="muted">+6,8% no período</small></div>
    <div class="demo-kpi"><span>Margem</span><strong>31,4%</strong><small class="muted">+1,2 p.p.</small></div>
    <div class="demo-kpi"><span>Pedidos</span><strong>12.847</strong><small class="muted">94,6% no prazo</small></div>
    <div class="demo-kpi"><span>Previsão</span><strong>R$ 9,1 mi</strong><small class="muted">Confiança de 87%</small></div>
  </div><div class="demo-layout"><section class="demo-panel"><h3>Evolução mensal</h3><p class="muted">Visual demonstrativo. O relatório real será renderizado pelo Power BI.</p><div class="bar-chart" aria-label="Gráfico demonstrativo"><div class="bar" style="height:38%"></div><div class="bar" style="height:52%"></div><div class="bar" style="height:47%"></div><div class="bar" style="height:69%"></div><div class="bar" style="height:74%"></div><div class="bar" style="height:82%"></div><div class="bar" style="height:76%"></div><div class="bar" style="height:91%"></div></div></section><aside class="demo-panel"><h3>Leitura rápida</h3><p class="lead">O desempenho ficou acima do planejado em cinco das oito competências analisadas.</p></aside></div></div>`;
}

async function openReport(id) {
  const item = state.catalog.find((entry) => entry.id === id);
  app.innerHTML = shell(`<main class="container" id="main"><section class="viewer"><header class="viewer-head"><button class="button button-quiet" data-route="catalog">Voltar</button><h2>${escapeHtml(item?.name || "Relatório")}</h2><button class="button button-secondary" data-fullscreen>Expandir</button></header><div id="powerbi-frame" class="loading">Preparando relatório...</div></section></main>`, "catalog");
  try {
    const config = await api(`/api/bi/reports/${id}/embed-config`);
    const frame = document.querySelector("#powerbi-frame");
    if (config.demo) { frame.className = ""; frame.innerHTML = demoReport(config.report); return; }
    if (!window.powerbi) throw new Error("A biblioteca do Power BI não foi carregada.");
    frame.className = "";
    const models = window["powerbi-client"].models;
    window.powerbi.embed(frame, { ...config, tokenType: models.TokenType.Embed, permissions: models.Permissions.Read });
  } catch (error) {
    document.querySelector("#powerbi-frame").outerHTML = `<div id="powerbi-frame" class="error-state"><div><h2>Relatório indisponível</h2><p>${escapeHtml(error.message)}</p><button class="button button-secondary" data-open-report="${id}">Tentar novamente</button></div></div>`;
  }
}

function reportAccessSection() {
  return `<section class="config-access-section" aria-labelledby="config-access-title"><div class="config-section-heading"><span class="section-icon">${icon("manage_accounts")}</span><div><h3 id="config-access-title">Usuários e grupos</h3><p>Inclua os acessos antes de publicar. Os papéis disponíveis seguem o RLS confirmado no modelo.</p></div></div><div class="principal-composer"><div class="field"><label for="catalog-principal-search">Buscar no diretório</label><input id="catalog-principal-search" type="search" autocomplete="off" placeholder="Nome, e-mail ou grupo"><div id="catalog-principal-results" class="principal-options" hidden></div></div><div class="field" id="catalog-role-field" hidden><label>Papéis RLS</label><div id="catalog-role-options" class="role-options"></div></div><button class="button button-secondary" type="button" data-add-catalog-access disabled>Adicionar acesso</button></div><div id="catalog-access-current" class="access-draft"></div></section>`;
}

function enhanceReportConfig() {
  let panel = document.querySelector("#publisher-panel");
  if (panel && panel.tagName !== "DIALOG") {
    const dialog = document.createElement("dialog"); dialog.id = panel.id; dialog.className = `${panel.className} report-config-dialog`; dialog.innerHTML = panel.innerHTML; panel.replaceWith(dialog); panel = dialog;
  }
  const form = panel?.querySelector("#catalog-form"); if (!form || form.dataset.enhanced) return;
  form.dataset.enhanced = "true"; form.classList.add("report-config-form");
  form.insertAdjacentHTML("afterbegin", `<div class="modal-progress" aria-label="Seções da configuração"><button class="is-current" type="button" data-config-section="report">${icon("tune")} Dados do relatório</button><button type="button" data-config-section="access">${icon("manage_accounts")} Acessos</button></div>`);
  const actions = form.querySelector(".button-row"); actions?.insertAdjacentHTML("beforebegin", reportAccessSection());
  renderCatalogAccessDraft(); renderCatalogRoleOptions();
}

function adminView() {
  if (!state.user?.isAdmin) return catalogView();
  const azureConfigured = state.config?.auth?.azureConfigured;
  const workspaceControl = azureConfigured ? '<select id="workspace-id" name="workspaceId" required><option value="">Carregue os workspaces</option></select>' : '<input id="workspace-id" name="workspaceId" required>';
  const reportControl = azureConfigured ? '<select id="report-id" name="reportId" required disabled><option value="">Selecione um workspace</option></select>' : '<input id="report-id" name="reportId" required>';
  app.innerHTML = shell(`<main class="container" id="main"><header class="page-head"><div><p class="eyebrow">Governança de conteúdo</p><h1>Catálogo de relatórios</h1><p class="lead">Controle publicação, origem, confidencialidade e segurança RLS em uma única área.</p></div><button class="button button-primary" data-new-report>Adicionar relatório</button></header>
    <section class="metric-row" aria-label="Resumo do catálogo"><div><span>Relatórios</span><strong id="catalog-total">-</strong></div><div><span>Publicados</span><strong id="catalog-active">-</strong></div><div><span>Áreas</span><strong>${state.departments.length}</strong></div><div><span>Com dataset</span><strong id="catalog-datasets">-</strong></div></section>
    <div class="management-layout"><section class="management-main"><div class="section-toolbar"><div><h2>Conteúdo publicado</h2><p class="muted">IDs técnicos são mantidos apenas para administradores.</p></div><label class="search compact-search"><span class="hidden">Buscar no catálogo</span><input id="admin-search" type="search" placeholder="Buscar relatório"></label></div><div class="table-wrap"><table><thead><tr><th>Relatório</th><th>Área</th><th>Status</th><th>Dataset</th><th>Ações</th></tr></thead><tbody id="admin-rows"><tr><td colspan="5">Carregando...</td></tr></tbody></table></div></section>
    <aside class="panel publisher-panel" id="publisher-panel" hidden><div class="panel-heading"><div><p class="eyebrow">Configuração</p><h2 id="publisher-title">Novo relatório</h2></div><button class="button button-quiet" type="button" data-toggle-publisher>Fechar</button></div><form id="catalog-form"><input name="id" type="hidden"><div class="field"><label for="department-id">Área ou pasta</label><div class="inline-field"><select id="department-id" name="departmentId"><option value="">Sem área</option>${state.departments.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("")}</select><button class="button button-secondary" type="button" data-new-department>Nova</button></div></div><div class="field" id="new-department-field" hidden><label for="new-department-name">Nome da nova área</label><div class="inline-field"><input id="new-department-name"><button class="button button-secondary" type="button" data-create-department>Criar</button></div></div><div class="field"><label for="report-name">Nome</label><input id="report-name" name="name" required maxlength="250"></div><div class="field"><label for="workspace-id">Workspace</label>${workspaceControl}${azureConfigured ? '<button class="text-action" type="button" data-load-workspaces>Atualizar workspaces</button>' : '<small>Modo local: informe o ID manualmente.</small>'}</div><div class="field"><label for="report-id">Relatório</label>${reportControl}</div><div class="field"><label for="dataset-id">Dataset</label><input id="dataset-id" name="datasetId"></div><div class="field"><label for="report-label">Classificação</label><select id="report-label" name="label"><option value="standard">Não confidencial</option><option value="confidential">Confidencial</option></select></div><div class="field"><label for="embed-url">Embed URL</label><input id="embed-url" name="embedUrl" type="url" required></div><div class="field"><label for="report-description">Descrição</label><textarea id="report-description" name="description" rows="3"></textarea></div><label class="check-field"><input name="isActive" type="checkbox" checked><span>Relatório ativo no catálogo</span></label><div id="rls-inspection-status" class="inspection-status">Selecione um relatório para verificar RLS.</div><div class="button-row"><button class="button button-secondary" type="button" data-inspect-rls>Verificar RLS</button><button class="button button-primary" type="submit" id="save-report-button">Salvar relatório</button></div></form></aside></div>
    <dialog id="access-dialog" class="detail-dialog access-dialog"><div class="dialog-heading"><p class="eyebrow">Segurança do relatório</p><h2 id="access-dialog-title">Gerenciar acesso</h2><p class="muted">Pesquise usuários e grupos e atribua papéis RLS confirmados pelo Power BI.</p></div><div id="access-status" class="inspection-status">Carregando configuração...</div><div id="access-current"></div><form id="access-rule-draft"><div class="field"><label for="principal-search">Usuário ou grupo</label><input id="principal-search" type="search" autocomplete="off" placeholder="Digite pelo menos 2 caracteres"><select id="principal-results" size="4" hidden></select></div><div class="field" id="access-role-field" hidden><label>Funções de RLS</label><div id="access-role-options" class="role-options"></div></div><button class="button button-secondary" type="submit" id="add-access-rule">Adicionar regra</button></form><div class="dialog-actions"><button class="button button-quiet" type="button" data-close-access>Cancelar</button><button class="button button-primary" type="button" data-save-access>Salvar acessos</button></div></dialog>
  </main>`, "admin");
  enhanceReportConfig();
  loadAdmin();
}

async function loadAdmin() {
  try {
    state.adminCatalog = (await api("/api/bi/admin/catalog")).items;
    renderAdminRows();
    document.querySelector("#catalog-total").textContent = state.adminCatalog.length;
    document.querySelector("#catalog-active").textContent = state.adminCatalog.filter((item) => item.isActive).length;
    document.querySelector("#catalog-datasets").textContent = state.adminCatalog.filter((item) => item.datasetId).length;
  } catch (error) { toast(error.message); }
}

function renderAdminRows() {
  const body = document.querySelector("#admin-rows"); if (!body) return;
  const query = document.querySelector("#admin-search")?.value.toLowerCase().trim() || "";
  const visible = state.adminCatalog.filter((item) => !query || `${item.name} ${item.description || ""}`.toLowerCase().includes(query));
  body.innerHTML = visible.map((item) => `<tr><td><strong>${escapeHtml(item.name)}</strong><br><small class="muted">${escapeHtml(item.description || "Sem descrição")}</small></td><td>${escapeHtml(item.department?.name || "Geral")}</td><td><span class="state-label ${item.isActive ? "is-active" : ""}">${item.isActive ? "Publicado" : "Inativo"}${item.metadata?.confidential ? " · Confidencial" : ""}</span></td><td><code>${escapeHtml(item.datasetId || "Não informado")}</code></td><td><div class="table-actions"><button class="button button-secondary button-small" data-configure-report="${item.id}">Configurar</button><button class="button button-quiet button-small" data-manage-access="${item.id}">Acessos</button></div></td></tr>`).join("") || '<tr><td colspan="5">Nenhum relatório encontrado.</td></tr>';
}

let principalSearchTimer;

async function openReportConfig(item = null) {
  const panel = document.querySelector("#publisher-panel");
  const form = document.querySelector("#catalog-form");
  if (!panel || !form) return;
  form.reset(); state.editingReportId = item?.id || null; state.rlsInspection = null; state.catalogAccessDraft = []; state.catalogPrincipal = null;
  document.querySelector("#publisher-title").textContent = item ? "Configurar relatório" : "Novo relatório";
  form.elements.id.value = item?.id || "";
  form.elements.name.value = item?.name || "";
  form.elements.departmentId.value = item?.departmentId || "";
  form.elements.datasetId.value = item?.datasetId || "";
  form.elements.embedUrl.value = item?.embedUrl || "";
  form.elements.description.value = item?.description || "";
  form.elements.label.value = item?.metadata?.confidential ? "confidential" : "standard";
  form.elements.isActive.checked = item ? item.isActive : true;
  panel.hidden = false; if (panel.tagName === "DIALOG" && !panel.open) panel.showModal();
  if (state.config?.auth?.azureConfigured) {
    await loadPowerBiWorkspaces(item?.workspaceId || "");
    if (item?.workspaceId) await loadPowerBiReports(item.workspaceId, item.reportId || "");
  } else {
    form.elements.workspaceId.value = item?.workspaceId || "";
    form.elements.reportId.value = item?.reportId || "";
  }
  if (item) {
    const [rules] = await Promise.all([api(`/api/bi/admin/catalog/${item.id}/access-rules`), inspectCurrentRls()]);
    state.catalogAccessDraft = rules.items || [];
  }
  renderCatalogAccessDraft(); renderCatalogRoleOptions();
  form.elements.name.focus();
}

async function loadPowerBiWorkspaces(selected = "") {
  const select = document.querySelector("#workspace-id"); if (!select || select.tagName !== "SELECT") return;
  select.disabled = true; select.innerHTML = '<option value="">Carregando workspaces...</option>';
  try {
    state.powerBiWorkspaces = (await api("/api/bi/admin/workspaces")).items || [];
    select.innerHTML = `<option value="">Selecione</option>${state.powerBiWorkspaces.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("")}`;
    select.value = selected; select.disabled = false;
  } catch (error) { select.innerHTML = '<option value="">Workspaces indisponíveis</option>'; toast(error.message); }
}

async function loadPowerBiReports(workspaceId, selected = "") {
  const select = document.querySelector("#report-id"); if (!select || select.tagName !== "SELECT") return;
  const sequence = ++state.providerRequestSequence;
  select.disabled = true; select.innerHTML = '<option value="">Carregando relatórios...</option>'; state.powerBiReports = [];
  if (!workspaceId) { select.innerHTML = '<option value="">Selecione um workspace</option>'; return; }
  try {
    state.powerBiReports = (await api(`/api/bi/admin/workspaces/${encodeURIComponent(workspaceId)}/reports`)).items || [];
    if (sequence !== state.providerRequestSequence || document.querySelector("#workspace-id")?.value !== workspaceId) return;
    select.innerHTML = `<option value="">Selecione</option>${state.powerBiReports.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("")}`;
    select.value = selected; select.disabled = false;
  } catch (error) { select.innerHTML = '<option value="">Relatórios indisponíveis</option>'; toast(error.message); }
}

function syncSelectedProviderReport() {
  const form = document.querySelector("#catalog-form"); if (!form) return;
  const report = state.powerBiReports.find((item) => item.id === form.elements.reportId.value);
  if (!report) return;
  if (!form.elements.name.value) form.elements.name.value = report.name || "";
  form.elements.datasetId.value = report.datasetId || "";
  form.elements.embedUrl.value = report.embedUrl || "";
  state.rlsInspection = null;
  document.querySelector("#rls-inspection-status").textContent = "Verificando RLS do modelo semântico...";
  inspectCurrentRls();
}

async function inspectCurrentRls() {
  const form = document.querySelector("#catalog-form"); const status = document.querySelector("#rls-inspection-status");
  if (!form || !status) return null;
  const workspaceId = form.elements.workspaceId.value.trim(); const reportId = form.elements.reportId.value.trim(); const datasetId = form.elements.datasetId.value.trim();
  if (!workspaceId || !reportId) { status.textContent = "Informe workspace e relatório para verificar RLS."; return null; }
  const sequence = ++state.rlsRequestSequence;
  status.className = "inspection-status is-loading"; status.textContent = "Verificando segurança no Power BI...";
  try {
    const result = await api("/api/bi/admin/reports/rls-inspection", { method: "POST", body: JSON.stringify({ workspaceId, reportId, datasetId }) });
    if (sequence !== state.rlsRequestSequence || form.elements.workspaceId.value.trim() !== workspaceId || form.elements.reportId.value.trim() !== reportId || form.elements.datasetId.value.trim() !== datasetId) return null;
    state.rlsInspection = result;
    renderCatalogRoleOptions();
    status.className = "inspection-status is-success";
    status.textContent = result.rlsConfigured ? `RLS confirmado. Papéis: ${result.roles.map((role) => role.name).join(", ")}.` : "O Power BI confirmou que este relatório não exige papéis RLS.";
    return result;
  } catch (error) {
    if (sequence !== state.rlsRequestSequence) return null;
    state.rlsInspection = null; renderCatalogRoleOptions(); status.className = "inspection-status is-error"; status.textContent = error.message; return null;
  }
}

async function openAccessConfig(id) {
  const item = state.adminCatalog.find((entry) => entry.id === id); const dialog = document.querySelector("#access-dialog");
  if (!item || !dialog) return;
  state.editingReportId = id; state.accessDraft = []; state.rlsInspection = null;
  document.querySelector("#access-dialog-title").textContent = `Acessos: ${item.name}`;
  document.querySelector("#access-status").textContent = "Carregando regras e papéis RLS...";
  dialog.showModal();
  try {
    const [rules, rls] = await Promise.all([api(`/api/bi/admin/catalog/${id}/access-rules`), api(`/api/bi/admin/catalog/${id}/rls-roles`)]);
    state.accessDraft = rules.items || []; state.rlsInspection = rls;
    const status = document.querySelector("#access-status"); status.className = "inspection-status is-success";
    status.textContent = rls.rlsConfigured ? `RLS ativo. Selecione ao menos um dos ${rls.roles.length} papéis disponíveis por principal.` : "O Power BI confirmou que este relatório não exige papéis RLS.";
    renderAccessDraft(); renderAccessRoleOptions();
  } catch (error) {
    const status = document.querySelector("#access-status"); status.className = "inspection-status is-error"; status.textContent = error.message;
    document.querySelector("#add-access-rule").disabled = true; document.querySelector("[data-save-access]").disabled = true;
  }
}

function renderAccessDraft() {
  const target = document.querySelector("#access-current"); if (!target) return;
  target.innerHTML = `<div class="access-list"><div class="access-list-head"><strong>Acessos configurados</strong><span>${state.accessDraft.length}</span></div>${state.accessDraft.length ? state.accessDraft.map((rule, index) => `<div class="access-row"><div><strong>${escapeHtml(rule.principalName)}</strong><small>${principalTypeLabel(rule.principalType)}${rule.rlsRoles?.length ? ` · ${escapeHtml(rule.rlsRoles.join(", "))}` : ""}</small></div><button class="button button-quiet button-small" data-remove-access="${index}">Remover</button></div>`).join("") : '<p class="muted">Nenhum usuário ou grupo liberado.</p>'}</div>`;
}

function renderAccessRoleOptions() {
  const field = document.querySelector("#access-role-field"); const target = document.querySelector("#access-role-options"); if (!field || !target) return;
  field.hidden = !state.rlsInspection?.rlsConfigured;
  target.innerHTML = (state.rlsInspection?.roles || []).map((role) => `<label class="option-card"><input type="checkbox" value="${escapeHtml(role.name)}"><span class="option-check">${icon("check")}</span><span><strong>${escapeHtml(role.name)}</strong><small>Papel do modelo semântico</small></span></label>`).join("");
}

function renderCatalogRoleOptions() {
  const field = document.querySelector("#catalog-role-field"); const target = document.querySelector("#catalog-role-options"); if (!field || !target) return;
  field.hidden = !state.rlsInspection?.rlsConfigured;
  target.innerHTML = (state.rlsInspection?.roles || []).map((role) => `<label class="option-card"><input type="checkbox" value="${escapeHtml(role.name)}"><span class="option-check">${icon("check")}</span><span><strong>${escapeHtml(role.name)}</strong><small>Papel do modelo semântico</small></span></label>`).join("");
}

function renderCatalogAccessDraft() {
  const target = document.querySelector("#catalog-access-current"); if (!target) return;
  target.innerHTML = state.catalogAccessDraft.length ? `<div class="access-list-head"><strong>Acessos preparados</strong><span>${state.catalogAccessDraft.length}</span></div>${state.catalogAccessDraft.map((rule, index) => `<div class="access-row"><span class="principal-avatar">${initials(rule.principalName)}</span><div><strong>${escapeHtml(rule.principalName)}</strong><small>${principalTypeLabel(rule.principalType)}${rule.rlsRoles?.length ? ` · ${escapeHtml(rule.rlsRoles.join(", "))}` : ""}</small></div><button class="icon-button" type="button" data-remove-catalog-access="${index}" aria-label="Remover ${escapeHtml(rule.principalName)}">${icon("delete")}</button></div>`).join("")}` : `<div class="access-empty"><span>${icon("group_add")}</span><div><strong>Nenhum acesso preparado</strong><p>Busque usuários ou grupos para liberar o relatório já na criação.</p></div></div>`;
}

function renderCatalogPrincipalResults(items) {
  const target = document.querySelector("#catalog-principal-results"); if (!target) return;
  target.hidden = false;
  target.innerHTML = items.length ? items.map((item) => `<button class="principal-option ${state.catalogPrincipal?.id === item.id ? "is-selected" : ""}" type="button" data-select-catalog-principal="${escapeHtml(item.id)}" data-name="${escapeHtml(item.displayName)}" data-type="${escapeHtml(item.type)}"><span class="principal-avatar">${initials(item.displayName)}</span><span><strong>${escapeHtml(item.displayName)}</strong><small>${escapeHtml(item.upn || principalTypeLabel(item.type))}</small></span><span class="selection-mark">${icon("check")}</span></button>`).join("") : `<div class="option-empty">Nenhum usuário ou grupo encontrado.</div>`;
}

async function searchPrincipals(query, scope = "access") {
  const results = document.querySelector(scope === "catalog" ? "#catalog-principal-results" : "#principal-results"); if (!results) return;
  if (query.trim().length < 2) { results.hidden = true; results.replaceChildren(); return; }
  const sequence = ++state.principalRequestSequence[scope];
  try {
    const items = (await api(`/api/bi/admin/principals?q=${encodeURIComponent(query.trim())}`)).items || [];
    if (sequence !== state.principalRequestSequence[scope]) return;
    if (scope === "catalog") { renderCatalogPrincipalResults(items); return; }
    results.innerHTML = items.map((item) => `<option value="${escapeHtml(item.id)}" data-name="${escapeHtml(item.displayName)}" data-type="${escapeHtml(item.type)}">${escapeHtml(item.displayName)} (${principalTypeLabel(item.type)})</option>`).join("");
    results.hidden = !items.length;
  } catch (error) { toast(error.message); }
}

const actionLabels = {
  "dashboard.accessed": "Dashboard acessado",
  "catalog.created": "Relatório publicado",
  "catalog.updated": "Relatório atualizado",
  "catalog.deleted": "Relatório removido",
  "access_rules.replaced": "Acessos atualizados",
  "tenant.branding_updated": "Identidade visual atualizada",
};
const principalTypeLabel = (value) => value === "entra_group" ? "Grupo" : "Usuário";
const dashboardName = (targetId) => state.catalog.find((item) => String(item.id) === String(targetId))?.name || `Dashboard ${targetId || "não informado"}`;
const withinPeriod = (createdAt, from, to) => {
  const timestamp = new Date(createdAt).getTime();
  if (from && timestamp < new Date(`${from}T00:00:00`).getTime()) return false;
  if (to && timestamp > new Date(`${to}T23:59:59`).getTime()) return false;
  return true;
};

function auditView() {
  if (!state.user?.isAdmin) return catalogView();
  app.innerHTML = shell(`<main class="container" id="main">
    <header class="page-head"><div><p class="eyebrow">Rastreabilidade e acesso</p><h1>Auditoria</h1><p class="lead">Revise permissões, uso dos dashboards e alterações administrativas sem expor identificadores sensíveis.</p></div><button class="button button-secondary" data-refresh-audit>Atualizar dados</button></header>
    <section id="audit-metrics" class="metric-row" aria-label="Resumo da auditoria"><div><span>Carregando</span><strong>-</strong></div></section>
    <div class="subnav" role="tablist" aria-label="Perspectiva de auditoria">
      <button role="tab" data-audit-tab="users">Usuários e grupos</button><button role="tab" data-audit-tab="dashboards">Dashboards</button><button role="tab" data-audit-tab="events">Eventos</button>
    </div>
    <section id="audit-content" class="audit-surface"><div class="loading">Carregando auditoria...</div></section>
    <dialog id="audit-dialog" class="detail-dialog"><div id="audit-dialog-content"></div><form method="dialog"><button class="button button-secondary">Fechar</button></form></dialog>
  </main>`, "audit");
  setAuditTabState();
  loadAudit();
}

async function loadAudit() {
  const target = document.querySelector("#audit-content");
  if (target) target.innerHTML = '<div class="loading">Carregando auditoria...</div>';
  try {
    const [events, overview] = await Promise.all([api("/api/bi/admin/audit?limit=500"), api("/api/bi/admin/access-overview")]);
    state.auditEvents = events.items || [];
    state.accessOverview = overview;
    renderAuditContent();
  } catch (error) {
    if (target) target.innerHTML = `<div class="error-state"><div><h2>Auditoria indisponível</h2><p>${escapeHtml(error.message)}</p><button class="button button-secondary" data-refresh-audit>Tentar novamente</button></div></div>`;
  }
}

function setAuditTabState() {
  document.querySelectorAll("[data-audit-tab]").forEach((button) => {
    const selected = button.dataset.auditTab === state.auditTab;
    button.setAttribute("aria-selected", String(selected));
    button.classList.toggle("active", selected);
  });
}

function auditFilters(kind) {
  const dashboardOptions = state.catalog.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("");
  if (kind === "users") return `<div class="data-toolbar"><label class="search compact-search"><span class="hidden">Buscar usuário ou grupo</span><input name="query" type="search" placeholder="Buscar usuário ou grupo"></label><label><span>Tipo</span><select name="type"><option value="">Todos</option><option value="entra_user">Usuários</option><option value="entra_group">Grupos</option></select></label><label><span>Dashboard</span><select name="dashboard"><option value="">Todos</option>${dashboardOptions}</select></label></div>`;
  if (kind === "dashboards") return `<div class="data-toolbar"><label class="search compact-search"><span class="hidden">Buscar dashboard</span><input name="query" type="search" placeholder="Buscar dashboard"></label><label><span>Tipo de principal</span><select name="type"><option value="">Todos</option><option value="entra_user">Usuários</option><option value="entra_group">Grupos</option></select></label><label><span>Período inicial</span><input name="from" type="date"></label><label><span>Período final</span><input name="to" type="date"></label></div>`;
  const actions = [...new Set(state.auditEvents.map((event) => event.action))].sort().map((action) => `<option value="${escapeHtml(action)}">${escapeHtml(actionLabels[action] || action)}</option>`).join("");
  return `<div class="data-toolbar"><label class="search compact-search"><span class="hidden">Buscar evento</span><input name="query" type="search" placeholder="Buscar ator ou evento"></label><label><span>Evento</span><select name="action"><option value="">Todos</option>${actions}</select></label><label><span>Dashboard</span><select name="dashboard"><option value="">Todos</option>${dashboardOptions}</select></label><label><span>Período inicial</span><input name="from" type="date"></label><label><span>Período final</span><input name="to" type="date"></label></div>`;
}

function currentFilters() {
  const form = document.querySelector("#audit-filter-form");
  return form ? Object.fromEntries(new FormData(form)) : {};
}

function renderAuditContent() {
  const target = document.querySelector("#audit-content"); if (!target) return;
  const tab = state.auditTab;
  target.innerHTML = `<form id="audit-filter-form">${auditFilters(tab)}</form><div id="audit-table"></div>`;
  setAuditTabState();
  renderAuditTable();
}

function renderAuditMetrics(values) {
  const target = document.querySelector("#audit-metrics"); if (!target) return;
  target.innerHTML = values.map(([label, value, helper]) => `<div><span>${escapeHtml(label)}</span><strong>${value}</strong>${helper ? `<small>${escapeHtml(helper)}</small>` : ""}</div>`).join("");
}

function renderAuditTable() {
  const target = document.querySelector("#audit-table"); if (!target) return;
  const filters = currentFilters();
  const query = String(filters.query || "").toLowerCase().trim();
  const visits = state.auditEvents.filter((event) => event.action === "dashboard.accessed" && withinPeriod(event.createdAt, filters.from, filters.to));

  if (state.auditTab === "users") {
    const items = state.accessOverview.principals.filter((principal) => (!filters.type || principal.principalType === filters.type) && (!filters.dashboard || principal.dashboards.some((item) => String(item.catalogItemId) === filters.dashboard)) && (!query || principal.principalName.toLowerCase().includes(query)));
    const dashboardIds = new Set(items.flatMap((principal) => principal.dashboards.map((item) => String(item.catalogItemId))));
    renderAuditMetrics([["Principais", items.length, "usuários e grupos"], ["Relações de acesso", items.reduce((total, item) => total + item.dashboards.length, 0), "regras filtradas"], ["Dashboards", dashboardIds.size, "conteúdos distintos"], ["Acessos", visits.filter((event) => dashboardIds.has(String(event.targetId))).length, "nos dashboards relacionados"]]);
    target.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Principal</th><th>Tipo</th><th>Dashboards permitidos</th><th>Papéis RLS</th></tr></thead><tbody>${items.map((principal) => `<tr><td><strong>${escapeHtml(principal.principalName)}</strong></td><td>${principalTypeLabel(principal.principalType)}</td><td><div class="tag-list">${principal.dashboards.map((item) => `<span>${escapeHtml(item.dashboardName)}</span>`).join("")}</div></td><td>${escapeHtml([...new Set(principal.dashboards.flatMap((item) => item.rlsRoles || []))].join(", ") || "Sem papel")}</td></tr>`).join("") || '<tr><td colspan="4">Nenhuma relação de acesso encontrada.</td></tr>'}</tbody></table></div>`;
    return;
  }

  if (state.auditTab === "dashboards") {
    const items = state.accessOverview.dashboards.filter((dashboard) => (!filters.type || dashboard.principals.some((principal) => principal.principalType === filters.type)) && (!query || dashboard.dashboardName.toLowerCase().includes(query)));
    const matchingPrincipals = new Set(items.flatMap((dashboard) => dashboard.principals.filter((principal) => !filters.type || principal.principalType === filters.type).map((principal) => `${principal.principalType}:${principal.principalId}`)));
    const itemIds = new Set(items.map((item) => String(item.catalogItemId)));
    renderAuditMetrics([["Dashboards", items.length, "conteúdos filtrados"], ["Principais", matchingPrincipals.size, "com acesso"], ["Regras", items.reduce((total, item) => total + item.principals.length, 0), "relações configuradas"], ["Acessos", visits.filter((event) => itemIds.has(String(event.targetId))).length, "no período"]]);
    target.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Dashboard</th><th>Área</th><th>Usuários e grupos</th><th>Acessos</th><th>Segurança</th></tr></thead><tbody>${items.map((dashboard) => `<tr><td><strong>${escapeHtml(dashboard.dashboardName)}</strong></td><td>${escapeHtml(dashboard.departmentName || "Geral")}</td><td>${dashboard.principals.length}</td><td>${visits.filter((event) => String(event.targetId) === String(dashboard.catalogItemId)).length}</td><td><button class="button button-secondary button-small" data-diagnose="${dashboard.catalogItemId}">Verificar RLS</button></td></tr>`).join("") || '<tr><td colspan="5">Nenhum dashboard encontrado.</td></tr>'}</tbody></table></div>`;
    return;
  }

  const items = state.auditEvents.filter((event) => (!filters.action || event.action === filters.action) && (!filters.dashboard || String(event.targetId) === filters.dashboard) && withinPeriod(event.createdAt, filters.from, filters.to) && (!query || `${event.actorUpn || ""} ${actionLabels[event.action] || event.action} ${dashboardName(event.targetId)}`.toLowerCase().includes(query)));
  const actors = new Set(items.map((event) => event.actorObjectId || event.actorUpn).filter(Boolean));
  const dashboards = new Set(items.filter((event) => event.targetType === "catalog_item").map((event) => event.targetId));
  renderAuditMetrics([["Dashboards", dashboards.size, "mencionados"], ["Atores", actors.size, "identidades distintas"], ["Eventos", items.length, "registros filtrados"], ["Acessos", items.filter((event) => event.action === "dashboard.accessed").length, "visualizações"]]);
  target.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Data e hora</th><th>Evento</th><th>Ator</th><th>Alvo</th><th>Detalhes</th></tr></thead><tbody>${items.map((event) => `<tr><td>${date(event.createdAt)}</td><td><span class="event-label">${escapeHtml(actionLabels[event.action] || event.action)}</span></td><td>${escapeHtml(event.actorUpn || "Sistema")}</td><td>${escapeHtml(event.targetType === "catalog_item" ? dashboardName(event.targetId) : event.targetType)}</td><td><button class="button button-secondary button-small" data-audit-details="${event.id}">Visualizar</button></td></tr>`).join("") || '<tr><td colspan="5">Nenhum evento encontrado.</td></tr>'}</tbody></table></div>`;
}

function auditDetailsHtml(event) {
  const details = event.details || { kind: "generic" };
  let content = '<div class="detail-empty">Este evento não possui alterações estruturadas para exibição.</div>';
  if (details.changes?.length) content = `<div class="change-list">${details.changes.map((change) => `<div class="change-item"><strong>${escapeHtml({ name: "Nome", description: "Descrição", departmentName: "Área", isActive: "Status", label: "Rótulo" }[change.field] || change.field)}</strong><div><span>Antes</span><code>${escapeHtml(String(change.before ?? "Não informado"))}</code></div><div><span>Depois</span><code>${escapeHtml(String(change.after ?? "Não informado"))}</code></div></div>`).join("")}</div>`;
  if (details.accessRules) {
    const groups = [["Adicionados", details.accessRules.added], ["Removidos", details.accessRules.removed], ["Papéis alterados", details.accessRules.updated]];
    content = `<div class="rule-groups">${groups.map(([label, rules]) => `<section><h3>${label}</h3>${rules?.length ? rules.map((rule) => `<div class="rule-change"><strong>${escapeHtml(rule.principalName)}</strong><span>${principalTypeLabel(rule.principalType)}</span><small>${escapeHtml(rule.rlsRoles?.join(", ") || `${rule.beforeRlsRoles?.join(", ") || "Sem papel"} → ${rule.afterRlsRoles?.join(", ") || "Sem papel"}`)}</small></div>`).join("") : '<p class="muted">Nenhuma alteração.</p>'}</section>`).join("")}</div>`;
  }
  return `<div class="dialog-heading"><p class="eyebrow">${escapeHtml(actionLabels[event.action] || event.action)}</p><h2>Detalhes da auditoria</h2><p class="muted">${date(event.createdAt)} por ${escapeHtml(event.actorUpn || "Sistema")}</p></div>${content}`;
}

function brandingPreviewCard(theme, assets = []) {
  const previewLogo = assets.find((asset) => ["squareLogo", "bannerLogo"].includes(asset.type))?.previewUrl;
  const style = `--preview-accent:${escapeHtml(theme.accent || "#1f4e78")};--preview-canvas:${escapeHtml(theme.canvas || "#f1f5f9")};--preview-surface:${escapeHtml(theme.surface || "#ffffff")};--preview-text:${escapeHtml(theme.text || "#172235")};--preview-radius:${Number(theme.radius || 12)}px`;
  return `<div class="brand-preview" style="${style}"><div class="brand-preview-bar">${previewLogo ? `<img src="${previewLogo}" alt="Logo detectado">` : `<span>${escapeHtml(theme.logoText || "BI")}</span>`}<strong>${escapeHtml(theme.productName || "Portal Analytics")}</strong></div><div class="brand-preview-body"><small>VISÃO GERAL</small><h3>Indicadores em contexto</h3><p>${escapeHtml(theme.signInPageText || "Uma amostra de como a identidade será aplicada ao portal.")}</p><span class="preview-action">Abrir relatório</span></div></div>`;
}

function settingsView() {
  const config = state.config; const theme = config.tenant.theme || {};
  app.innerHTML = shell(`<main class="container" id="main"><header class="page-head"><div><p class="eyebrow">Ambiente e identidade</p><h1>Configuração do portal</h1><p class="lead">Personalize cada tenant sem alterar código e, quando disponível, reutilize a identidade já publicada no Microsoft Entra.</p></div></header>
    <div class="settings-layout"><section class="panel"><div class="panel-heading"><div><p class="eyebrow">White label</p><h2>Identidade visual</h2></div><span class="source-badge">${theme.brandingSource === "entra" ? "Sincronizada do Entra" : "Personalizada"}</span></div>
      <form id="branding-form"><div class="form-grid"><div class="field field-wide"><label for="brand-product-name">Nome do produto</label><input id="brand-product-name" name="productName" maxlength="80" required value="${escapeHtml(theme.productName || config.tenant.name)}"></div><div class="field"><label for="brand-logo-text">Sigla</label><input id="brand-logo-text" name="logoText" maxlength="4" required value="${escapeHtml(theme.logoText || initials(theme.productName || config.tenant.name))}"></div><div class="field"><label for="brand-radius">Raio dos elementos</label><input id="brand-radius" name="radius" type="number" min="4" max="24" value="${Number(theme.radius || 12)}"></div>
      ${[["accent","Destaque",theme.accent||"#1f4e78"],["canvas","Fundo",theme.canvas||"#f1f5f9"],["surface","Superfície",theme.surface||"#ffffff"],["text","Texto",theme.text||"#172235"],["muted","Texto secundário",theme.muted||"#66758a"]].map(([name,label,value]) => `<div class="field color-field"><label for="brand-${name}">${label}</label><div><input id="brand-${name}" name="${name}" type="color" value="${escapeHtml(value)}"><code>${escapeHtml(value)}</code></div></div>`).join("")}
      <div class="field field-wide"><label for="brand-signin-text">Mensagem de entrada</label><textarea id="brand-signin-text" name="signInPageText" rows="3" maxlength="280">${escapeHtml(theme.signInPageText || "")}</textarea></div></div>
      <div class="button-row split-actions"><button class="button button-secondary" type="button" data-preview-entra ${config.auth.azureConfigured ? "" : "disabled"}>Importar do Microsoft Entra</button><button class="button button-primary" type="submit">Salvar identidade</button></div></form></section>
      <aside><div class="preview-sticky"><p class="eyebrow">Pré-visualização</p><div id="branding-live-preview">${brandingPreviewCard(theme)}</div><div class="panel integration-card"><h2>Integrações</h2><p><span class="status">Microsoft Entra ID: ${config.auth.azureConfigured ? "configurado" : "pendente"}</span></p><p><span class="status">Estratégia Power BI: ${escapeHtml(config.powerBi.strategy)}</span></p><p class="muted">A importação é somente leitura. Segredos permanecem nas variáveis protegidas do Worker.</p></div></div></aside></div>
      <dialog id="branding-dialog" class="detail-dialog branding-dialog"><div class="dialog-heading modal-heading"><div><p class="eyebrow">Microsoft Entra</p><h2>Revisar identidade do tenant</h2><p class="muted">Confira os elementos detectados antes de substituir a configuração visual atual.</p></div><button class="icon-button" type="button" data-close-branding aria-label="Fechar">${icon("close")}</button></div><div id="branding-import-content" class="loading">Consultando o Microsoft Graph...</div><div class="dialog-actions"><button class="button button-quiet" type="button" data-close-branding>Cancelar</button><button class="button button-primary" type="button" data-apply-entra disabled>Aplicar identidade</button></div></dialog>
    </main>`, "settings");
}

function route() {
  state.route = location.hash || "#catalog";
  if (!state.user) return loginView();
  if (state.route === "#admin") return adminView();
  if (state.route === "#audit") return auditView();
  if (state.route === "#settings") return settingsView();
  catalogView();
}

async function loadPortalData() {
  state.loading = true; route();
  try {
    const [catalog, departments] = await Promise.all([api("/api/bi/catalog"), api("/api/bi/departments")]);
    state.catalog = catalog.items; state.departments = departments.items;
  } catch (error) { if (error.status === 401) state.user = null; else toast(error.message); }
  state.loading = false; route();
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button, a"); if (!target) return;
  if (target.dataset.route) {
    const nextHash = `#${target.dataset.route}`;
    if (location.hash === nextHash) route(); else location.hash = nextHash;
  }
  if (target.dataset.department) { document.querySelectorAll(".chip").forEach((chip) => chip.classList.toggle("active", chip === target)); renderCatalogItems(); }
  if (target.dataset.openReport) await openReport(Number(target.dataset.openReport));
  if (target.dataset.devLogin) { target.disabled = true; try { await api("/api/auth/dev", { method: "POST", body: JSON.stringify({ role: target.dataset.devLogin }) }); await init(); } catch (error) { toast(error.message); target.disabled = false; } }
  if (target.dataset.logout !== undefined) { await api("/api/auth/logout", { method: "POST" }); state.user = null; route(); }
  if (target.dataset.fullscreen !== undefined) document.querySelector(".viewer")?.requestFullscreen?.();
  if (target.dataset.reload !== undefined) location.reload();
  if (target.dataset.togglePublisher !== undefined) {
    const panel = document.querySelector("#publisher-panel");
    if (panel?.tagName === "DIALOG") panel.close(); else if (panel) panel.hidden = true;
  }
  if (target.dataset.configSection !== undefined) {
    const selector = target.dataset.configSection === "access" ? ".config-access-section" : "#department-id";
    document.querySelector(selector)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    document.querySelectorAll("[data-config-section]").forEach((button) => button.classList.toggle("is-current", button === target));
  }
  if (target.dataset.closeBranding !== undefined) document.querySelector("#branding-dialog")?.close();
  if (target.dataset.closeDialog !== undefined) target.closest("dialog")?.close();
  if (target.dataset.previewEntra !== undefined) {
    const dialog = document.querySelector("#branding-dialog"); const content = document.querySelector("#branding-import-content"); const apply = document.querySelector("[data-apply-entra]");
    if (!dialog || !content || !apply) return;
    state.brandingPreview = null; content.className = "loading"; content.textContent = "Consultando o Microsoft Graph..."; apply.disabled = true; dialog.showModal(); setBusy(target, true);
    try {
      const preview = await api("/api/admin/branding/import-entra?mode=preview", { method: "POST" }); state.brandingPreview = preview;
      content.className = "branding-import-preview"; content.innerHTML = `${brandingPreviewCard(preview.theme, preview.assets)}<div class="asset-summary"><strong>${preview.assets.length} ativo(s) visual(is) encontrado(s)</strong><p>${preview.assets.map((asset) => `${escapeHtml(asset.type)} · ${Math.ceil(asset.size / 1024)} KB`).join(" · ") || "Somente propriedades textuais e cores foram encontradas."}</p>${preview.notes?.length ? `<small>${escapeHtml(preview.notes.join("; "))}</small>` : ""}</div>`;
      apply.disabled = false;
    } catch (error) { content.className = "error-state compact-state"; content.innerHTML = `<div><h3>Importação indisponível</h3><p>${escapeHtml(error.message)}</p></div>`; }
    finally { setBusy(target, false); }
  }
  if (target.dataset.applyEntra !== undefined) {
    setBusy(target, true);
    try {
      await api("/api/admin/branding/import-entra", { method: "POST" });
      state.config = await api("/api/config"); applyTheme(); document.querySelector("#branding-dialog")?.close(); toast("Identidade do Microsoft Entra aplicada."); settingsView();
    } catch (error) { toast(error.message); } finally { setBusy(target, false); }
  }
  if (target.dataset.newReport !== undefined) await openReportConfig();
  if (target.dataset.configureReport) await openReportConfig(state.adminCatalog.find((item) => item.id === Number(target.dataset.configureReport)));
  if (target.dataset.manageAccess) await openAccessConfig(Number(target.dataset.manageAccess));
  if (target.dataset.newDepartment !== undefined) document.querySelector("#new-department-field").hidden = false;
  if (target.dataset.createDepartment !== undefined) {
    const input = document.querySelector("#new-department-name"); const name = input.value.trim();
    if (!name) return input.focus();
    target.disabled = true;
    try {
      const created = (await api("/api/bi/admin/departments", { method: "POST", body: JSON.stringify({ name }) })).item;
      state.departments.push(created);
      const select = document.querySelector("#department-id"); select.insertAdjacentHTML("beforeend", `<option value="${created.id}">${escapeHtml(created.name)}</option>`); select.value = created.id;
      document.querySelector("#new-department-field").hidden = true; input.value = ""; toast("Área criada.");
    } catch (error) { toast(error.message); } finally { target.disabled = false; }
  }
  if (target.dataset.loadWorkspaces !== undefined) await loadPowerBiWorkspaces(document.querySelector("#workspace-id")?.value || "");
  if (target.dataset.inspectRls !== undefined) await inspectCurrentRls();
  if (target.dataset.removeAccess !== undefined) { state.accessDraft.splice(Number(target.dataset.removeAccess), 1); renderAccessDraft(); }
  if (target.dataset.selectCatalogPrincipal !== undefined) {
    state.catalogPrincipal = { id: target.dataset.selectCatalogPrincipal, displayName: target.dataset.name, type: target.dataset.type };
    document.querySelectorAll("#catalog-principal-results .principal-option").forEach((option) => option.classList.toggle("is-selected", option === target));
    const add = document.querySelector("[data-add-catalog-access]"); if (add) add.disabled = false;
  }
  if (target.dataset.addCatalogAccess !== undefined) {
    if (!state.catalogPrincipal) return toast("Selecione um usuário ou grupo.");
    const roles = [...document.querySelectorAll("#catalog-role-options input:checked")].map((input) => input.value);
    if (state.rlsInspection?.rlsConfigured && !roles.length) return toast("Selecione ao menos um papel RLS para este acesso.");
    const rule = { principalId: state.catalogPrincipal.id, principalName: state.catalogPrincipal.displayName, principalType: state.catalogPrincipal.type, rlsRoles: roles };
    const existing = state.catalogAccessDraft.findIndex((item) => item.principalId === rule.principalId);
    if (existing >= 0) state.catalogAccessDraft[existing] = rule; else state.catalogAccessDraft.push(rule);
    state.catalogPrincipal = null; document.querySelector("#catalog-principal-search").value = ""; document.querySelector("#catalog-principal-results").hidden = true; target.disabled = true; renderCatalogRoleOptions(); renderCatalogAccessDraft();
  }
  if (target.dataset.removeCatalogAccess !== undefined) { state.catalogAccessDraft.splice(Number(target.dataset.removeCatalogAccess), 1); renderCatalogAccessDraft(); }
  if (target.dataset.closeAccess !== undefined) document.querySelector("#access-dialog")?.close();
  if (target.dataset.saveAccess !== undefined) {
    if (!state.rlsInspection) return toast("A inspeção de RLS precisa ser concluída antes de salvar.");
    if (state.rlsInspection.rlsConfigured && state.accessDraft.some((rule) => !rule.rlsRoles?.length)) return toast("Todos os acessos precisam de ao menos um papel RLS.");
    target.disabled = true;
    try {
      await api(`/api/bi/admin/catalog/${state.editingReportId}/access-rules`, { method: "PUT", body: JSON.stringify({ rules: state.accessDraft }) });
      toast("Regras de acesso atualizadas."); document.querySelector("#access-dialog").close();
    } catch (error) { toast(error.message); } finally { target.disabled = false; }
  }
  if (target.dataset.auditTab) { state.auditTab = target.dataset.auditTab; renderAuditContent(); }
  if (target.dataset.refreshAudit !== undefined) await loadAudit();
  if (target.dataset.auditDetails) {
    const selected = state.auditEvents.find((item) => String(item.id) === target.dataset.auditDetails);
    const dialog = document.querySelector("#audit-dialog");
    if (selected && dialog) { document.querySelector("#audit-dialog-content").innerHTML = auditDetailsHtml(selected); dialog.showModal(); }
  }
  if (target.dataset.diagnose) {
    target.disabled = true;
    try {
      const result = await api(`/api/bi/admin/reports/${target.dataset.diagnose}/rls-diagnostics`);
      const dialog = document.querySelector("#audit-dialog");
      const warnings = result.warnings || [];
      document.querySelector("#audit-dialog-content").innerHTML = `<div class="dialog-heading"><p class="eyebrow">Diagnóstico RLS</p><h2>${warnings.length ? "Atenção ao acesso do workspace" : "Nenhum desvio encontrado"}</h2><p class="muted">${warnings.length ? "Papéis elevados no workspace podem ignorar as regras RLS do modelo semântico." : "Não foram encontrados papéis elevados que permitam contornar o RLS."}</p></div>${warnings.length ? `<div class="warning-list">${warnings.map((warning) => `<div><strong>${escapeHtml(warning.principalName)}</strong><span>${escapeHtml(warning.accessRight)}</span></div>`).join("")}</div>` : ""}`;
      dialog.showModal();
    } catch (error) { toast(error.message); } finally { target.disabled = false; }
  }
});

document.addEventListener("input", (event) => {
  if (event.target.id === "catalog-search") renderCatalogItems();
  if (event.target.id === "admin-search") renderAdminRows();
  if (event.target.closest?.("#audit-filter-form")) renderAuditTable();
  if (event.target.id === "principal-search") {
    clearTimeout(principalSearchTimer);
    principalSearchTimer = setTimeout(() => searchPrincipals(event.target.value), 260);
  }
  if (event.target.id === "catalog-principal-search") {
    clearTimeout(principalSearchTimer); state.catalogPrincipal = null;
    const add = document.querySelector("[data-add-catalog-access]"); if (add) add.disabled = true;
    principalSearchTimer = setTimeout(() => searchPrincipals(event.target.value, "catalog"), 260);
  }
  if (event.target.closest?.("#branding-form")) {
    const form = event.target.closest("form"); const values = Object.fromEntries(new FormData(form));
    document.querySelectorAll(".color-field").forEach((field) => { const input = field.querySelector("input[type=color]"); const code = field.querySelector("code"); if (input && code) code.textContent = input.value; });
    const preview = document.querySelector("#branding-live-preview"); if (preview) preview.innerHTML = brandingPreviewCard(values);
  }
});
document.addEventListener("change", async (event) => {
  if (event.target.id === "theme-mode") { setThemeMode(event.target.value); return; }
  if (event.target.closest?.("#audit-filter-form")) renderAuditTable();
  if (event.target.id === "workspace-id" && event.target.tagName === "SELECT") { state.rlsInspection = null; await loadPowerBiReports(event.target.value); }
  if (event.target.id === "report-id" && event.target.tagName === "SELECT") syncSelectedProviderReport();
  if (["workspace-id","report-id","dataset-id"].includes(event.target.id) && event.target.tagName !== "SELECT") state.rlsInspection = null;
});
document.addEventListener("submit", async (event) => {
  if (event.target.id === "branding-form") {
    event.preventDefault(); const button = event.target.querySelector("button[type=submit]"); setBusy(button, true);
    try {
      const theme = Object.fromEntries(new FormData(event.target)); theme.radius = Number(theme.radius);
      const result = await api("/api/admin/branding", { method: "PATCH", body: JSON.stringify({ theme }) });
      state.config.tenant.theme = result.theme; applyTheme(); toast("Identidade visual atualizada."); settingsView();
    } catch (error) { toast(error.message); } finally { setBusy(button, false); }
    return;
  }
  if (event.target.id === "access-rule-draft") {
    event.preventDefault();
    const select = document.querySelector("#principal-results"); const option = select.options[select.selectedIndex];
    if (!option) return toast("Selecione um usuário ou grupo encontrado na pesquisa.");
    const roles = [...document.querySelectorAll("#access-role-options input:checked")].map((input) => input.value);
    if (state.rlsInspection?.rlsConfigured && !roles.length) return toast("Selecione ao menos um papel RLS.");
    const rule = { principalId: option.value, principalName: option.dataset.name, principalType: option.dataset.type, rlsRoles: roles };
    const existing = state.accessDraft.findIndex((item) => item.principalId === rule.principalId);
    if (existing >= 0) state.accessDraft[existing] = rule; else state.accessDraft.push(rule);
    renderAccessDraft(); event.target.reset(); select.hidden = true; renderAccessRoleOptions(); return;
  }
  if (event.target.id !== "catalog-form") return;
  event.preventDefault();
  const button = event.target.querySelector("button[type=submit]"); button.disabled = true;
  try {
    if (!state.rlsInspection) {
      const inspected = await inspectCurrentRls();
      if (!inspected) throw new Error("A configuração não pode ser salva enquanto o Power BI não confirmar o estado de RLS.");
    }
    if (state.rlsInspection.rlsConfigured && state.catalogAccessDraft.some((rule) => !rule.rlsRoles?.length)) throw new Error("Revise os acessos preparados e selecione ao menos um papel RLS para cada principal.");
    const body = Object.fromEntries(new FormData(event.target)); body.isActive = event.target.elements.isActive.checked;
    const editing = Boolean(state.editingReportId);
    const desiredActive = body.isActive; if (!editing && state.catalogAccessDraft.length) body.isActive = false;
    const saved = await api(editing ? `/api/bi/admin/catalog/${state.editingReportId}` : "/api/bi/admin/catalog", { method: editing ? "PATCH" : "POST", body: JSON.stringify(body) });
    const reportId = editing ? state.editingReportId : Number(saved.id); state.editingReportId = reportId;
    if (editing || state.catalogAccessDraft.length) await api(`/api/bi/admin/catalog/${reportId}/access-rules`, { method: "PUT", body: JSON.stringify({ rules: state.catalogAccessDraft }) });
    if (!editing && state.catalogAccessDraft.length && desiredActive) await api(`/api/bi/admin/catalog/${reportId}`, { method: "PATCH", body: JSON.stringify({ isActive: true }) });
    event.target.reset(); const panel = document.querySelector("#publisher-panel"); if (panel?.tagName === "DIALOG") panel.close(); else if (panel) panel.hidden = true; toast(editing ? "Configurações atualizadas." : "Relatório adicionado ao catálogo.");
    await loadPortalData();
  } catch (error) { toast(error.message); } finally { button.disabled = false; }
});
window.addEventListener("hashchange", route);
new MutationObserver((entries) => entries.forEach((entry) => entry.addedNodes.forEach((node) => { if (node.nodeType === 1) decorateActions(node); }))).observe(app, { childList: true, subtree: true });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (storedThemeMode() === "system") setThemeMode("system", false); });

async function init() {
  try {
    state.config = await api("/api/config"); applyTheme();
    state.user = (await api("/api/auth/me")).user;
    if (state.user) await loadPortalData(); else route();
  } catch (error) { app.innerHTML = `<main class="container"><div class="error-state"><div><h1>Portal indisponível</h1><p>${escapeHtml(error.message)}</p><button class="button button-secondary" data-reload>Tentar novamente</button></div></div></main>`; }
}

setThemeMode(storedThemeMode(), false);
init();
