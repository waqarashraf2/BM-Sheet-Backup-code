import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { dashboardService } from '../../services';
import { Download, ExternalLink, Image as ImageIcon, Loader2, Search } from 'lucide-react';

type AssetLink = {
  source: string;
  source_table: string | null;
  project_id: number;
  job_order_id: string;
  id: number | null;
  name: string;
  url: string;
  link_type: string;
  meta: Record<string, unknown> | null;
};

type AssetOrderResult = {
  project: {
    id: number;
    code: string;
    name: string;
    workflow_type: string;
  };
  order: {
    id: number;
    order_number: string;
    client_reference: string | null;
    client_name: string | null;
    client_portal_id: string | null;
    clint_order_number: string | null;
    client_order_number: string | null;
  };
  job_order_id: string;
  count: number;
  links: AssetLink[];
};

type AssetSearchResponse = {
  search: string;
  project_id: number | null;
  count: number;
  orders: AssetOrderResult[];
};

interface ManagerOrderAssetLinksViewProps {
  projects: Array<{
    id: number;
    code: string;
    name: string;
  }>;
}

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.svg'];

function isImageLike(name: string, url: string): boolean {
  const lowerName = String(name || '').toLowerCase();
  const lowerUrl = String(url || '').toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lowerName.endsWith(ext) || lowerUrl.includes(ext));
}

function linkKey(link: AssetLink): string {
  return `${link.source_table || link.source}-${link.id ?? link.url}`;
}

export default function ManagerOrderAssetLinksView({ projects }: ManagerOrderAssetLinksViewProps) {
  const [search, setSearch] = useState('');
  const [projectId, setProjectId] = useState('');
  const [data, setData] = useState<AssetSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewedImages, setPreviewedImages] = useState<Record<string, boolean>>({});
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});

  const projectOptions = useMemo(() => {
    return [...projects].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [projects]);

  const handleSearch = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedSearch = search.trim();
    if (!trimmedSearch) {
      setData(null);
      setError('Enter an order number or order reference to search.');
      return;
    }

    setLoading(true);
    setError(null);
    setPreviewedImages({});
    setBrokenImages({});

    try {
      const response = await dashboardService.orderAssetLinks({
        search: trimmedSearch,
        ...(projectId ? { project_id: Number(projectId) } : {}),
      });
      setData(response.data);
    } catch (e: any) {
      setData(null);
      setError(e?.response?.data?.message || 'Unable to fetch image links right now.');
    } finally {
      setLoading(false);
    }
  };

  const downloadFile = async (url: string, name: string) => {
    try {
      const response = await fetch(url, { mode: 'cors' });
      if (!response.ok) throw new Error(`Download failed with status ${response.status}`);

      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = name || 'image';
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-5">
        <form onSubmit={handleSearch} className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_260px_auto] gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">
              Order Number / Reference
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search exact order number or reference"
                className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none bg-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">
              Project
            </label>
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none bg-white"
            >
              <option value="">All assigned projects</option>
              {projectOptions.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.code} - {project.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={loading}
              className="inline-flex w-full lg:w-auto items-center justify-center gap-2 px-4 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Search
            </button>
          </div>
        </form>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 text-sm">
          {error}
        </div>
      )}

      {!data && !loading && !error && (
        <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-10 text-center">
          <ImageIcon className="w-10 h-10 text-slate-400 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-slate-800 mb-1">Search for image links</h3>
          <p className="text-sm text-slate-500">No orders are shown until you search.</p>
        </div>
      )}

      {data && data.orders.length === 0 && (
        <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-10 text-center">
          <ImageIcon className="w-10 h-10 text-slate-400 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-slate-800 mb-1">No matching order found</h3>
          <p className="text-sm text-slate-500">Try another order number or order reference.</p>
        </div>
      )}

      {data && data.orders.length > 0 && (
        <div className="space-y-5">
          {data.orders.map((result) => {
            const imageLinks = result.links.filter((link) => isImageLike(link.name, link.url));
            const otherLinks = result.links.filter((link) => !isImageLike(link.name, link.url));

            return (
              <div key={`${result.project.id}-${result.order.id}`} className="bg-white rounded-xl ring-1 ring-black/[0.04] overflow-hidden">
                <div className="p-5 border-b border-slate-100">
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        Order {result.order.order_number || result.job_order_id}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        {result.project.code} - {result.project.name} | Lookup ID: {result.job_order_id || '-'}
                      </div>
                    </div>
                    <div className="text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 w-max">
                      {result.count} link{result.count === 1 ? '' : 's'}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4 text-sm">
                    <div>
                      <div className="text-slate-500">Client</div>
                      <div className="font-medium text-slate-900 break-all">{result.order.client_name || '-'}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">Order Reference</div>
                      <div className="font-medium text-slate-900 break-all">{result.order.client_reference || '-'}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">Client Portal ID</div>
                      <div className="font-medium text-slate-900 break-all">{result.order.client_portal_id || '-'}</div>
                    </div>
                  </div>
                </div>

                {result.links.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-500">
                    No asset links found for this order.
                  </div>
                ) : (
                  <div className="p-5 space-y-5">
                    {imageLinks.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-slate-700 mb-3">Image Assets</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                          {imageLinks.map((link) => {
                            const key = linkKey(link);
                            const previewed = !!previewedImages[key];
                            const broken = !!brokenImages[key];

                            return (
                              <div key={key} className="rounded-xl ring-1 ring-black/[0.05] overflow-hidden">
                                <div className="h-52 bg-slate-100 flex items-center justify-center">
                                  {broken ? (
                                    <div className="text-slate-500 text-sm">Preview unavailable</div>
                                  ) : previewed ? (
                                    <img
                                      src={link.url}
                                      alt={link.name}
                                      className="w-full h-full object-cover"
                                      loading="lazy"
                                      onError={() => setBrokenImages((prev) => ({ ...prev, [key]: true }))}
                                    />
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => setPreviewedImages((prev) => ({ ...prev, [key]: true }))}
                                      className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-white"
                                    >
                                      <ImageIcon className="w-4 h-4" />
                                      Preview
                                    </button>
                                  )}
                                </div>

                                <div className="p-3">
                                  <div className="text-sm font-semibold text-slate-800 truncate" title={link.name}>
                                    {link.name || 'Image'}
                                  </div>
                                  <div className="text-xs text-slate-500 mt-1">
                                    {link.link_type || 'asset'} | Project {link.project_id}
                                  </div>
                                  <div className="mt-3 flex items-center gap-2">
                                    <a
                                      href={link.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                                    >
                                      <ExternalLink className="w-3.5 h-3.5" />
                                      Open
                                    </a>
                                    <button
                                      type="button"
                                      onClick={() => void downloadFile(link.url, link.name)}
                                      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                                    >
                                      <Download className="w-3.5 h-3.5" />
                                      Download
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {otherLinks.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-slate-700 mb-3">Other Asset Links</h3>
                        <div className="divide-y divide-slate-100 rounded-xl ring-1 ring-black/[0.05] overflow-hidden">
                          {otherLinks.map((link) => (
                            <div key={linkKey(link)} className="p-3 flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-slate-800 truncate" title={link.name}>
                                  {link.name || 'Asset link'}
                                </div>
                                <div className="text-xs text-slate-500">{link.link_type || 'asset'} | Project {link.project_id}</div>
                              </div>
                              <a
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                                Open
                              </a>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
