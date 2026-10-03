/** The signed-in person exactly as EduOS reports them. The school and permissions always come from here, never from the device. */
export interface User {
  id: string
  username: string
  email: string
  firstName: string
  lastName: string
  schoolId: string
  roles: string[]
  permissions: string[]
  /** 'school' | 'teacher' | 'parent' | 'student' | 'platform' */
  dataScope?: string
}
/** `schoolId` is only ever a value EduOS itself offered at sign-in for an account that exists in several schools. */
export interface Credentials { username: string, password: string, schoolId?: string }
export interface AuthResult { accessToken: string, refreshToken: string, expiresIn: number, user: User }

/** The only place a refresh token may rest. On a device this is the Keychain / Keystore. */
export interface SecureStorage {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}
/** The existing EduOS auth endpoints. Nothing here is mobile-specific on the server. */
export interface AuthApi {
  login(credentials: Credentials): Promise<AuthResult>
  refresh(refreshToken: string): Promise<AuthResult>
  logout(refreshToken: string | null, accessToken: string | null): Promise<void>
  me(accessToken: string): Promise<User>
}

export type SessionStatus = 'restoring' | 'signed-out' | 'signed-in'
export interface SessionState {
  status: SessionStatus
  user: User | null
  /** Shown on the sign-in screen, for example after a session ends without the person signing out. */
  notice: string | null
  /** A stored session exists but could not be confirmed because the device is offline. */
  restorePending: boolean
  /** True straight after signing in, until School Home has been shown once. */
  welcomePending: boolean
}
