const isDev = import.meta.env.DEV;

export const config = {
  apiUrl: (import.meta.env.VITE_API_BASE_URL as string | undefined) || (isDev ? 'http://localhost:18000' : ''),
  wsUrl: (import.meta.env.VITE_WS_URL as string | undefined) || (isDev ? 'ws://localhost:18000/ws/chat' : ''),
};

export default config;
