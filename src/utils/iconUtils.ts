import { open } from "@tauri-apps/plugin-dialog";
import { readLocalImageAsDataUrl } from "./system-commands";

const IMAGE_LOAD_TIMEOUT_MS = 8000;

export async function selectAndConvertIcon(): Promise<string | null> {
    const selected = await open({
        multiple: false,
        filters: [
            {
                name: "Images",
                extensions: ["png", "jpg", "jpeg", "ico", "svg", "bmp", "webp"],
            },
        ],
    });

    if (!selected) {
        return null;
    }

    const filePath = selected as string;

    try {
        const base64 = await loadImageAsBase64(filePath);
        return base64;
    } catch (error) {
        console.error("Failed to load image:", error);
        return null;
    }
}

async function loadImageAsBase64(filePath: string): Promise<string> {
    const sourceDataUrl = await readLocalImageAsDataUrl(filePath);

    return new Promise((resolve, reject) => {
        const img = new Image();
        let settled = false;
        const timeout = window.setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new Error("Image load timeout"));
        }, IMAGE_LOAD_TIMEOUT_MS);

        function finalize(fn: () => void) {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeout);
            fn();
        }

        img.onload = () => {
            finalize(() => {
                const targetSize = 128;
                const canvas = document.createElement("canvas");
                canvas.width = targetSize;
                canvas.height = targetSize;

                const ctx = canvas.getContext("2d");
                if (!ctx) {
                    reject(new Error("Failed to get canvas context"));
                    return;
                }

                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = "high";

                let drawWidth = targetSize;
                let drawHeight = targetSize;
                let offsetX = 0;
                let offsetY = 0;

                if (img.width !== img.height) {
                    const scale = Math.min(targetSize / img.width, targetSize / img.height);
                    drawWidth = img.width * scale;
                    drawHeight = img.height * scale;
                    offsetX = (targetSize - drawWidth) / 2;
                    offsetY = (targetSize - drawHeight) / 2;
                }

                ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);

                const resizedBase64 = canvas.toDataURL("image/png");
                resolve(resizedBase64);
            });
        };

        img.onerror = () => {
            finalize(() => reject(new Error("Failed to load image")));
        };

        img.src = sourceDataUrl;
    });
}
