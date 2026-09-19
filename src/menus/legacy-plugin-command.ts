/**
 * Legacy menu `plugin-command` dispatch bridge.
 *
 * The old iframe JS plugin command registry (`src/plugins/api.ts`) was removed
 * in package IR. Menu contributions that still declare `commandId` without
 * `onClick` land here; they resolve to a no-op + console warning.
 *
 * Preferred contribution styles going forward:
 * - `onClick(ctx)` on the menu item
 * - `action.kind = "plugin-onclick"`
 * - Rust host actions via `ctx.pluginHost.invoke`
 */
export function executeLegacyPluginCommand(commandId: string, ..._args: unknown[]): void {
  console.warn(
    `[menus] plugin-command '${commandId}' is offline (iframe JS plugins removed). ` +
      `Use item.onClick or ctx.pluginHost instead.`,
  );
}
