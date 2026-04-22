import { invokeOrThrow } from "./invoke-wrapper";

export interface MonitorFingerprintInfo {
    fingerprint: string;
    name: string | null;
    position_x: number;
    position_y: number;
    width: number;
    height: number;
    scale_factor: number;
}

export async function openPathWithSystem(path: string): Promise<void> {
    await invokeOrThrow("open_path", { path });
}

export async function openUrlWithSystem(url: string): Promise<void> {
    await invokeOrThrow("open_url", { url });
}

export async function readLocalImageAsDataUrl(path: string): Promise<string> {
    return invokeOrThrow<string>("read_local_image_as_data_url", { path });
}

export async function writeTextFileViaCommand(
    path: string,
    content: string
): Promise<void> {
    await invokeOrThrow("write_text_file", { path, content });
}

export async function getCurrentMonitorFingerprint(): Promise<MonitorFingerprintInfo | null> {
    return invokeOrThrow<MonitorFingerprintInfo | null>("get_current_monitor_fingerprint");
}
