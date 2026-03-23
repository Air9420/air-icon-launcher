export type RiskLevel = "low" | "medium" | "high";

export type ConfirmBehavior = "auto" | "prompt" | "strong-confirm";

export interface PermissionDefinition {
  description: string;
  risk: RiskLevel;
  confirmBehavior: ConfirmBehavior;
}

export const PERMISSION_DEFINITIONS = {
  "launcher.read": {
    description: "读取分类和启动项列表",
    risk: "low" as RiskLevel,
    confirmBehavior: "auto" as ConfirmBehavior,
  },
  "launcher.open": {
    description: "启动应用程序",
    risk: "medium" as RiskLevel,
    confirmBehavior: "prompt" as ConfirmBehavior,
  },
  "clipboard.readText": {
    description: "读取剪贴板文本内容",
    risk: "high" as RiskLevel,
    confirmBehavior: "strong-confirm" as ConfirmBehavior,
  },
  "clipboard.readImage": {
    description: "读取剪贴板图片",
    risk: "high" as RiskLevel,
    confirmBehavior: "strong-confirm" as ConfirmBehavior,
  },
  "clipboard.writeText": {
    description: "写入剪贴板文本",
    risk: "high" as RiskLevel,
    confirmBehavior: "strong-confirm" as ConfirmBehavior,
  },
  "clipboard.writeImage": {
    description: "写入剪贴板图片",
    risk: "high" as RiskLevel,
    confirmBehavior: "strong-confirm" as ConfirmBehavior,
  },
  "storage.local": {
    description: "使用本地存储",
    risk: "low" as RiskLevel,
    confirmBehavior: "auto" as ConfirmBehavior,
  },
  contextMenu: {
    description: "扩展右键菜单",
    risk: "medium" as RiskLevel,
    confirmBehavior: "prompt" as ConfirmBehavior,
  },
  toast: {
    description: "显示通知消息",
    risk: "low" as RiskLevel,
    confirmBehavior: "auto" as ConfirmBehavior,
  },
  "events.subscribe": {
    description: "订阅应用事件",
    risk: "low" as RiskLevel,
    confirmBehavior: "auto" as ConfirmBehavior,
  },
  "events.emit": {
    description: "发送事件",
    risk: "low" as RiskLevel,
    confirmBehavior: "auto" as ConfirmBehavior,
  },
} as const;

export type Permission = keyof typeof PERMISSION_DEFINITIONS;

export interface PermissionChecker {
  check(permission: Permission): void;
}

export function hasPermission(
  permissions: Permission[],
  permission: Permission
): boolean {
  return permissions.includes(permission);
}

export function createPermissionChecker(
  permissions: Permission[]
): PermissionChecker {
  return {
    check(permission: Permission): void {
      if (!hasPermission(permissions, permission)) {
        throw new PermissionDeniedError(permission);
      }
    },
  };
}

export class PermissionDeniedError extends Error {
  constructor(public readonly permission: Permission) {
    super(`Permission denied: ${permission}`);
    this.name = "PermissionDeniedError";
  }
}

export function getPermissionDefinition(
  permission: Permission
): PermissionDefinition {
  return PERMISSION_DEFINITIONS[permission];
}

export function getRiskLevel(permission: Permission): RiskLevel {
  return PERMISSION_DEFINITIONS[permission].risk;
}

export function getConfirmBehavior(permission: Permission): ConfirmBehavior {
  return PERMISSION_DEFINITIONS[permission].confirmBehavior;
}

export function getHighRiskPermissions(permissions: Permission[]): Permission[] {
  return permissions.filter(
    (p) => PERMISSION_DEFINITIONS[p].risk === "high"
  );
}

export function hasHighRiskPermissions(permissions: Permission[]): boolean {
  return permissions.some((p) => PERMISSION_DEFINITIONS[p].risk === "high");
}

export const DEFAULT_PERMISSIONS: Permission[] = [
  "storage.local",
  "toast",
  "events.subscribe",
  "events.emit",
];

export function validatePermissions(
  permissions: string[]
): { valid: Permission[]; invalid: string[] } {
  const valid: Permission[] = [];
  const invalid: string[] = [];

  for (const perm of permissions) {
    if (perm in PERMISSION_DEFINITIONS) {
      valid.push(perm as Permission);
    } else {
      invalid.push(perm);
    }
  }

  return { valid, invalid };
}
