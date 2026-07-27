import { useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState } from './store/store';
import { authService } from './services';
import { setCredentials, logout, setLoading } from './store/slices/authSlice';
import Login from './pages/Auth/Login';
import Layout from './components/Layout/Layout';
import ProtectedRoute from './components/Auth/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';


// ─── Lazy-loaded page components (code-split per route) ───
const Dashboard = lazy(() => import('./pages/Dashboard/Dashboard'));

const CEODashboard = lazy(() => import('./pages/Dashboard/CEODashboard').catch(() => { window.location.reload(); return import('./pages/Dashboard/CEODashboard'); }));
const OperationsManagerDashboard = lazy(() => import('./pages/Dashboard/OperationsManagerDashboard'));
const ProjectManagerDashboard = lazy(() => import('./pages/Dashboard/ProjectManagerDashboard'));
const WorkerDashboard = lazy(() => import('./pages/Dashboard/WorkerDashboard'));
const AccountsManagerDashboard = lazy(() => import('./pages/Dashboard/AccountsManagerDashboard'));
const HRDashboard = lazy(() => import('./pages/Dashboard/HRDashboard'));
const BatchStatus = lazy(() => import('./pages/Dashboard/BatchStatus'));
const ColumnAssignment = lazy(() => import('./pages/Dashboard/ColumnAssignment'));

const ProjectManagement = lazy(() => import('./pages/Projects/ProjectManagement'));
const UserManagement = lazy(() => import('./pages/Users/UserManagement'));
const InvoiceManagement = lazy(() => import('./pages/Invoices/InvoiceManagement'));
const OMMonthlyQuantity = lazy(() => import('./pages/Invoices/OMMonthlyQuantity'));
const WorkQueue = lazy(() => import('./pages/Workflow/WorkQueue'));
const ImportOrders = lazy(() => import('./pages/Workflow/ImportOrders'));
const RejectedOrders = lazy(() => import('./pages/Workflow/RejectedOrders'));
const OrderAssetLinks = lazy(() => import('./pages/Workflow/OrderAssetLinks'));
const ClientUpload = lazy(() => import('./pages/Workflow/ClientUpload'));
const ClientPortalInProgress = lazy(() => import('./pages/Workflow/ClientPortalInProgress'));
const SupervisorAssignment = lazy(() => import('./pages/Workflow/SupervisorAssignment'));
const PMAssignment = lazy(() => import('./pages/Workflow/PMAssignment'));
const PMProjectAssignment = lazy(() => import('./pages/Management/PMProjectAssignment'));
const OMProjectAssignment = lazy(() => import('./pages/Management/OMProjectAssignment'));
const TransferLog = lazy(() => import('./pages/Management/TransferLog'));
const QATeamAssignment = lazy(() => import('./pages/Workflow/QATeamAssignment'));
const CheckerTeamAssignment = lazy(() => import('./pages/Workflow/CheckerTeamAssignment'));
const LiveQADashboard = lazy(() => import('./pages/LiveQA/LiveQADashboard'));
const InternalQADashboard = lazy(() => import('./pages/InternalQA/InternalQADashboard'));

// ─── Loading fallback for lazy routes ───
function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-slate-500">Loading...</span>
      </div>
    </div>
  );
}

