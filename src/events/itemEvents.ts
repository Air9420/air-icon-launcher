import type { LauncherItem } from '../stores/launcherStore';

export type ItemEvent =
    | { type: 'item:created'; categoryId: string; item: LauncherItem }
    | { type: 'item:updated'; categoryId: string; item: LauncherItem }
    | { type: 'item:deleted'; categoryId: string; itemId: string }
    | { type: 'item:moved'; fromCategoryId: string; toCategoryId: string; itemIds: string[] }
    | { type: 'item:iconUpdated'; categoryId: string; itemId: string; iconBase64: string | null };

type Listener<T extends ItemEvent> = (event: T) => void;

class ItemEventBus {
    private listeners = new Map<ItemEvent['type'], Set<Listener<any>>>();
    private globalListeners = new Set<Listener<ItemEvent>>();

    emit<E extends ItemEvent>(event: E): void {
        for (const listener of this.globalListeners) {
            try {
                listener(event);
            } catch (e) {
                console.error(`Global event listener error for ${event.type}:`, e);
            }
        }

        const listeners = this.listeners.get(event.type);
        if (listeners) {
            for (const listener of listeners) {
                try {
                    listener(event);
                } catch (e) {
                    console.error(`Event listener error for ${event.type}:`, e);
                }
            }
        }
    }

    on<E extends ItemEvent['type']>(
        type: E,
        listener: Listener<ItemEvent & { type: E }>
    ): () => void {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, new Set());
        }
        this.listeners.get(type)!.add(listener);
        return () => {
            this.listeners.get(type)?.delete(listener);
        };
    }

    onAny(listener: Listener<ItemEvent>): () => void {
        this.globalListeners.add(listener);
        return () => {
            this.globalListeners.delete(listener);
        };
    }

    off<E extends ItemEvent['type']>(
        type: E,
        listener: Listener<ItemEvent & { type: E }>
    ): void {
        this.listeners.get(type)?.delete(listener);
    }

    offAll(): void {
        this.listeners.clear();
        this.globalListeners.clear();
    }
}

export const itemEventBus = new ItemEventBus();
