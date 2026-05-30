import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'https://crm.benchmarkstudio.biz/apicrm/api';

const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
});

// Request interceptor to add auth token
apiClient.interceptors.request.use(
  (config) => {
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

// Response interceptor to handle errors and session management
apiClient.interceptors.response.use(
  (response) => {
    // Reset redirect guard on any successful response
    isRedirecting = false;
    return response;
  },
  (error) => {
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
