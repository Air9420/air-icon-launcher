import { registerStoreVersion } from "./storage-migrate";

registerStoreVersion("launcher", 2, [
    {
        fromVersion: 1,
        migrate: (v1Data: any) => {
            console.log('[Migration] launcher v1 -> v2, data:', v1Data);
            return {
                ...v1Data,
                _migratedToV2: true,
                _migratedAt: Date.now(),
            };
        }
    }
]);
registerStoreVersion("clipboard", 2, [
    {
        fromVersion: 1,
        migrate: (v1Data: any) => {
            console.log('[Migration] clipboard v1 -> v2, data:', v1Data);
            return {
                ...v1Data,
                _migratedToV2: true,
                _migratedAt: Date.now(),
            };
        }
    }
]);
registerStoreVersion("category", 2, []);
registerStoreVersion("settings", 2, []);
