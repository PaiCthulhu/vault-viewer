// Locale pt-BR (Português do Brasil). Mesmas chaves de en.ts.
export const ptBR: Record<string, string> = {
  // ── Common ──
  'common.save': 'Salvar',
  'common.saving': 'Salvando…',
  'common.cancel': 'Cancelar',
  'common.clear': 'Limpar',
  'common.never': 'Nunca',

  // ── Topbar ──
  'topbar.logout': 'Sair',
  'topbar.admin': 'Admin',
  'topbar.userBadge': '👤 {username}',
  'topbar.openSidebar': 'Abrir sidebar',
  'topbar.openGraph': 'Abrir grafo',

  // ── Side panels (resize / collapse) ──
  'panel.resize': 'Arraste para redimensionar',
  'panel.collapseSidebar': 'Recolher sidebar',
  'panel.expandSidebar': 'Expandir sidebar',
  'panel.collapseGraph': 'Recolher painel do grafo',
  'panel.expandGraph': 'Expandir painel do grafo',

  // ── Theme toggle ──
  'theme.toggle': 'Alternar tema',
  'theme.light': '☀ Claro',
  'theme.dark': '🌙 Escuro',

  // ── Language toggle ──
  'lang.toggle': 'Idioma',

  // ── Sidebar ──
  'sidebar.search': 'Buscar página…',
  'sidebar.expandAll': '⊞ Expandir tudo',
  'sidebar.collapseAll': '⊟ Recolher tudo',
  'sidebar.expandAllTitle': 'Expandir tudo',
  'sidebar.collapseAllTitle': 'Recolher tudo',
  'sidebar.globalGraph': '🕸 Ver grafo geral',
  'sidebar.globalGraphTitle': 'Ver grafo geral',

  // ── Graph ──
  'graph.local': 'Grafo local',
  'graph.global': 'Grafo geral',
  'graph.noConnections': 'Sem conexões',
  'graph.expand': 'Expandir grafo',
  'graph.close': 'Fechar',
  'graph.closeEsc': 'Fechar (Esc)',
  'graph.closeLabel': '✕ Fechar',
  'graph.loading': 'Carregando {count} nós…',

  // ── Table of contents ──
  'toc.title': 'Índice',

  // ── Backlinks ──
  'backlinks.title': 'Mencionado em',
  'backlinks.empty': 'Nenhuma menção.',

  // ── Properties block ──
  'properties.title': 'Propriedades',

  // ── Dataview: filtros de galeria ──
  'content.filters': '⚙ Filtros',
  'content.addFilter': '+ Adicionar filtro',
  'content.allValues': 'todas',
  'content.removeFilter': 'Remover filtro {key}',
  'content.itemCountOne': '{count} item',
  'content.itemCountMany': '{count} itens',

  // ── Dataview: tabela / lista interativa ──
  'dv.filterTable': 'Filtrar tabela…',
  'dv.filterList': 'Filtrar lista…',
  'dv.resultsOne': '{count} resultado',
  'dv.resultsMany': '{count} resultados',
  'dv.itemsOne': '{count} item',
  'dv.itemsMany': '{count} itens',

  // ── Lista de vaults ──
  'vaultList.title': 'Seus Vaults',
  'vaultList.subtitle': 'Selecione um vault para começar a explorar',
  'vaultList.empty': 'Nenhum vault disponível. Peça ao admin para conceder acesso.',

  // ── Card de vault ──
  'vaultCard.neverBuilt': 'Nunca buildado',
  'vaultCard.justNow': 'Agora mesmo',
  'vaultCard.minutesAgo': 'Há {n}min',
  'vaultCard.hoursAgo': 'Há {n}h',
  'vaultCard.daysAgo': 'Há {n}d',
  'vaultCard.notes': '📄 {n} notas',
  'vaultCard.folders': '📁 {n} pastas',
  'vaultCard.open': 'Abrir vault →',

  // ── Admin: navegação ──
  'admin.nav.section': 'Administração',
  'admin.nav.users': '👥 Usuários',
  'admin.nav.vaults': '📚 Vaults',
  'admin.nav.back': '↩ Voltar ao Viewer',

  // ── Admin: usuários ──
  'admin.users.title': 'Usuários',
  'admin.users.new': '+ Novo usuário',
  'admin.users.colUser': 'Usuário',
  'admin.users.colRole': 'Função',
  'admin.users.colVaults': 'Vaults com acesso',
  'admin.users.colCreated': 'Criado em',
  'admin.users.roleAdmin': 'Admin',
  'admin.users.roleReader': 'Leitor',
  'admin.users.allVaults': 'Todos (admin)',
  'admin.users.noVaults': 'Nenhum',

  // ── Admin: painel de detalhe do usuário ──
  'admin.userDetail.editTitle': 'Editar — {name}',
  'admin.userDetail.newTitle': 'Novo usuário',
  'admin.userDetail.username': 'Nome de usuário',
  'admin.userDetail.newPassword': 'Nova senha (em branco = manter)',
  'admin.userDetail.password': 'Senha',
  'admin.userDetail.vaultsAccess': 'Acesso aos vaults',
  'admin.userDetail.required': 'Username e senha são obrigatórios',
  'admin.userDetail.deleteConfirm': 'Deletar usuário "{name}"?',
  'admin.userDetail.delete': '🗑 Excluir usuário',

  // ── Admin: vaults ──
  'admin.vaults.title': 'Vaults',
  'admin.vaults.new': '+ Novo vault',
  'admin.vaults.colName': 'Nome',
  'admin.vaults.colPath': 'Caminho',
  'admin.vaults.colHome': 'Página inicial',
  'admin.vaults.colPages': 'Páginas',
  'admin.vaults.colLastBuild': 'Último build',

  // ── Admin: painel de detalhe do vault ──
  'admin.vaultDetail.editTitle': 'Editar — {name}',
  'admin.vaultDetail.newTitle': 'Novo vault',
  'admin.vaultDetail.name': 'Nome',
  'admin.vaultDetail.slug': 'Slug',
  'admin.vaultDetail.slugHelpNew': 'Gerado automaticamente a partir do nome.',
  'admin.vaultDetail.slugHelpExisting': 'Imutável — é a chave dos dados.',
  'admin.vaultDetail.path': 'Caminho',
  'admin.vaultDetail.pathHelp': 'Caminho absoluto da pasta do vault no servidor.',
  'admin.vaultDetail.home': 'Página inicial',
  'admin.vaultDetail.homeHelp': 'Nome do arquivo (ou título) da home. Ex.: 00_Index',
  'admin.vaultDetail.description': 'Descrição',
  'admin.vaultDetail.cover': 'Imagem de capa',
  'admin.vaultDetail.coverHelp': 'Caminho relativo da imagem dentro do vault (ou vazio).',
  'admin.vaultDetail.titleProp': 'Propriedade de título',
  'admin.vaultDetail.titlePropPlaceholder': 'Nome do arquivo (padrão)',
  'admin.vaultDetail.titlePropHelp': 'Vazio = usa o nome do arquivo. Ex.: "titulo" usa a propriedade do frontmatter.',
  'admin.vaultDetail.coverProp': 'Propriedade de capa',
  'admin.vaultDetail.coverPropHelp': 'Propriedade do frontmatter com a imagem de capa (ex.: cover, banner). _x e _y são derivados dela.',
  'admin.vaultDetail.requiredNamePath': 'Nome e caminho são obrigatórios',
  'admin.vaultDetail.saveFailed': 'Falha ao salvar',
  'admin.vaultDetail.saveNetworkError': 'Erro de rede ao salvar',
  'admin.vaultDetail.buildDone': 'Build concluído.{tail}',
  'admin.vaultDetail.buildFailed': 'Falha no build: {detail}',
  'admin.vaultDetail.buildNetworkError': 'Erro de rede no build',
  'admin.vaultDetail.rebuilding': 'Gerando…',
  'admin.vaultDetail.rebuild': 'Regerar build',
  'admin.vaultDetail.rebuildDisabled': 'Salve o vault antes de gerar o build.',
  'admin.vaultDetail.deleteConfirm': 'Excluir o vault "{name}"? Isso remove o vault da configuração e apaga os dados de build (data/{slug}).',
  'admin.vaultDetail.deleteFailed': 'Falha ao excluir',
  'admin.vaultDetail.deleteNetworkError': 'Erro de rede ao excluir',
  'admin.vaultDetail.delete': '🗑 Excluir vault',

  // ── Login ──
  'login.title': 'Vault Viewer',
  'login.tagline': 'Seu conhecimento organizado, acessível de qualquer lugar.',
  'login.heading': 'Entrar',
  'login.subtitle': 'Use suas credenciais de acesso',
  'login.username': 'Usuário',
  'login.password': 'Senha',
  'login.submit': 'Entrar →',
  'login.submitting': 'Entrando…',
  'login.invalid': 'Usuário ou senha inválidos',

  'admin.vaultDetail.buildFailedDefault': 'Falha no build',
}
