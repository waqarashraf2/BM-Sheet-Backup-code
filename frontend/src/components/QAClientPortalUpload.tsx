import { useEffect, useMemo, useState } from 'react';
import type { Order } from '../types';
import { workflowService, type ClientPortalUploadStatus } from '../services';
import { Button } from './ui';
import { CheckCircle2, Loader2, Send, UploadCloud } from 'lucide-react';

const MAX_CLIENT_PORTAL_UPLOAD_BYTES = 600 * 1024 * 1024;

interface QAClientPortalUploadProps {
  order: Order;
  onStatusChange: (status: ClientPortalUploadStatus) => void;
}

function fileNameContainsOrderReference(fileName: string, orderReference: string): boolean {
  const baseName = fileName.replace(/\.[^.]+$/, '');
  const escaped = orderReference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, 'i').test(baseName);
}

function formatFileSize(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

export default function QAClientPortalUpload({ order, onStatusChange }: QAClientPortalUploadProps) {
  const [status, setStatus] = useState<ClientPortalUploadStatus | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<'status' | 'upload' | 'submit' | null>('status');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);

  const orderId = String(status?.job_order_id || order.client_reference || order.client_portal_id || order.order_number || '').trim();
  const invalidNames = useMemo(
    () => files.filter(file => !fileNameContainsOrderReference(file.name, orderId)),
    [files, orderId],
  );
  const oversizedFiles = useMemo(
    () => files.filter(file => file.size > MAX_CLIENT_PORTAL_UPLOAD_BYTES),
    [files],
  );

  useEffect(() => {
    let active = true;
    setBusy('status');
    workflowService.getClientPortalUploadStatus(order.id)
      .then(response => {
        if (active) {
          setStatus(response.data);
          onStatusChange(response.data);
        }
      })
      .catch((e: any) => {
        if (active) setError(e.response?.data?.message || 'Could not load client portal status.');
      })
      .finally(() => {
        if (active) setBusy(null);
      });

    return () => { active = false; };
  }, [onStatusChange, order.id]);

  if (busy === 'status' && !status) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking client portal requirements...
      </div>
    );
  }

  if (!status?.required) return null;

  const uploadFiles = async () => {
    if (!files.length || invalidNames.length || oversizedFiles.length) return;
    setBusy('upload');
    setError('');
    setMessage('');
    setUploadProgress(0);
    try {
      const response = await workflowService.uploadToClientPortal(order.id, files, undefined, setUploadProgress);
      setStatus(response.data.status);
      onStatusChange(response.data.status);
      setMessage(response.data.message);
    } catch (e: any) {
      const statusCode = e.response?.status;
      const serverMessage = e.response?.data?.message || e.response?.data?.errors?.files?.[0];
      setError(
        statusCode === 404 || statusCode === 405
          ? 'Upload route is not available on the backend server yet. Please deploy the latest backend routes and clear the Laravel route cache.'
          : serverMessage || 'Upload failed.'
      );
    } finally {
      setBusy(null);
      setUploadProgress(0);
    }
  };

  const submitOrder = async () => {
    setBusy('submit');
    setError('');
    setMessage('');
    try {
      const response = await workflowService.submitClientPortalOrder(order.id);
      setStatus(response.data.status);
      onStatusChange(response.data.status);
      setMessage(response.data.message);
    } catch (e: any) {
      setError(e.response?.data?.message || 'Client portal submission failed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/60 p-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">Client Portal Upload</h3>
        <p className="mt-1 text-xs text-slate-600">
          Original filename is preserved. The filename before extension must include <b>{orderId}</b>.
        </p>
      </div>

      {status.submitted ? (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-100 px-3 py-2 text-sm font-medium text-emerald-800">
          <CheckCircle2 className="h-4 w-4" /> Uploaded and submitted successfully.
        </div>
      ) : (
        <>
          <input
            type="file"
            multiple
            accept="image/*,.zip,application/zip,application/x-zip-compressed"
            onChange={event => setFiles(Array.from(event.target.files || []))}
            className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-white file:px-3 file:py-2 file:text-xs file:font-semibold file:text-blue-700"
          />

          {invalidNames.length > 0 && (
            <p className="text-xs font-medium text-rose-700">
              Filename must include {orderId}. Invalid: {invalidNames.map(file => file.name).join(', ')}
            </p>
          )}

          {oversizedFiles.length > 0 && (
            <p className="text-xs font-medium text-rose-700">
              Each file must be 600 MB or less. Oversized: {oversizedFiles.map(file => `${file.name} (${formatFileSize(file.size)})`).join(', ')}
            </p>
          )}

          {busy === 'upload' && (
            <div>
              <div className="flex items-center justify-between text-xs font-medium text-slate-600">
                <span>{uploadProgress < 100 ? 'Uploading to server' : 'Uploading to client portal'}</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-blue-100">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              {uploadProgress >= 100 && (
                <p className="mt-1 text-xs text-slate-600">Waiting for client portal response...</p>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={uploadFiles}
              loading={busy === 'upload'}
              disabled={!files.length || invalidNames.length > 0 || oversizedFiles.length > 0 || busy !== null}
              icon={<UploadCloud className="h-4 w-4" />}
            >
              Upload Files
            </Button>
            <Button
              size="sm"
              onClick={submitOrder}
              loading={busy === 'submit'}
              disabled={!status.uploaded || busy !== null}
              icon={<Send className="h-4 w-4" />}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              Submit to Client Portal
            </Button>
          </div>
        </>
      )}

      {message && <p className="text-xs font-medium text-emerald-700">{message}</p>}
      {error && <p className="text-xs font-medium text-rose-700">{error}</p>}
    </div>
  );
}
