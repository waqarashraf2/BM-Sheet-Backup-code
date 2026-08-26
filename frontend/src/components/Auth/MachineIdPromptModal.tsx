import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import { Monitor, X, Check, AlertCircle, ArrowRight, ShieldCheck, Sparkles } from 'lucide-react';
import type { RootState } from '../../store/store';
import { updateUser } from '../../store/slices/authSlice';
import { authService } from '../../services';

export default function MachineIdPromptModal() {
  const dispatch = useDispatch();
  const { user, isAuthenticated } = useSelector((state: RootState) => state.auth);

  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [machineId, setMachineId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [successMessage, setSuccessMessage] = useState<string>('');

  useEffect(() => {
    // Only check when user is authenticated
    if (isAuthenticated && user) {
      const hasMachineId = user.machine_id !== null && user.machine_id !== undefined && String(user.machine_id).trim() !== '';
      const dismissedKey = `machine_id_prompt_dismissed_${user.id}`;
      const isDismissed = sessionStorage.getItem(dismissedKey) === 'true';

      // Only show popup if machine_id is NULL or empty AND not dismissed in current login session
      if (!hasMachineId && !isDismissed) {
        setIsOpen(true);
      } else {
        setIsOpen(false);
      }
    } else {
      setIsOpen(false);
    }
  }, [isAuthenticated, user]);

  const handleClose = () => {
    if (user?.id) {
      sessionStorage.setItem(`machine_id_prompt_dismissed_${user.id}`, 'true');
    }
    setIsOpen(false);
    setErrorMessage('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = machineId.trim();

    if (!trimmed) {
      setErrorMessage('Please enter a valid Machine ID.');
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage('');
      setSuccessMessage('');

      const res = await authService.updateMachineId(trimmed);
      if (res.data?.user) {
        dispatch(updateUser(res.data.user));
      }

      setSuccessMessage('Machine ID registered successfully!');
      
      // Clear dismissed key since it is now configured
      if (user?.id) {
        sessionStorage.removeItem(`machine_id_prompt_dismissed_${user.id}`);
      }

      setTimeout(() => {
        setIsOpen(false);
        setSuccessMessage('');
      }, 1000);
    } catch (err: any) {
      const serverMsg = err.response?.data?.message || err.response?.data?.error || 'Failed to update Machine ID. Please try again.';
      setErrorMessage(serverMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={handleClose}
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm"
        />

        {/* Modal Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 16 }}
          transition={{ type: 'spring', damping: 25, stiffness: 350 }}
          className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden z-10"
        >
          {/* Top Decorative Banner */}
          <div className="bg-gradient-to-r from-teal-600 via-emerald-600 to-teal-700 px-6 pt-6 pb-5 text-white relative">
            <button
              onClick={handleClose}
              type="button"
              className="absolute top-4 right-4 p-1.5 rounded-full text-white/80 hover:text-white hover:bg-white/20 transition-colors focus:outline-none"
              title="Close & Skip"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3.5 mb-2">
              <div className="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center shadow-inner border border-white/30 text-white">
                <Monitor className="w-6 h-6" />
              </div>
              <div>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-white/25 text-white border border-white/20">
                  <Sparkles className="w-2.5 h-2.5" /> Action Required
                </span>
                <h3 className="text-lg font-bold text-white mt-0.5">
                  Add Machine ID
                </h3>
              </div>
            </div>

            <p className="text-xs text-teal-50/90 leading-relaxed">
              Welcome, <span className="font-semibold text-white">{user?.name || 'User'}</span>! Please link your physical workstation ID to complete your profile.
            </p>
          </div>

          {/* Form Content */}
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {errorMessage && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-50 border border-rose-200/80 text-rose-700 text-xs"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="flex-1 font-medium">{errorMessage}</span>
              </motion.div>
            )}

            {successMessage && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-start gap-2.5 p-3 rounded-xl bg-emerald-50 border border-emerald-200/80 text-emerald-700 text-xs"
              >
                <Check className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="flex-1 font-medium">{successMessage}</span>
              </motion.div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="machine_id_input" className="block text-xs font-bold text-slate-700 uppercase tracking-wide">
                Machine / System ID <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <input
                  id="machine_id_input"
                  type="text"
                  autoFocus
                  disabled={isSubmitting || !!successMessage}
                  value={machineId}
                  onChange={(e) => {
                    setMachineId(e.target.value);
                    if (errorMessage) setErrorMessage('');
                  }}
                  placeholder="e.g. 101, 204, or M-04"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all disabled:opacity-50"
                />
              </div>
              <p className="text-[11px] text-slate-500">
                You can find your Machine ID on your desk sticker or system label.
              </p>
            </div>

            {/* Actions */}
            <div className="pt-2 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={handleClose}
                disabled={isSubmitting}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors disabled:opacity-50"
              >
                Remind Me Later
              </button>

              <button
                type="submit"
                disabled={isSubmitting || !machineId.trim() || !!successMessage}
                className="inline-flex items-center gap-2 px-5 py-2 text-xs font-bold text-white bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 rounded-xl shadow-md shadow-teal-600/20 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : successMessage ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Saved</span>
                  </>
                ) : (
                  <>
                    <span>Save Machine ID</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
