// Окружение фронтенда. Vite пробрасывает только переменные с префиксом VITE_.
// Реальный API_URL обычно остаётся пустым в проде (фронтенд и API на одном origin).

export const env = {
  API_URL: import.meta.env.VITE_API_URL ?? '',
  MODE: import.meta.env.MODE,
}
