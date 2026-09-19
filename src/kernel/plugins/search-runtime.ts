import type { Context, Plugin } from "cordis";
import { useSearchStore, Store } from "../../stores";

/**
 * search-runtime: start itemEventBus → Rust index sync + initial full sync.
 *
 * Prefers `ctx.search` directly; searchStore adapter still works as facade.
 */
export const searchRuntimePlugin: Plugin.Object<void> = {
  name: "search-runtime",
  inject: ["search", "apps", "ipc"],
  apply(ctx: Context) {
    const searchStore = useSearchStore();
    const store = Store();

    const search = ctx.search;
    if (search) {
      search.startEventSync();
    } else {
      searchStore.startListening();
    }

    void store.syncSearchIndex().catch(() => {});

    return () => {
      if (search) {
        search.stopEventSync();
      } else {
        searchStore.stopListening();
      }
    };
  },
};
