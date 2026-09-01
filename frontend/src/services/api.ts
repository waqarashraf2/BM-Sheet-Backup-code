import axios, { type AxiosRequestConfig } from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'https://crm.benchmarkstudio.biz/apicrm/api';

// Extended request config for retry tracking
interface RetryConfig extends AxiosRequestConfig {
  _retryCount?: number;
}

const apiClient = axios.create({
  baseURL: API_URL,
  timeout: 120000, // 2m default for regular API calls
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
});

// Request interceptor to add auth token and handle upload timeouts
apiClient.interceptors.request.use(
  (config) => {
    // If uploading files (FormData), disable client timeout so large uploads complete
    if (config.data instanceof FormData && config.timeout === 120000) {
      config.timeout = 0;
    }

    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
      // Cloudflare strips the standard Authorization header on some plans.
      // Send a duplicate in X-Authorization as a fallback — the backend
      // ProxyAuthorizationHeader middleware copies it back if needed.
      config.headers['X-Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Guard flag to prevent multiple simultaneous redirects (redirect loop)
let isRedirecting = false;

// Response interceptor to handle auto-retry on transient network errors and session management
apiClient.interceptors.response.use(
  (response) => {
    // Reset redirect guard on any successful response
    isRedirecting = false;
    return response;
  },
  async (error) => {
    const config = error.config as RetryConfig | undefined;

    // Transient network error detection: ERR_NETWORK_CHANGED, HTTP2 errors, timeout, 502/503/504
    const isNetworkOrServerGlitch =
      !error.response ||
      error.code === 'ERR_NETWORK_CHANGED' ||
      error.code === 'ECONNABORTED' ||
      (error.message && (
        error.message.includes('Network Error') ||
        error.message.includes('ERR_HTTP2') ||
        error.message.includes('timeout')
      )) ||
      (error.response && [502, 503, 504].includes(error.response.status));

    // Only retry GET requests or safe polling requests to avoid duplicate POST actions
    const isSafeMethod = config && (
      !config.method ||
      config.method.toLowerCase() === 'get' ||
      config.url?.includes('check-updates') ||
      config.url?.includes('unread-count')
    );

    if (config && isNetworkOrServerGlitch && isSafeMethod) {
      config._retryCount = config._retryCount || 0;
      const MAX_RETRIES = 2;

      if (config._retryCount < MAX_RETRIES) {
        config._retryCount += 1;
        // Exponential backoff delay (600ms, 1200ms)
        const backoffDelay = config._retryCount * 600;
        await new Promise((resolve) => setTimeout(resolve, backoffDelay));
        return apiClient(config);
      }
    }

    if (error.response && !isRedirecting) {
      switch (error.response.status) {
        case 401:
          // Handle unauthorized - session expired or invalid token
          isRedirecting = true;
          localStorage.removeItem('token');
          window.location.href = '/login';
          break;
        case 403:
          // Handle forbidden - insufficient permissions
          console.error('Access denied');
          break;
        case 409:
          // Handle conflict - duplicate session detected
          isRedirecting = true;
          alert('This account is already logged in on another device. You have been logged out.');
          localStorage.removeItem('token');
          window.location.href = '/login';
          break;
        case 500:
          console.error('Server error');
          break;
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;
