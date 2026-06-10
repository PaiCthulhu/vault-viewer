// English locale. Keys are dotted, grouped by area. To translate to another
// language, copy this file and translate the right-hand values only.
export const en: Record<string, string> = {
  // ── Common ──
  'common.save': 'Save',
  'common.saving': 'Saving…',
  'common.cancel': 'Cancel',
  'common.clear': 'Clear',
  'common.never': 'Never',

  // ── Topbar ──
  'topbar.logout': 'Log out',
  'topbar.admin': 'Admin',
  'topbar.userBadge': '👤 {username}',
  'topbar.openSidebar': 'Open sidebar',
  'topbar.openGraph': 'Open graph',

  // ── Side panels (resize / collapse) ──
  'panel.resize': 'Drag to resize',
  'panel.collapseSidebar': 'Collapse sidebar',
  'panel.expandSidebar': 'Expand sidebar',
  'panel.collapseGraph': 'Collapse graph panel',
  'panel.expandGraph': 'Expand graph panel',

  // ── Theme toggle ──
  'theme.toggle': 'Toggle theme',
  'theme.light': '☀ Light',
  'theme.dark': '🌙 Dark',

  // ── Language toggle ──
  'lang.toggle': 'Language',

  // ── Sidebar ──
  'sidebar.search': 'Search page…',
  'sidebar.expandAll': '⊞ Expand all',
  'sidebar.collapseAll': '⊟ Collapse all',
  'sidebar.expandAllTitle': 'Expand all',
  'sidebar.collapseAllTitle': 'Collapse all',
  'sidebar.globalGraph': '🕸 View global graph',
  'sidebar.globalGraphTitle': 'View global graph',

  // ── Graph ──
  'graph.local': 'Local graph',
  'graph.global': 'Global graph',
  'graph.noConnections': 'No connections',
  'graph.expand': 'Expand graph',
  'graph.close': 'Close',
  'graph.closeEsc': 'Close (Esc)',
  'graph.closeLabel': '✕ Close',
  'graph.loading': 'Loading {count} nodes…',

  // ── Table of contents ──
  'toc.title': 'Contents',

  // ── Backlinks ──
  'backlinks.title': 'Mentioned in',
  'backlinks.empty': 'No mentions.',

  // ── Properties block (label injected client-side over the built HTML) ──
  'properties.title': 'Properties',

  // ── Dataview: gallery filters ──
  'content.filters': '⚙ Filters',
  'content.addFilter': '+ Add filter',
  'content.allValues': 'all',
  'content.removeFilter': 'Remove {key} filter',
  'content.itemCountOne': '{count} item',
  'content.itemCountMany': '{count} items',

  // ── Dataview: interactive table / list ──
  'dv.filterTable': 'Filter table…',
  'dv.filterList': 'Filter list…',
  'dv.resultsOne': '{count} result',
  'dv.resultsMany': '{count} results',
  'dv.itemsOne': '{count} item',
  'dv.itemsMany': '{count} items',

  // ── Vault list ──
  'vaultList.title': 'Your Vaults',
  'vaultList.subtitle': 'Pick a vault to start exploring',
  'vaultList.empty': 'No vaults available. Ask an admin to grant access.',

  // ── Vault card ──
  'vaultCard.neverBuilt': 'Never built',
  'vaultCard.justNow': 'Just now',
  'vaultCard.minutesAgo': '{n}m ago',
  'vaultCard.hoursAgo': '{n}h ago',
  'vaultCard.daysAgo': '{n}d ago',
  'vaultCard.notes': '📄 {n} notes',
  'vaultCard.folders': '📁 {n} folders',
  'vaultCard.open': 'Open vault →',

  // ── Admin: navigation ──
  'admin.nav.section': 'Administration',
  'admin.nav.users': '👥 Users',
  'admin.nav.vaults': '📚 Vaults',
  'admin.nav.back': '↩ Back to viewer',

  // ── Admin: users ──
  'admin.users.title': 'Users',
  'admin.users.new': '+ New user',
  'admin.users.colUser': 'User',
  'admin.users.colRole': 'Role',
  'admin.users.colVaults': 'Vaults with access',
  'admin.users.colCreated': 'Created',
  'admin.users.roleAdmin': 'Admin',
  'admin.users.roleReader': 'Reader',
  'admin.users.allVaults': 'All (admin)',
  'admin.users.noVaults': 'None',

  // ── Admin: user detail panel ──
  'admin.userDetail.editTitle': 'Edit — {name}',
  'admin.userDetail.newTitle': 'New user',
  'admin.userDetail.username': 'Username',
  'admin.userDetail.newPassword': 'New password (blank = keep)',
  'admin.userDetail.password': 'Password',
  'admin.userDetail.vaultsAccess': 'Vault access',
  'admin.userDetail.required': 'Username and password are required',
  'admin.userDetail.deleteConfirm': 'Delete user "{name}"?',
  'admin.userDetail.delete': '🗑 Delete user',

  // ── Admin: vaults ──
  'admin.vaults.title': 'Vaults',
  'admin.vaults.new': '+ New vault',
  'admin.vaults.colName': 'Name',
  'admin.vaults.colPath': 'Path',
  'admin.vaults.colHome': 'Home page',
  'admin.vaults.colPages': 'Pages',
  'admin.vaults.colLastBuild': 'Last build',

  // ── Admin: vault detail panel ──
  'admin.vaultDetail.editTitle': 'Edit — {name}',
  'admin.vaultDetail.newTitle': 'New vault',
  'admin.vaultDetail.name': 'Name',
  'admin.vaultDetail.slug': 'Slug',
  'admin.vaultDetail.slugHelpNew': 'Generated automatically from the name.',
  'admin.vaultDetail.slugHelpExisting': 'Immutable — it is the data key.',
  'admin.vaultDetail.path': 'Path',
  'admin.vaultDetail.pathHelp': 'Absolute path to the vault folder on the server.',
  'admin.vaultDetail.home': 'Home page',
  'admin.vaultDetail.homeHelp': 'Filename (or title) of the home page. E.g.: 00_Index',
  'admin.vaultDetail.description': 'Description',
  'admin.vaultDetail.cover': 'Cover image',
  'admin.vaultDetail.coverHelp': 'Relative path to the image inside the vault (or empty).',
  'admin.vaultDetail.titleProp': 'Title property',
  'admin.vaultDetail.titlePropPlaceholder': 'Filename (default)',
  'admin.vaultDetail.titlePropHelp': 'Empty = use the filename. E.g.: "title" uses the frontmatter property.',
  'admin.vaultDetail.coverProp': 'Cover property',
  'admin.vaultDetail.coverPropHelp': 'Frontmatter property holding the cover image (e.g.: cover, banner). _x and _y are derived from it.',
  'admin.vaultDetail.requiredNamePath': 'Name and path are required',
  'admin.vaultDetail.saveFailed': 'Save failed',
  'admin.vaultDetail.saveNetworkError': 'Network error while saving',
  'admin.vaultDetail.buildDone': 'Build complete.{tail}',
  'admin.vaultDetail.buildFailed': 'Build failed: {detail}',
  'admin.vaultDetail.buildNetworkError': 'Network error during build',
  'admin.vaultDetail.rebuilding': 'Building…',
  'admin.vaultDetail.rebuild': 'Regenerate build',
  'admin.vaultDetail.rebuildDisabled': 'Save the vault before building.',
  'admin.vaultDetail.deleteConfirm': 'Delete vault "{name}"? This removes it from the config and deletes its build data (data/{slug}).',
  'admin.vaultDetail.deleteFailed': 'Delete failed',
  'admin.vaultDetail.deleteNetworkError': 'Network error while deleting',
  'admin.vaultDetail.delete': '🗑 Delete vault',

  // ── Login ──
  'login.title': 'Vault Viewer',
  'login.tagline': 'Your knowledge, organized and accessible anywhere.',
  'login.heading': 'Sign in',
  'login.subtitle': 'Use your access credentials',
  'login.username': 'Username',
  'login.password': 'Password',
  'login.submit': 'Sign in →',
  'login.submitting': 'Signing in…',
  'login.invalid': 'Invalid username or password',

  'admin.vaultDetail.buildFailedDefault': 'Build failed',
}
