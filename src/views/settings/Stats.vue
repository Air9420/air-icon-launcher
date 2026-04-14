<template>
  <div class="stats-panel">
    <section class="stats-section">
      <h3 class="section-title">本周启动 TOP 10</h3>
      <div v-if="weeklyTopApps.length === 0" class="empty-hint">
        暂无使用记录，启动应用后这里会显示统计数据
      </div>
      <div v-else class="top-list">
        <div v-for="(app, idx) in weeklyTopApps" :key="app.itemId" class="top-item">
          <span class="rank" :class="{ 'rank-top3': idx < 3 }">{{ idx + 1 }}</span>
          <span class="app-name" :title="app.name">{{ app.name }}</span>
          <div class="bar-wrapper">
            <div class="bar-fill" :style="{ width: `${(app.weekLaunches / maxWeekLaunches) * 100}%` }"></div>
          </div>
          <span class="count">{{ app.weekLaunches }} 次</span>
        </div>
      </div>
    </section>

    <section class="stats-section">
      <h3 class="section-title">分类使用占比</h3>
      <div v-if="categoryDistribution.length === 0" class="empty-hint">
        暂无数据
      </div>
      <div v-else class="category-dist">
        <div v-for="cat in categoryDistribution" :key="cat.name" class="cat-row">
          <span class="cat-name">{{ cat.name }}</span>
          <div class="bar-wrapper">
            <div class="bar-fill bar-category" :style="{ width: `${cat.percentage}%` }"></div>
          </div>
          <span class="cat-stat">{{ cat.launches }} 次 ({{ cat.percentage.toFixed(0) }}%)</span>
        </div>
      </div>
    </section>

    <section class="stats-section">
      <h3 class="section-title">搜索关键词热度</h3>
      <div v-if="topKeywords.length === 0" class="empty-hint">
        暂无搜索记录
      </div>
      <div v-else class="keyword-cloud">
        <span v-for="kw in topKeywords" :key="kw.keyword" class="keyword-tag"
          :style="{ fontSize: `${Math.max(12, Math.min(18, 12 + kw.count * 0.5))}px` }">
          {{ kw.keyword }}
          <span class="kw-count">{{ kw.count }}</span>
        </span>
      </div>
    </section>

    <section class="stats-section">
      <h3 class="section-title">总览</h3>
      <div class="summary-grid">
        <div class="summary-card">
          <div class="summary-value">{{ totalWeekLaunches }}</div>
          <div class="summary-label">本周启动次数</div>
        </div>
        <div class="summary-card">
          <div class="summary-value">{{ totalAllTimeLaunches }}</div>
          <div class="summary-label">总启动次数</div>
        </div>
        <div class="summary-card">
          <div class="summary-value">{{ trackedAppCount }}</div>
          <div class="summary-label">已追踪应用数</div>
        </div>
        <div class="summary-card">
          <div class="summary-value">{{ currentTimeSlotLabel }}</div>
          <div class="summary-label">当前时段</div>
        </div>
      </div>
    </section>

    <section class="stats-section" v-if="timeRecs.length > 0">
      <h3 class="section-title">🕐 当前时段推荐 ({{ currentTimeSlotLabel }})</h3>
      <div class="rec-list">
        <div v-for="app in timeRecs" :key="app.itemId" class="rec-item">
          <span class="rec-name">{{ app.name }}</span>
          <span class="rec-count">{{ app.timeSlotCounts[currentTimeSlot] }} 次</span>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStatsStore } from "../../stores/statsStore";

const stats = useStatsStore();

const weeklyTopApps = computed(() => stats.weeklyTopApps);
const categoryDistribution = computed(() => stats.categoryUsageDistribution);
const topKeywords = computed(() => stats.topSearchKeywords);
const timeRecs = computed(() => stats.timeBasedRecommendations);
const currentTimeSlot = computed(() => stats.getCurrentTimeSlot());
const totalWeekLaunches = computed(() => stats.totalLaunchesThisWeek);
const totalAllTimeLaunches = computed(() => stats.totalLaunchesAllTime);
const trackedAppCount = computed(() => stats.appUsageStats.length);

const maxWeekLaunches = computed(() =>
  Math.max(...weeklyTopApps.value.map((a) => a.weekLaunches), 1)
);

const TIME_SLOT_LABELS: Record<string, string> = {
  morning: "☀️ 上午",
  afternoon: "🌤️ 下午",
  evening: "🌙 傍晚",
  night: "🌛 夜间",
};

const currentTimeSlotLabel = computed(() => TIME_SLOT_LABELS[currentTimeSlot.value] || currentTimeSlot.value);
</script>

<style scoped>
.stats-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.section-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-color);
  text-shadow: var(--text-shadow);
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-color);
}

.empty-hint {
  color: var(--text-secondary);
  font-size: 13px;
  padding: 16px;
  text-align: center;
  background: var(--card-bg-solid);
  border-radius: 10px;
}

.top-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.top-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 8px;
  transition: background 0.15s;
}

.top-item:hover {
  background: var(--hover-bg);
}

.rank {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
  filter: drop-shadow(var(--text-shadow));
  background: var(--bg-color-secondary);
  flex-shrink: 0;
}

.rank-top3 {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.app-name {
  color: var(--text-secondary);
  text-shadow: var(--text-shadow);
  font-size: 13px;
  font-weight: 600;
  width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bar-wrapper {
  flex: 1;
  height: 6px;
  background: var(--bg-color-secondary);
  border-radius: 3px;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #667eea, #764ba2);
  border-radius: 3px;
  transition: width 0.4s ease;
  min-width: 2px;
}

.bar-category {
  background: linear-gradient(90deg, #f093fb, #f5576c);
}

.count {
  font-size: 12px;
  color: var(--text-secondary);
  text-shadow: var(--text-shadow);
  font-variant-numeric: tabular-nums;
  min-width: 40px;
  text-align: right;
  flex-shrink: 0;
}

.cat-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 0;
}

.cat-name {
  color: var(--text-secondary);
  text-shadow: var(--text-shadow);
  font-size: 13px;
  width: 70px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cat-stat {
  font-size: 12px;
  color: var(--text-secondary);
  text-shadow: var(--text-shadow);

  min-width: 90px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.keyword-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 0;
}

.keyword-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 12px;
  background: var(--card-bg-solid);
  color: var(--text-color);
  font-weight: 600;
  cursor: default;
  box-shadow: var(--card-shadow-light);
  transition: transform 0.15s;
}

.keyword-tag:hover {
  transform: translateY(-1px);
}

.kw-count {
  font-size: 10px;
  color: var(--primary-color, #0078d4);
  font-weight: 700;
  opacity: 0.7;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.summary-card {
  background: var(--card-bg-solid);
  border-radius: 12px;
  padding: 14px;
  text-align: center;
  box-shadow: var(--card-shadow-light);
}

.summary-value {
  font-size: 22px;
  font-weight: 800;
  color: var(--text-color);
  line-height: 1.2;
}

.summary-label {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.rec-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.rec-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--card-bg-solid);
  font-size: 13px;
}

.rec-name {
  font-weight: 600;
  color: var(--text-color);
  text-shadow: var(--text-shadow);
}

.rec-count {
  font-size: 11px;
  color: var(--text-color);
  text-shadow: var(--text-shadow);
  font-variant-numeric: tabular-nums;
}
</style>
