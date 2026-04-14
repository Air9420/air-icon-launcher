import type { PiniaPluginContext } from "pinia";
import type { DefineStoreOptions } from "pinia";

interface VersionedPersistConfig {
    storage: Storage;
    pick?: string[];
    exclude?: string[];
}

declare module "pinia" {
    export interface DefineStoreOptionsBase<S, Store> {
        persist?: VersionedPersistConfig | boolean;
    }
}

export type { VersionedPersistConfig };
