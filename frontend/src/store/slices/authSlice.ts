import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { User } from '../../types';
export type { User };

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  sessionActive: boolean;
}

const storedToken = localStorage.getItem('token');

const initialState: AuthState = {
  user: null,
  token: storedToken,
  isAuthenticated: false,
  loading: !!storedToken, // If token exists, we're loading until profile is fetched
  sessionActive: false,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCredentials: (state, action: PayloadAction<{ user: User; token: string }>) => {
      state.user = action.payload.user;
      state.token = action.payload.token;
      state.isAuthenticated = true;
      state.sessionActive = true;
      localStorage.setItem('token', action.payload.token);
    },
    logout: (state) => {
      if (state.user?.id) {
        sessionStorage.removeItem(`machine_id_prompt_dismissed_${state.user.id}`);
      }
      state.user = null;
      state.token = null;
      state.isAuthenticated = false;
      state.sessionActive = false;
      localStorage.removeItem('token');
    },
    updateUser: (state, action: PayloadAction<User>) => {
      state.user = action.payload;
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    updateSessionStatus: (state, action: PayloadAction<boolean>) => {
      state.sessionActive = action.payload;
    },
  },
});

export const { setCredentials, logout, updateUser, setLoading, updateSessionStatus } = authSlice.actions;
export default authSlice.reducer;
