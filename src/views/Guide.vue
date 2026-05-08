<template>
    <div class="guide-page" :class="{ 'in-settings': isInSettings }" data-tauri-drag-region>
        <header v-if="!isInSettings" class="guide-header" data-tauri-drag-region>
            <div class="title" data-tauri-drag-region>使用指南</div>
        </header>

        <div class="guide-content custom-scrollbar">
            <section class="guide-section">
                <h3>
                    <Rocket size="18" weight="Bold" /> 快速启动
                </h3>
                <p>在主界面点击任意启动项即可快速打开应用程序、文件或网址。双击启动项可直接打开。</p>
            </section>

            <section class="guide-section">
                <h3>
                    <AddFolder size="18" weight="Bold" /> 添加启动项
                </h3>
                <ul>
                    <li><strong>拖拽添加：</strong>将任意文件、文件夹、快捷方式（.lnk）或可执行文件（.exe）直接拖拽到分类视图中</li>
                    <li><strong>右键菜单：</strong>在分类视图中右键，选择「添加项目」，然后选择要添加的文件</li>
                </ul>
                <p class="tip">
                    <Lightbulb size="14" weight="Bold" /> 支持同时拖拽多个文件批量添加
                </p>
            </section>

            <section class="guide-section">
                <h3>
                    <Folder size="18" weight="Bold" /> 分类管理
                </h3>
                <ul>
                    <li>点击分类卡片进入该分类的管理界面</li>
                    <li><strong>添加分类：</strong>在主界面右键菜单选择「添加类目」</li>
                    <li><strong>重命名：</strong>右键点击分类卡片选择「重命名」</li>
                    <li><strong>删除：</strong>右键点击分类卡片选择「删除」，删除分类会同时删除其中的启动项</li>
                    <li><strong>更换图标：</strong>右键点击分类卡片选择「更换图标」可自定义分类图标</li>
                    <li><strong>调整大小：</strong>右键菜单中选择「分类图标」可调整图标列数（4/5/6/7列）</li>
                </ul>
                <p class="tip">
                    <Lightbulb size="14" weight="Bold" /> 默认分类：Air、游戏、工具、系统、其他
                </p>
            </section>

            <section class="guide-section">
                <h3>
                    <Settings size="18" weight="Bold" /> 启动项管理
                </h3>
                <ul>
                    <li><strong>编辑名称：</strong>右键点击启动项选择「编辑」</li>
                    <li><strong>删除：</strong>右键点击启动项选择「删除」</li>
                    <li><strong>更换图标：</strong>右键点击启动项选择「更换图标」</li>
                    <li><strong>重置图标：</strong>如果已更换图标，可选择「重置图标」恢复原始图标</li>
                </ul>
            </section>

            <section class="guide-section">
                <h3>
                    <Pin size="18" weight="Bold" /> 固定与最近使用
                </h3>
                <ul>
                    <li><strong>固定启动项：</strong>右键点击启动项选择「固定启动项」，固定的项目会显示在首页</li>
                    <li><strong>取消固定：</strong>对已固定的启动项右键选择「取消固定启动项」</li>
                    <li><strong>最近使用：</strong>系统自动记录最近打开的启动项，按最近使用时间排序</li>
                </ul>
                <p class="tip">
                    <Lightbulb size="14" weight="Bold" /> 固定和最近使用的布局可通过右键菜单调整（行数/列数/网格/列表）
                </p>
            </section>

            <section class="guide-section">
                <h3>
                    <Translation size="18" weight="Bold" /> 智能搜索
                </h3>
                <ul>
                    <li>直接输入名称关键词进行模糊匹配</li>
                    <li>支持拼音搜索：输入 <kbd>weixin</kbd> 或 <kbd>wx</kbd> 可匹配"微信"</li>
                    <li>支持拼音首字母：输入 <kbd>w</kbd> 可匹配"微信"</li>
                    <li>搜索结果会优先展示常用应用和最近使用的项目</li>
                </ul>
            </section>

            <section class="guide-section">
                <h3>
                    <Earth size="18" weight="Bold" /> 浏览器搜索
                </h3>
                <p>当搜索无结果时，可点击「在浏览器中搜索」使用默认浏览器进行网络搜索。</p>
            </section>

            <section class="guide-section">
                <h3>
                    <Keyboard size="18" weight="Bold" /> 快捷键
                </h3>
                <ul>
                    <li><kbd>Alt + Space</kbd> - 显示/隐藏主窗口（可自定义）</li>
                    <li><kbd>Alt + V</kbd> - 打开剪贴板历史（可自定义）</li>
                    <li><kbd>Ctrl + 左键</kbd> - 拖拽窗口（可在设置中关闭）</li>
                    <li><kbd>Ctrl + 右键</kbd> - 隐藏窗口（可在设置中开启）</li>
                    <li><kbd>Esc</kbd> - 取消快捷键录制</li>
                    <li><kbd>Enter</kbd> - 确认输入/保存</li>
                </ul>
                <p class="tip">
                    <Lightbulb size="14" weight="Bold" /> 快捷键可在「设置 → 快捷键」中自定义，但主窗口快捷键需要确保不与其他软件冲突
                </p>
            </section>

            <section class="guide-section">
                <h3>
                    <Mouse size="18" weight="Bold" /> 热角唤起
                </h3>
                <p>将鼠标移动到屏幕角落并停留片刻，即可唤起主窗口。</p>
                <ul>
                    <li>可在「设置 → 窗口 → 热角唤起」中开启并配置</li>
                    <li><strong>角落位置：</strong>左上、右上、左下、右下四个角落可选</li>
                    <li><strong>灵敏度：</strong>低/中/高三档，灵敏度越高越容易触发</li>
                </ul>
            </section>

            <section class="guide-section">
                <h3>
                    <MagicStick size="18" weight="Bold" /> 窗口效果
                </h3>
                <p>支持窗口毛玻璃效果，可在「设置 → 外观 → 窗口效果」中配置。</p>
                <ul>
                    <li><strong>效果类型：</strong>Blur（轻量）/ Acrylic（更美观但更耗性能）</li>
                    <li><strong>性能模式：</strong>可关闭透明效果以提升性能</li>
                </ul>
                <p class="tip">
                    <Lightbulb size="14" weight="Bold" /> 拖拽窗口卡顿时建议切换为 Blur 效果或开启性能模式
                </p>
            </section>

            <section class="guide-section">
                <h3>
                    <ClipboardText size="18" weight="Bold" /> 剪贴板历史
                </h3>
                <ul>
                    <li>按 <kbd>Alt + V</kbd> 打开剪贴板历史</li>
                    <li>点击任意条目即可复制到剪贴板</li>
                    <li>系统复制的文本和图片会自动记录</li>
                    <li>支持删除单条记录或清空全部历史</li>
                </ul>
                <p class="tip">
                    <Lightbulb size="14" weight="Bold" /> 可在「设置 → 剪贴板」中配置最大记录数、图片大小限制、加密存储等
                </p>
            </section>

            <section class="guide-section">
                <h3>
                    <Palette size="18" weight="Bold" /> 主题与外观
                </h3>
                <ul>
                    <li>在「设置 → 外观」中选择主题：浅色/深色/跟随系统/透明</li>
                    <li>透明模式可自定义背景透明度</li>
                </ul>
            </section>

            <section class="guide-section">
                <h3>
                    <Settings size="18" weight="Bold" /> 窗口设置
                </h3>
                <ul>
                    <li><strong>跟随鼠标：</strong>开启后窗口显示时自动移动到鼠标位置</li>
                    <li><strong>锚点位置：</strong>配合跟随鼠标，可设置窗口显示在鼠标的上方/中间/下方</li>
                    <li><strong>启动后隐藏：</strong>开启后成功打开启动项会自动隐藏窗口</li>
                    <li><strong>Ctrl 多选：</strong>按住 <kbd>Ctrl</kbd> 键可连续启动多个启动项，松开后自动隐藏窗口</li>
                    <li><strong>开机自启：</strong>可选择三种方式
                        <ul>
                            <li>注册表 - 写入注册表，简单可靠，无需管理员权限（推荐）</li>
                            <li>任务计划 - 创建 Windows 任务计划，使用最高权限</li>
                            <li>服务 - 安装为系统服务，需要管理员权限</li>
                        </ul>
                    </li>
                </ul>
            </section>

            <section class="guide-section">
                <h3>
                    <Database size="18" weight="Bold" /> 数据管理
                </h3>
                <ul>
                    <li><strong>导出数据：</strong>将所有分类、启动项、设置等导出为文件备份</li>
                    <li><strong>导入数据：</strong>从备份文件恢复数据</li>
                    <li><strong>创建备份：</strong>快速创建带时间戳的完整备份</li>
                    <li><strong>备份历史：</strong>查看、恢复或删除历史备份</li>
                </ul>
                <p class="tip">
                    <Lightbulb size="14" weight="Bold" /> 建议定期创建备份，防止数据丢失
                </p>
            </section>

            <section class="guide-section">
                <h3>
                    <PlugCircle size="18" weight="Bold" /> 插件系统
                </h3>
                <p>支持通过插件扩展功能，可在「设置 → 功能 → 插件管理」中管理插件。</p>
                <ul>
                    <li><strong>安装插件：</strong>点击「从文件夹安装」，选择包含 manifest.json 的插件文件夹</li>
                    <li><strong>启用/禁用：</strong>点击插件卡片上的开关切换状态</li>
                    <li><strong>卸载插件：</strong>点击插件卡片底部的「卸载」按钮</li>
                    <li><strong>沙箱隔离：</strong>在「安全设置」中可开启沙箱隔离模式，插件将在隔离环境中运行</li>
                </ul>

                <h4>
                    <ClipboardText size="16" weight="Bold" /> 权限说明
                </h4>
                <p>插件会声明所需的权限，安装高风险权限插件时会显示确认对话框。</p>
                <ul>
                    <li><span class="perm-low">
                            <CheckCircle size="16" weight="Bold" /> 低风险
                        </span> - 自动授予：存储、通知、事件订阅/发送</li>
                    <li><span class="perm-medium">
                            <QuestionCircle size="16" weight="Bold" /> 中风险
                        </span> - 提示确认：启动应用、右键菜单扩展</li>
                    <li><span class="perm-high">
                            <DangerTriangle size="16" weight="Bold" /> 高风险
                        </span> - 需强确认：读取/写入剪贴板内容</li>
                </ul>
                <p class="tip">
                    <DangerTriangle size="14" weight="Bold" /> 请勿安装来源不明的插件，即使在沙箱模式下也无法完全阻止恶意代码
                </p>
            </section>

            <section class="guide-section">
                <h3>
                    <ShieldCheck size="18" weight="Bold" /> 系统托盘
                </h3>
                <ul>
                    <li>程序隐藏后会最小化到系统托盘</li>
                    <li>点击托盘图标可重新显示主窗口</li>
                    <li>右键托盘图标可访问快捷菜单</li>
                </ul>
                <p class="tip">
                    <Lightbulb size="14" weight="Bold" /> 确保程序在后台运行以响应全局快捷键
                </p>
            </section>
        </div>

        <footer v-if="!isInSettings" class="guide-footer">
            <div></div>
            <button class="close-btn" type="button" @click="onClose">
                开始使用
            </button>
        </footer>
    </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter, useRoute } from "vue-router";
