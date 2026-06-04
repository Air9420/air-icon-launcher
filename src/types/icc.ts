export interface IccProfile {
  id: string;
  monitorName: string;
  monitorDeviceId: string;
  iccPath: string;
  enabled: boolean;
}

export interface MonitorInfo {
  name: string;
  friendlyName: string;
  deviceId: string;
  isPrimary: boolean;
}
