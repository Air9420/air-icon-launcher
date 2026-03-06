import { createMemoryHistory, createRouter } from 'vue-router'

const Categories = () => import('../views/categories.vue')
const Category = () => import('../views/category.vue')
const LauncherItemEdit = () => import('../views/launcher-item-edit.vue')
const Settings = () => import('../views/settings.vue')
const ClipboardHistory = () => import('../components/ClipboardHistory.vue')
const Plugins = () => import('../views/plugins.vue')



const routes = [
    { path: '/', redirect: '/categories' },
    { path: '/categories', component: Categories },
    { path: '/category/:categoryId', name: 'category', component: Category, props: true },
    { path: '/category/:categoryId/item/:itemId/edit', name: 'launcher-item-edit', component: LauncherItemEdit, props: true },
    { path: '/settings', name: 'settings', component: Settings },
    { path: '/clipboard', name: 'clipboard', component: ClipboardHistory },
    { path: '/plugins', name: 'plugins', component: Plugins },
]

const router = createRouter({
    history: createMemoryHistory(),
    routes,
})

export default router