function App() {
  const dispatch = useDispatch();
  const { isAuthenticated, user, token } = useSelector((state: RootState) => state.auth);

  // Restore session on page refresh: if token exists but user is not loaded,
  // fetch the profile to re-establish authentication state
  useEffect(() => {
    if (token && !isAuthenticated && !user) {
      authService.profile()
        .then((res: any) => {
          dispatch(setCredentials({ user: res.data, token }));
        })
        .catch(() => {
          // Token is invalid/expired — clear it
          dispatch(logout());
        })
        .finally(() => {
          dispatch(setLoading(false));
        });
    }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Session monitoring effect
  useEffect(() => {
    if (isAuthenticated) {
      let cancelled = false;
      // Set up session check interval (every 2 minutes)
      const sessionCheck = setInterval(async () => {
        try {
          await authService.sessionCheck();
        } catch {
          // Session invalid — the Axios 401 interceptor already handles
          // the redirect, so we only need to clean up here if it hasn't
          // fired yet (e.g. network error vs 401).
          if (!cancelled) {
            clearInterval(sessionCheck);
          }
        }
      }, 2 * 60 * 1000);

      return () => { cancelled = true; clearInterval(sessionCheck); };
    }
  }, [isAuthenticated]);



  const getDashboardRoute = () => {
    if (!user) return <Navigate to="/login" />;

    switch (user.role) {
      case 'ceo':
      case 'director':
        return <CEODashboard />;
      case 'operations_manager':
        return <OperationsManagerDashboard />;
      case 'project_manager':
        return <ProjectManagerDashboard />;
      case 'drawer':
      case 'checker':
      case 'filler':
      case 'qa':
      case 'designer':
        return <WorkerDashboard />;
      case 'accounts_manager':
        return <AccountsManagerDashboard />;
      case 'hr':
        return <HRDashboard />;
      case 'live_qa':
        return <LiveQADashboard />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Suspense fallback={<PageLoader />}>{getDashboardRoute()}</Suspense>} />
            <Route path="dashboard" element={<Suspense fallback={<PageLoader />}>{getDashboardRoute()}</Suspense>} />

            <Route
              path="projects/*"
              element={
                <ProtectedRoute allowedRoles={['ceo', 'director', 'operations_manager', 'project_manager']}>
                  <ProjectManagement />
                </ProtectedRoute>
              }
            />
            <Route
              path="dashboard/assignment-columns/*"
              element={
                <ProtectedRoute allowedRoles={['ceo', 'director', 'project_manager', 'operations_manager', 'qa']}>
                  <Suspense fallback={<PageLoader />}>
                    <ColumnAssignment />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="users/*"
              element={
                <ProtectedRoute allowedRoles={['ceo', 'director', 'operations_manager', 'project_manager']}>
                  <UserManagement />
                </ProtectedRoute>
              }
            />
            <Route
              path="hr-panel/*"
              element={
                <ProtectedRoute allowedRoles={['ceo', 'hr', 'director']}>
                  <HRDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="batch-status/*"
              element={
                <ProtectedRoute allowedRoles={['operations_manager', 'project_manager', 'qa']}>
                  <BatchStatus />
                </ProtectedRoute>
              }
            />
            <Route
              path="invoices/*"
              element={
                <ProtectedRoute allowedRoles={['ceo', 'director', 'accounts_manager']}>
                  <InvoiceManagement />
                </ProtectedRoute>
              }
            />
            <Route
              path="monthly-quantities/*"
              element={
                <ProtectedRoute allowedRoles={['operations_manager', 'ceo', 'director']}>
                  <Suspense fallback={<PageLoader />}>
                    <OMMonthlyQuantity />
                  </Suspense>
                </ProtectedRoute>
              }
            />

            <Route
              path="work/*"
              element={
                <ProtectedRoute allowedRoles={['drawer', 'checker', 'filler', 'qa', 'designer']}>
                  <WorkQueue />
                </ProtectedRoute>
              }
            />

            <Route
              path="order-assets/:jobOrderId"
              element={
                <ProtectedRoute allowedRoles={['ceo', 'director', 'operations_manager', 'project_manager', 'drawer', 'checker', 'filler', 'qa', 'designer']}>
                  <OrderAssetLinks />
                </ProtectedRoute>
              }
            />

            <Route
              path="client-upload/:orderId"
              element={
                <ProtectedRoute allowedRoles={['operations_manager', 'project_manager', 'qa']}>
                  <ClientUpload />
                </ProtectedRoute>
              }
            />

            <Route
              path="client-portal-in-progress/*"
              element={
                <ProtectedRoute allowedRoles={['operations_manager', 'project_manager', 'qa']}>
                  <ClientPortalInProgress />
                </ProtectedRoute>
              }
            />

            <Route
              path="import/*"
              element={
                <ProtectedRoute allowedRoles={['director', 'operations_manager', 'project_manager', 'qa']}>
                  <ImportOrders />
                </ProtectedRoute>
              }
            />

            <Route
              path="rejected/*"
              element={
                <ProtectedRoute allowedRoles={['director', 'operations_manager', 'project_manager', 'drawer', 'checker', 'filler', 'qa', 'designer']}>
                  <RejectedOrders />
                </ProtectedRoute>
              }
            />

            <Route
              path="assign/*"
              element={
                <ProtectedRoute allowedRoles={['ceo', 'director', 'operations_manager', 'project_manager', 'qa']}>
                  <SupervisorAssignment />
                </ProtectedRoute>
              }
            />

            <Route
              path="pm-assign/*"
              element={
                <ProtectedRoute allowedRoles={['ceo', 'director', 'operations_manager']}>
                  <PMAssignment />
                </ProtectedRoute>
              }
            />

            <Route
              path="pm-projects/*"
              element={
                <ProtectedRoute allowedRoles={['operations_manager']}>
                  <PMProjectAssignment />
                </ProtectedRoute>
              }
            />

            <Route
              path="om-projects/*"
              element={
                <ProtectedRoute allowedRoles={['ceo', 'director']}>
                  <OMProjectAssignment />
                </ProtectedRoute>
              }
            />

            <Route
              path="transfer-log/*"
              element={
                <ProtectedRoute allowedRoles={['ceo', 'director', 'operations_manager']}>
                  <TransferLog />
                </ProtectedRoute>
              }
            />

            <Route
              path="qa-team/*"
              element={
                <ProtectedRoute allowedRoles={['qa']}>
                  <QATeamAssignment />
                </ProtectedRoute>
              }
            />

            <Route
              path="checker-team/*"
              element={
                <ProtectedRoute allowedRoles={['checker']}>
                  <Suspense fallback={<PageLoader />}>
                    <CheckerTeamAssignment />
                  </Suspense>
                </ProtectedRoute>
              }
            />

            <Route
              path="live-qa/*"
              element={
                <ProtectedRoute allowedRoles={['live_qa', 'ceo', 'director', 'checker', 'qa']}>
                  <LiveQADashboard />
                </ProtectedRoute>
              }
            />

            <Route
              path="internal-qa/*"
              element={
                <ProtectedRoute allowedRoles={['live_qa', 'ceo', 'director', 'operations_manager']}>
                  <Suspense fallback={<PageLoader />}>
                    <InternalQADashboard />
                  </Suspense>
                </ProtectedRoute>
              }
            />
          </Route>

          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

export default App;
