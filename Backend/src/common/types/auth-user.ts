/**
 * One role assignment: the permissions of a single role, valid only for that assignment's
 * own hospital scope. Scopes are never pooled across assignments (see narrowUserScope).
 */
export type Grant = {
  roleCode: string;
  permissions: string[];
  allHospitals: boolean;
  hospitalIds: string[];
};

export type AuthUser = {
  id: string;
  organizationId: string;
  email: string;
  fullName: string;
  roleCodes: string[];
  /** Union of all permissions; for display only. Authorization uses `grants`. */
  permissions: string[];
  /** Union of all scopes; for display only until the guard narrows it per request. */
  hospitalIds: string[];
  allHospitals: boolean;
  grants: Grant[];
  /** True once the person has confirmed an authenticator app. */
  mfaEnabled?: boolean;
};

export type JwtPayload = {
  sub: string;
  org: string;
  type: 'access' | 'refresh' | 'mfa';
  sid?: string;
  /** For `mfa` tokens: whether the person is to enter a code or to enrol first. */
  stage?: 'verify' | 'enrol';
};
