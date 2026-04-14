import { createMemoryHistory, createRouter } from 'vue-router'

const Categories = () => import('../views/categories.vue')
const Category = () => import('../views/category.vue')
const LauncherItemEdit = () => import('../views/launcher-item-edit.vue')
const Guide = () => import('../views/Guide.vue')
const Settings = () => import('../views/settings/index.vue')
const SettingsAppearance = () => import('../views/settings/Appearance.vue')
const SettingsShortcuts = () => import('../views/settings/Shortcuts.vue')
const SettingsWindow = () => import('../views/settings/Window.vue')
const SettingsClipboard = () => import('../views/settings/Clipboard.vue')
const SettingsFeatures = () => import('../views/settings/Features.vue')
const SettingsData = () => import('../views/settings/Data.vue')
const SettingsAbout = () => import('../views/settings/About.vue')
const SettingsStats = () => import('../views/settings/Stats.vue')
const ClipboardHistory = () => import('../components/ClipboardHistory.vue')
const Plugins = () => import('../views/plugins.vue')

const routes = [
    { path: '/', redirect: '/categories' },
    { path: '/guide', name: 'guide', component: Guide },
    { path: '/categories', component: Categories },
    { path: '/category/:categoryId', name: 'category', component: Category, props: true },
    { path: '/category/:categoryId/item/:itemId/edit', name: 'launcher-item-edit', component: LauncherItemEdit, props: true },
    { path: '/category/:categoryId/item/new', name: 'launcher-item-create', component: LauncherItemEdit, props: true },
    {
        path: '/settings',
        name: 'settings',
        component: Settings,
        redirect: '/settings/appearance',
        children: [
            { path: 'appearance', name: 'settings-appearance', component: SettingsAppearance },
            { path: 'shortcuts', name: 'settings-shortcuts', component: SettingsShortcuts },
            { path: 'window', name: 'settings-window', component: SettingsWindow },
            { path: 'clipboard', name: 'settings-clipboard', component: SettingsClipboard },
            { path: 'features', name: 'settings-features', component: SettingsFeatures },
            { path: 'data', name: 'settings-data', component: SettingsData },
            { path: 'guide', name: 'settings-guide', component: Guide },
            { path: 'about', name: 'settings-about', component: SettingsAbout },
            { path: 'stats', name: 'settings-stats', component: SettingsStats },
        ]
    },
    { path: '/clipboard', name: 'clipboard', component: ClipboardHistory },
    { path: '/plugins', name: 'plugins', component: Plugins },
]

const router = createRouter({
    history: createMemoryHistory(),
    routes,
})

export default router
