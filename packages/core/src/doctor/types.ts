export type DoctorCheck = {
  scope: "repo" | "bootstrap" | "updates" | "lockdown";
  status: "ok" | "warn" | "missing";
  label: string;
  detail?: string;
};

export type DoctorPush = (c: DoctorCheck) => void;
