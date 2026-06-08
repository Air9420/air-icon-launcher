const fs = require('fs');
const path = require('path');

const PROJECT = 'Z:\\VScodeProject\\air-icon-launcher';
const WEATHER_PATH = path.join(PROJECT, 'node_modules', '@solar-icons', 'vue', 'dist', 'weather-6jMEEQQA.mjs');
const CONTEXT_PATH = path.join(PROJECT, 'node_modules', '@solar-icons', 'vue', 'dist', 'context-DFs-kdLH.mjs');
const CHUNK_PATH = path.join(PROJECT, 'node_modules', '@solar-icons', 'vue', 'dist', 'chunk-km9CeSFt.mjs');
const INDEX_PATH = path.join(PROJECT, 'node_modules', '@solar-icons', 'vue', 'dist', 'index.mjs');
const OUTPUT_PATH = path.join(PROJECT, 'src', 'icons', 'solar-icons.ts');

const weatherContent = fs.readFileSync(WEATHER_PATH, 'utf8');
const contextContent = fs.readFileSync(CONTEXT_PATH, 'utf8');
const chunkContent = fs.readFileSync(CHUNK_PATH, 'utf8');
const indexContent = fs.readFileSync(INDEX_PATH, 'utf8');

// === Step 1: Build icon name mappings ===

// index.mjs export map: PascalCase name -> imported name from weather
const indexExportMap = {};
const indexExportMatch = indexContent.match(/export\{([^}]+)\}/);
if (indexExportMatch) {
  for (const entry of indexExportMatch[1].split(',')) {
    const parts = entry.split(' as ').map(s => s.trim());
    if (parts.length === 2) indexExportMap[parts[1]] = parts[0];
  }
}

// index.mjs import map: local import name -> weather chunk export name
const indexImportMap = {};
const indexImportMatch = indexContent.match(/import\{([^}]+)\}from"\.\/weather/);
if (indexImportMatch) {
  for (const entry of indexImportMatch[1].split(',')) {
    const parts = entry.split(' as ').map(s => s.trim());
    if (parts.length === 2) indexImportMap[parts[1]] = parts[0];
  }
}

// weather chunk export map: weather export name -> local variable
const weatherExportMap = {};
const weatherExportMatch = weatherContent.match(/export\{([^}]+)\}/);
if (weatherExportMatch) {
  for (const entry of weatherExportMatch[1].split(',')) {
    const parts = entry.split(' as ').map(s => s.trim());
    if (parts.length === 2) weatherExportMap[parts[1]] = parts[0];
  }
}

// === Step 2: Find needed icon kebab names ===

const ICON_MAP = {
  'ClipboardText': 'clipboard-text',
  'Earth': 'earth',
  'Rocket': 'rocket',
  'Folder': 'folder',
  'DangerSquare': 'danger-square',
  'Clipboard': 'clipboard',
  'Alarm': 'alarm',
  'Settings': 'settings',
  'Infinite': 'infinite',
  'ClockCircle': 'clock-circle',
  'Sun': 'sun',
  'CloudSun': 'cloud-sun',
  'Moon': 'moon',
  'MoonStars': 'moon-stars',
  'Backpack': 'backpack',
  'History': 'history',
  'Export': 'export',
  'Import': 'import',
  'Database': 'database',
  'PlugCircle': 'plug-circle',
  'ShieldCheck': 'shield-check',
  'DangerTriangle': 'danger-triangle',
  'CheckCircle': 'check-circle',
  'QuestionCircle': 'question-circle',
  'AddFolder': 'add-folder',
  'Lightbulb': 'lightbulb',
  'Pin': 'pin',
  'Translation': 'translation',
  'Keyboard': 'keyboard',
  'Mouse': 'mouse',
  'MagicStick': 'magic-stick',
  'Palette': 'palette',
};

// === Step 3: Extract icon data from weather chunk ===

