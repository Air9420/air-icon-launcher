export interface IccProfile {
  id: string;
  monitorName: string;
  monitorDeviceId: string;
  iccPath: string;
  enabled: boolean;
}

export interface MonitorInfo {
  name: string;
  deviceId: string;
  isPrimary: boolean;
}