import {
    Rocket,
    AddFolder,
    Lightbulb,
    Folder,
    Settings,
    Pin,
    Translation,
    Earth,
    Keyboard,
    Mouse,
    MagicStick,
    ClipboardText,
    Palette,
    Database,
    PlugCircle,
    ShieldCheck,
    DangerTriangle,
    CheckCircle,
    QuestionCircle,
} from "@solar-icons/vue";

const router = useRouter();
const route = useRoute();

const isInSettings = computed(() => route.path.startsWith("/settings"));

function onClose() {
    router.push("/categories");
}
</script>


<style lang="scss" scoped>
.guide-page {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-color);

    &::-webkit-scrollbar {
        display: none;
    }

    &.in-settings {
        margin: -8px;
        height: calc(100% + 24px);
    }
}

.guide-header {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 48px;
    padding: 0 16px;
    border-bottom: 1px solid var(--border-color);
}

.title {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-color);
}


.guide-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    padding-right: 12px;
}

.guide-section {
    margin-bottom: 20px;

    h3 {
        font-size: 15px;
        font-weight: 600;
        color: var(--text-color);
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        gap: 6px;
    }

    p {
        font-size: 13px;
        color: var(--text-secondary);
        line-height: 1.6;
    }

    ul {
        list-style: none;
        padding: 0;
        margin: 0;
    }

    li {
        font-size: 13px;
        color: var(--text-secondary);
        margin-bottom: 6px;
        line-height: 1.5;
        display: flex;

        >div:first-child {
            flex-shrink: 0;
            white-space: nowrap;
        }
    }

    li strong {
        display: inline-block;
        min-width: 64px;
        white-space: nowrap;
        margin-right: 4px;
    }

    .tip {
        margin-top: 8px;
        font-size: 12px;
        color: var(--text-tertiary);
        display: flex;
        align-items: center;
        gap: 4px;
    }

    h4 {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-color);
        margin-top: 12px;
        margin-bottom: 6px;
        display: flex;
        align-items: center;
        gap: 6px;
    }
}

.perm-low {
    color: #69db7c;
    display: inline-flex;
    align-items: center;
    gap: 4px;
}

.perm-medium {
    color: #ffb74d;
    display: inline-flex;
    align-items: center;
    gap: 4px;
}

.perm-high {
    color: #ff6b6b;
    display: inline-flex;
    align-items: center;
    gap: 4px;
}

kbd {
    display: inline-block;
    padding: 2px 6px;
    font-size: 12px;
    font-family: inherit;
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-color);
}

.guide-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 16px;
    border-top: 1px solid var(--border-color);
}

.close-btn {
    padding: 10px 20px;
    font-size: 14px;
    font-weight: 500;
    border: none;
    border-radius: 10px;
    background: var(--primary-color);
    color: #fff;
    cursor: pointer;
    -webkit-app-region: no-drag;
    transition: opacity 0.15s ease;

    &:hover {
        opacity: 0.9;
    }
}
</style>
