import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { setCredentials, setLoading as setAuthLoading } from '../../store/slices/authSlice';
import { authService } from '../../services';
import { motion } from 'framer-motion';
import { LogIn, AlertCircle, Eye, EyeOff } from 'lucide-react';
import BenchmarkLogo from '../../components/ui/BenchmarkLogo';

interface FlyingFlag {
  id: number;
  x: number;
  size: number;
  delay: number;
  duration: number;
  opacity: number;
}

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [flags, setFlags] = useState<FlyingFlag[]>([]);

  useEffect(() => {
    // Safely generate flags after mount to avoid server-side or layout hydration mismatches
    const generated: FlyingFlag[] = Array.from({ length: 12 }).map((_, i) => ({
      id: i,
      x: Math.random() * 90 + 5, // Keep within 5% to 95% of screen width
      size: Math.random() * 20 + 20, // 20px to 40px
      delay: Math.random() * 6,
      duration: Math.random() * 8 + 8, // 8s to 16s
      opacity: Math.random() * 0.25 + 0.1, // Soft opacity so it doesn't block inputs
    }));
    setFlags(generated);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { setError('Email and password are required.'); return; }
    try {
      setLoading(true); setError('');
      dispatch(setAuthLoading(true));
      const res = await authService.login({ email, password });
      const { user, token } = res.data;
      dispatch(setCredentials({ user, token }));
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Invalid credentials.');
    } finally {
      setLoading(false);
      dispatch(setAuthLoading(false));
    }
  };

  return (
    <div className="min-h-screen flex relative overflow-hidden" style={{ backgroundColor: '#0d1f1e' }}>

      {/* Background Flying Flags */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
        {flags.map((flag) => (
          <motion.div
            key={flag.id}
            initial={{ y: '115vh', x: `${flag.x}vw`, opacity: 0 }}
            animate={{
              y: '-20vh',
              opacity: [0, flag.opacity, flag.opacity, 0],
              x: [
                `${flag.x}vw`,
                `${flag.x + (Math.random() * 8 - 4)}vw`,
                `${flag.x + (Math.random() * 12 - 6)}vw`
              ]
            }}
            transition={{
              duration: flag.duration,
              repeat: Infinity,
              delay: flag.delay,
              ease: 'linear'
            }}
            className="absolute select-none pointer-events-none"
            style={{ width: flag.size }}
          >
            <img
              src="https://acegif.com/wp-content/uploads/gifs/pakistan-flag-19.gif"
              alt="Flying Pakistan Flag"
              style={{ width: '100%', height: 'auto', display: 'block' }}
            />
          </motion.div>
        ))}
      </div>

      {/* Left panel - brand showcase */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden z-10" style={{ backgroundColor: '#0d1f1e' }}>
        {/* Gradient background */}
        <div
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(42, 167, 160, 0.2), transparent)'
          }}
        />

        {/* Subtle grid */}
        <div
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }}
        />

        <div className="relative z-10 flex flex-col justify-center px-16 py-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            {/* Logo */}
            <div className="mb-12">
              <BenchmarkLogo size="lg" />
            </div>

            {/* Headline */}
            <h1 className="text-5xl font-bold text-white leading-[1.1] tracking-tight">
              Benchmark
              <br />
              <span style={{ color: '#2AA7A0' }}>Management System</span>
            </h1>

            <p className="mt-6 text-lg max-w-md leading-relaxed" style={{ color: 'rgba(42, 167, 160, 0.7)' }}>
              Enterprise workflow management for high-volume project operations across multiple regions.
            </p>
          </motion.div>
        </div>
      </div>

      {/* Right panel - form */}
      <div className="flex-1 flex items-center justify-center px-8 bg-white z-10 relative">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="w-full max-w-md"
        >
          {/* Mobile logo */}
          <div className="lg:hidden mb-8">
            <BenchmarkLogo size="md" />
          </div>

          <div className="flex justify-between items-end pt-8 mb-10">
            <div>
              <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Welcome back</h2>
              <p className="text-slate-500 mt-2">Sign in to continue to your dashboard.</p>
            </div>
            {/* Pakistan Flag Gif element */}
            <div className="flex flex-col items-center shrink-0 ml-4">
              <img
                src="https://acegif.com/wp-content/uploads/gifs/pakistan-flag-19.gif"
                alt="Pakistan Flag"
                className="w-24 h-auto"
              />
              <span className="text-[9px] font-bold text-emerald-600 mt-1 uppercase tracking-wider animate-pulse whitespace-nowrap">
                Happy Independence Day
              </span>
            </div>
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 p-4 rounded-xl flex items-center gap-3 bg-red-50 border border-red-200"
            >
              <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
              <span className="text-sm text-red-700">{error}</span>
            </motion.div>
          )}

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Email address</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-[#2AA7A0] focus:ring-2 focus:ring-[#2AA7A0]/20 transition-all"
                placeholder="you@benchmark.com"
                autoComplete="email"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-[#2AA7A0] focus:ring-2 focus:ring-[#2AA7A0]/20 transition-all pr-12"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 text-white font-semibold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 active:scale-[0.98]"
              style={{
                backgroundColor: '#2AA7A0',
                boxShadow: '0 10px 25px -5px rgba(42, 167, 160, 0.3)'
              }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#239089')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#2AA7A0')}
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <LogIn className="w-5 h-5" />
                  Sign In
                </>
              )}
            </button>
          </form>

          <div className="mt-10 pt-6 border-t border-slate-100">
            <p className="text-center text-sm text-slate-400">
              🔒 Single-device authentication enforced
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