function extractIconData(content, iconName) {
  const marker = '`' + iconName + '`,{';
  const startIdx = content.indexOf(marker);
  if (startIdx === -1) return null;

  const callStart = content.lastIndexOf('l(', startIdx);
  if (callStart === -1) return null;

  let depth = 0;
  let inString = false;
  let stringChar = '';
  let i = callStart + 1;

  while (i < content.length && content[i] !== '{') i++;

  depth = 1;
  i++;

  while (i < content.length && depth > 0) {
    const ch = content[i];
    if (inString) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === stringChar) {
        inString = false;
      }
    } else {
      if (ch === '`' || ch === '"' || ch === "'") {
        inString = true;
        stringChar = ch;
      } else if (ch === '{' || ch === '[') {
        depth++;
      } else if (ch === '}' || ch === ']') {
        depth--;
      }
    }
    i++;
  }

  return content.substring(callStart, i + 1);
}

function extractWeightData(callStr) {
  const weights = {};
  const weightNames = ['Bold', 'BoldDuotone', 'Broken', 'LineDuotone', 'Linear', 'Outline'];

  for (const weight of weightNames) {
    const marker = weight + ':[[';
    const start = callStr.indexOf(marker);
    if (start === -1) continue;

    let depth = 0;
    let i = start + weight.length + 1;
    while (i < callStr.length && callStr[i] !== '[') i++;
    const arrStart = i;
    depth = 1;
    i++;

    while (i < callStr.length && depth > 0) {
      const ch = callStr[i];
      if (ch === '[') depth++;
      else if (ch === ']') depth--;
      i++;
    }

    weights[weight] = callStr.substring(arrStart, i);
  }

  return weights;
}

// === Step 4: Extract rendering infrastructure ===

// Extract SvgNodeRenderer
const svgNodeMatch = weatherContent.match(/var\s+\w+=a\(\{name:`SvgNodeRenderer`[\s\S]*?\}\)\}/);
const svgNodeCode = svgNodeMatch ? svgNodeMatch[0] : '';

// Extract SolarIcon
const solarIconMatch = weatherContent.match(/var\s+\w+=a\(\{__name:`SolarIcon`[\s\S]*?\}\)\}/);
const solarIconCode = solarIconMatch ? solarIconMatch[0] : '';

// Extract l() factory function
const factoryMatch = weatherContent.match(/const\s+\w+=\([\w,]+\)=>\(\{[\s\S]*?\}\)\}/);
const factoryCode = factoryMatch ? factoryMatch[0] : '';

// === Step 5: Generate the output module ===

console.log('Extracting icons...');
const iconEntries = [];

for (const [pascalName, kebabName] of Object.entries(ICON_MAP)) {
  const call = extractIconData(weatherContent, kebabName);
  if (!call) {
    console.log(`  SKIP ${pascalName} (${kebabName}): not found`);
    continue;
  }

  const weights = extractWeightData(call);
  const weightEntries = [];
  for (const [weight, data] of Object.entries(weights)) {
    // Convert backtick strings to template literal syntax for the output
    weightEntries.push(`${weight}: ${data}`);
  }

  iconEntries.push({ pascalName, kebabName, weightEntries });
  console.log(`  OK ${pascalName} (${kebabName}): ${Object.keys(weights).length} weights`);
}

// Generate the TypeScript file
// We'll use Vue's defineComponent directly instead of the library's factory

