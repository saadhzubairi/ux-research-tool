import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL as string || 'http://localhost:4444',
  timeout: 15_000,
  headers: {
    'Content-Type': 'application/json',
  },
})

api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error)) {
      const message = error.response?.data?.error ?? error.message ?? 'Request failed'
      console.error('[API Error]', message)
    }
    return Promise.reject(error)
  },
)

export default api
