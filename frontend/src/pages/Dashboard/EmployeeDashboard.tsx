import { useEffect, useState, useCallback } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store/store';
import { hrService } from '../../services';
import type { UserDocument } from '../../types';
import {
  FileText,
  Download,
  Shield,
  User as UserIcon,
  Mail,
  Cpu,
  Building,
  Calendar,
  RefreshCw,
  AlertCircle,
  FileCheck,
} from 'lucide-react';
import { AnimatedPage, Button, StatusBadge } from '../../components/ui';

const docTypeLabels: Record<string, string> = {
  copy_of_cnic: 'Copy of CNIC',
  two_pics: 'Passport Size Photos (2 Pics)',
  nda: 'Non-Disclosure Agreement (NDA)',
  contract_letter: 'Appointment / Contract Letter',
  extra: 'Additional Document',
};

export default function EmployeeDashboard() {
  const { user } = useSelector((state: RootState) => state.auth);
  const [documents, setDocuments] = useState<UserDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const loadDocuments = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await hrService.myDocuments();
      setDocuments(res.data?.data || []);
    } catch (e: any) {
      console.error('Failed to load my documents', e);
      setError(e.response?.data?.message || 'Could not load your documents.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const handleDownload = async (doc: UserDocument) => {
    try {
      setDownloadingId(doc.id);
      const res = await hrService.downloadMyDocument(doc.id);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', doc.original_name || 'document');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Download failed', e);
      alert('Could not download document. Please try again.');
    } finally {
      setDownloadingId(null);
    }
  };

  const formatFileSize = (bytes?: number | null) => {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const roleLabel = (user?.role || '').toUpperCase();

  return (
    <AnimatedPage>
      <div className="space-y-6 pb-12">
        {/* Header Banner */}
        <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-teal-950 to-slate-900 p-6 text-white shadow-xl">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-500/20 text-teal-400 ring-1 ring-teal-500/30">
                <UserIcon className="h-7 w-7" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold">{user?.name || 'Employee Portal'}</h1>
                  <span className="rounded-full bg-teal-500/20 px-2.5 py-0.5 text-xs font-semibold text-teal-300 ring-1 ring-teal-500/30">
                    {roleLabel}
                  </span>
                </div>
                <p className="text-xs text-slate-300">
                  Welcome to Benchmark Studio Employee Portal. Access your official profile and documents.
                </p>
              </div>
            </div>

            <Button
              variant="secondary"
              icon={RefreshCw}
              onClick={loadDocuments}
              loading={loading}
              className="bg-white/10 text-white hover:bg-white/20 border-white/20"
            >
              Refresh
            </Button>
          </div>
        </div>

        {/* Profile Card & Info */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-slate-400">
              <Mail className="h-4 w-4 text-teal-600" />
              Email Address
            </div>
            <div className="text-sm font-medium text-slate-900 truncate" title={user?.email}>
              {user?.email || '—'}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-slate-400">
              <Cpu className="h-4 w-4 text-teal-600" />
              Machine ID
            </div>
            <div className="text-sm font-semibold text-slate-900">
              {user?.machine_id ? `#${user.machine_id}` : 'Not Assigned'}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-slate-400">
              <Building className="h-4 w-4 text-teal-600" />
              Department
            </div>
            <div className="text-sm font-medium text-slate-900 capitalize">
              {(user?.department || 'General').replace('_', ' ')}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-slate-400">
              <Shield className="h-4 w-4 text-teal-600" />
              Account Status
            </div>
            <div>
              <StatusBadge status={user?.is_active ? 'active' : 'inactive'} />
            </div>
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* My Documents Section */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50/50 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileCheck className="h-5 w-5 text-teal-600" />
              <div>
                <h2 className="text-base font-semibold text-slate-900">My Official Documents</h2>
                <p className="text-xs text-slate-500">
                  Documents verified and uploaded by HR Department for your employee profile.
                </p>
              </div>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
              {documents.length} {documents.length === 1 ? 'Document' : 'Documents'}
            </span>
          </div>

          {loading ? (
            <div className="flex h-48 items-center justify-center text-sm text-slate-400">
              <RefreshCw className="mr-2 h-5 w-5 animate-spin text-teal-600" />
              Loading your documents...
            </div>
          ) : documents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 mb-3">
                <FileText className="h-8 w-8" />
              </div>
              <h3 className="text-sm font-semibold text-slate-800">No Documents Uploaded Yet</h3>
              <p className="text-xs text-slate-500 max-w-sm mt-1">
                Your HR-issued appointment letter, NDA, and other onboarding documents will appear here once uploaded by HR.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between hover:bg-slate-50/80 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-600">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">
                        {docTypeLabels[doc.document_type] || doc.document_type}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mt-0.5">
                        <span className="truncate max-w-[200px] text-slate-500">{doc.original_name}</span>
                        <span>&bull;</span>
                        <span>{formatFileSize(doc.file_size)}</span>
                        {doc.created_at && (
                          <>
                            <span>&bull;</span>
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {new Date(doc.created_at).toLocaleDateString()}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <Button
                    variant="secondary"
                    size="sm"
                    icon={Download}
                    onClick={() => handleDownload(doc)}
                    loading={downloadingId === doc.id}
                    className="self-end sm:self-center"
                  >
                    Download
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AnimatedPage>
  );
}
