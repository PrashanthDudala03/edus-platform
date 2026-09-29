import client from './client'

export interface LoginRequest {
  schoolId: string
  username: string
  password: string
}

export interface LoginResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
  user: {
    id: string
    username: string
    email: string
    firstName: string
    lastName: string
    schoolId: string
    roles: string[]
    permissions: string[]
  }
}

export const authAPI = {
  login: async (data: LoginRequest) => {
    const response = await client.post<{ data: LoginResponse }>('/auth/login', data)
    return response.data.data
  },

  logout: async (refreshToken: string | null) => {
    await client.post('/auth/logout', { refreshToken })
  },

  refresh: async (refreshToken: string) => {
    const response = await client.post<{ data: { accessToken: string; expiresIn: number } }>('/auth/refresh', {
      refreshToken,
    })
    return response.data.data
  },
}