const output = `// Auto-generated by scripts/generate-solar-icons.cjs
// Only includes icons actually used in the project
// DO NOT EDIT MANUALLY
/* eslint-disable @typescript-eslint/no-explicit-any */

import { defineComponent, computed, h, inject, provide, reactive, Fragment, type Component } from 'vue';

// === Config system (from @solar-icons/vue context) ===
const DEFAULT_CONTEXT = { color: 'currentColor', size: '24', weight: 'Linear', mirrored: false } as const;
const SOLAR_ICONS_CONFIG_KEY = Symbol.for('solar-icons-config');
const DEFAULT_SOLAR = { config: DEFAULT_CONTEXT, setConfig: () => {}, setWeight: () => {}, setSize: () => {}, setColor: () => {} };

function useSolar() {
  return inject(SOLAR_ICONS_CONFIG_KEY, DEFAULT_SOLAR) as typeof DEFAULT_SOLAR;
}

function provideSolarIconsContext(ctx: any) {
  provide(SOLAR_ICONS_CONFIG_KEY, ctx);
}

// === SVG Node Renderer ===
const SvgNodeRenderer: Component = defineComponent({
  name: 'SvgNodeRenderer',
  props: { node: { type: Array, required: true } },
  setup(props) {
    return () => {
      const node = props.node as any[];
      const tag = node[0] as string;
      const attrs = node[1] as Record<string, any>;
      const children = (node[2] || []) as any[];
      return h(tag as any, attrs, children.map((child: any, idx: number) =>
        h(SvgNodeRenderer as any, { key: idx, node: child })
      ));
    };
  }
}) as any;

// === Solar Icon base component ===
const SolarIcon: Component = defineComponent({
  name: 'SolarIcon',
  props: {
    iconNodes: { default: () => [] as any[] },
    color: {},
    size: {},
    mirrored: { type: Boolean },
    alt: {},
  },
  setup(props: any) {
    const { config } = useSolar();
    const resolvedColor = computed(() => props.color ?? config.color ?? DEFAULT_CONTEXT.color);
    const resolvedSize = computed(() => props.size ?? config.size ?? DEFAULT_CONTEXT.size);
    const resolvedMirrored = computed(() => props.mirrored || config.mirrored || DEFAULT_CONTEXT.mirrored);

    return (vm: any) => h('svg', {
      xmlns: 'http://www.w3.org/2000/svg',
      width: resolvedSize.value,
      height: resolvedSize.value,
      color: resolvedColor.value,
      fill: 'none',
      viewBox: '0 0 24 24',
      transform: resolvedMirrored.value ? 'scale(-1, 1)' : undefined,
      ...vm.$attrs,
    }, [
      props.alt ? h('title', null, props.alt) : null,
      ...(props.iconNodes as any[]).map((node: any, idx: number) =>
        h(SvgNodeRenderer as any, { key: idx, node })
      ),
    ]);
  }
}) as any;

// === Icon factory ===
function createIcon(name: string, weights: Record<string, any[]>): Component {
  return defineComponent({
    props: { weight: {} },
    setup(props, { attrs, slots }) {
      const { config } = useSolar();
      const weightKey = computed(() => (props as any).weight ?? config.weight ?? DEFAULT_CONTEXT.weight);
      const nodes = weights[weightKey.value] || weights['Linear'] || [];
      return () => h(SolarIcon as any, { ...attrs, ...(props as any), iconName: name, iconNodes: nodes }, slots);
    }
  }) as any;
}

// === Icon definitions ===
${iconEntries.map(({ pascalName, kebabName, weightEntries }) => {
  return `export const ${pascalName} = createIcon('${kebabName}', {\n  ${weightEntries.join(',\n  ')}\n});`;
}).join('\n\n')}

// === Re-exports for compatibility ===
export { useSolar, provideSolarIconsContext, SolarIcon, SvgNodeRenderer };

// SolarProvider component
export const SolarProvider = defineComponent({
  name: 'SolarProvider',
  props: {
    color: { default: 'currentColor' },
    size: { default: '1em' },
    weight: { default: 'Linear' },
    mirrored: { type: Boolean, default: false },
  },
  setup(props: any) {
    const ctx = reactive({
      color: props.color,
      size: props.size,
      weight: props.weight,
      mirrored: props.mirrored,
    });
    provideSolarIconsContext(ctx);
    // Watch for prop changes
    computed(() => {
      ctx.color = props.color;
      ctx.size = props.size;
      ctx.weight = props.weight;
      ctx.mirrored = props.mirrored;
    });
    return (vm: any) => h(Fragment, null, vm.$slots.default?.());
  }
});
`;

fs.writeFileSync(OUTPUT_PATH, output, 'utf8');
console.log(`\nGenerated ${OUTPUT_PATH}`);
console.log(`Total icons: ${iconEntries.length}`);
