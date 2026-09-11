import React, { useState, useEffect, useMemo } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store/store';
import {
  amendService,
  projectService,
  type AmendOrder,
} from '../../services';
import type { Project } from '../../types';
import {
  AnimatedPage,
  Button,
  Modal,
  useToast,
} from '../../components/ui';
import ClockDisplay from '../../components/ClockDisplay';
import {
  RefreshCw,
  Search,
  CheckCircle,
  Clock,
  AlertCircle,
  Send,
  Eye,
  CheckSquare,
  Sparkles,
  Layers,
  User,
  ShieldCheck,
  UploadCloud,
  X,
  Info,
  Building,
} from 'lucide-react';

const DEFAULT_PROJECT_TIMEZONE = 'Asia/Karachi';

type AmendCategoryType = 'Team Mistake' | 'Request' | 'Amender Mistake';

export default function AmendAssignmentDashboard() {
  const { user } = useSelector((state: RootState) => state.auth);
  const { toast } = useToast();

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | 'all'>('all');
  const [orders, setOrders] = useState<AmendOrder[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [fetchingPortal, setFetchingPortal] = useState<boolean>(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const [counts, setCounts] = useState({
    total: 0,
    pending: 0,
    in_progress: 0,
    amender_done: 0,
    delivered: 0,
  });

  // Selected Amend Category during submission
  const [selectedCategory, setSelectedCategory] = useState<AmendCategoryType>('Request');

  // Amender "Done & Add Points" Modal
  const [amenderDoneModalOpen, setAmenderDoneModalOpen] = useState<boolean>(false);
  const [orderForAmenderDone, setOrderForAmenderDone] = useState<AmendOrder | null>(null);
  const [amenderChecklist, setAmenderChecklist] = useState({
    dimensions_verified: true,
    text_and_labels_corrected: true,
    symbols_and_doors_checked: true,
    client_notes_addressed: true,
    visual_quality_cleared: true,
  });
  const [amenderNotesContent, setAmenderNotesContent] = useState<string>('');
  const [submittingDone, setSubmittingDone] = useState<boolean>(false);

  // Direct Amender / Manager "Check & Deliver" Modal
  const [deliverModalOpen, setDeliverModalOpen] = useState<boolean>(false);
  const [orderForDeliver, setOrderForDeliver] = useState<AmendOrder | null>(null);
  const [deliverChecklist, setDeliverChecklist] = useState({
    dimensions_verified: true,
    text_and_labels_corrected: true,
    symbols_and_doors_checked: true,
    client_notes_addressed: true,
    visual_quality_cleared: true,
  });
  const [reviewerComments, setReviewerComments] = useState<string>('');
  const [submittingDeliver, setSubmittingDeliver] = useState<boolean>(false);

  // View Notes Modal
  const [notesModalOpen, setNotesModalOpen] = useState<boolean>(false);
  const [orderForNotes, setOrderForNotes] = useState<AmendOrder | null>(null);

  // View Points (JSON) Modal
  const [pointsModalOpen, setPointsModalOpen] = useState<boolean>(false);
  const [orderForPoints, setOrderForPoints] = useState<AmendOrder | null>(null);

  // Role permissions
  const isManagerOrDirector =
    user?.role &&
    ['operations_manager', 'project_manager', 'director', 'ceo', 'admin'].includes(user.role);
  const isDirectAmender = user?.role === 'direct_amender';
  const isPrimaryAmender = user?.role === 'amender';

  // Selected project data
  const selectedProjectData =
    selectedProjectId !== 'all' ? projects.find((p) => p.id === selectedProjectId) : null;
  const projectTz = selectedProjectData?.timezone || DEFAULT_PROJECT_TIMEZONE;

  // Load Projects on initial mount
  useEffect(() => {
    loadProjects();
  }, []);

  // When project changes, fetch amend orders
  useEffect(() => {
    loadOrders(selectedProjectId);
  }, [selectedProjectId]);

  const loadProjects = async () => {
    try {
      const res = await projectService.list();
      const list = res.data?.data || res.data || [];
      const arrayList = Array.isArray(list) ? list : [];
      setProjects(arrayList);
    } catch (error) {
      console.error('Failed to load projects:', error);
      toast({
        title: 'Error',
        description: 'Failed to load projects list.',
        type: 'error',
      });
    }
  };

  const loadOrders = async (projectId: number | 'all', isSilent = false) => {
    if (!isSilent) setLoading(true);
    else setRefreshing(true);

    try {
      const res =
        projectId === 'all'
          ? await amendService.getAllOrders()
          : await amendService.getOrders(projectId);

      if (res.data) {
        setOrders(res.data.data || []);
        if (res.data.counts) {
          setCounts(res.data.counts);
        }
      }
    } catch (error) {
      console.error('Failed to load amend orders:', error);
      toast({
        title: 'Error',
        description: 'Failed to load amend orders.',
        type: 'error',
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Explicit sync from client portal
  const handleFetchClientPortal = async () => {
    let syncProjectId: number | null = null;
    if (selectedProjectId !== 'all') {
      syncProjectId = selectedProjectId;
    } else {
      // Find default floorplan project (e.g., project 15 or first project)
      const p15 = projects.find((p) => p.id === 15);
      syncProjectId = p15 ? p15.id : projects[0]?.id || 15;
    }

    if (!syncProjectId) {
      toast({
        title: 'Project required',
        description: 'Please select a project to sync with client portal.',
        type: 'error',
      });
      return;
    }

    setFetchingPortal(true);
    try {
      const res = await amendService.syncFromPortal(syncProjectId);
      toast({
        title: 'Synced successfully',
        description: res.data?.message || 'Amend orders updated from client portal.',
        type: 'success',
      });
      loadOrders(selectedProjectId, true);
    } catch (error: any) {
      console.error('Portal sync error:', error);
      toast({
        title: 'Sync failed',
        description: error.response?.data?.message || 'Failed to fetch amends from client portal.',
        type: 'error',
      });
    } finally {
      setFetchingPortal(false);
    }
  };

  // Open Amender "Mark as Done" Modal
  const openAmenderDoneModal = (order: AmendOrder) => {
    setOrderForAmenderDone(order);
    let existingChecklist = {
      dimensions_verified: true,
      text_and_labels_corrected: true,
      symbols_and_doors_checked: true,
      client_notes_addressed: true,
      visual_quality_cleared: true,
    };
    let existingContent = '';
    let category: AmendCategoryType = (order.amend_category as AmendCategoryType) || 'Request';

    if (order.points_data) {
      try {
        const parsed = typeof order.points_data === 'string' ? JSON.parse(order.points_data) : order.points_data;
        if (parsed.amender_checklist) {
          existingChecklist = { ...existingChecklist, ...parsed.amender_checklist };
        }
        if (parsed.amender_content) {
          existingContent = parsed.amender_content;
        }
        if (parsed.amend_category) {
          category = parsed.amend_category;
        }
      } catch (e) {
        // ignore parse error
      }
    }

    setSelectedCategory(category);
    setAmenderChecklist(existingChecklist);
    setAmenderNotesContent(existingContent);
    setAmenderDoneModalOpen(true);
  };

  // Submit Amender Done
  const handleAmenderDoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderForAmenderDone) return;

    const targetProjectId =
      orderForAmenderDone.project_id || (selectedProjectId !== 'all' ? selectedProjectId : 15);

    setSubmittingDone(true);
    try {
      const pointsPayload = {
        amend_category: selectedCategory,
        amender_checklist: amenderChecklist,
        amender_content: amenderNotesContent,
        completed_by_amender: user?.name,
        amender_role: user?.role,
        completed_at: new Date().toISOString(),
      };

      await amendService.amenderDone(targetProjectId, orderForAmenderDone.order_id, {
        amend_category: selectedCategory,
        points_data: pointsPayload,
        notes: amenderNotesContent,
      });

      toast({
        title: 'Marked as Done',
        description: `Order #${orderForAmenderDone.order_id} marked as Done (${selectedCategory}). Sent to Direct Amender review.`,
        type: 'success',
      });
      setAmenderDoneModalOpen(false);
      loadOrders(selectedProjectId, true);
    } catch (error: any) {
      console.error('Failed to mark amend as done:', error);
      toast({
        title: 'Action failed',
        description: error.response?.data?.message || 'Failed to update order status.',
        type: 'error',
      });
    } finally {
      setSubmittingDone(false);
    }
  };

  // Open Direct Amender Deliver Modal
  const openDeliverModal = (order: AmendOrder) => {
    setOrderForDeliver(order);
    let existingReview = '';
    let existingChecklist = {
      dimensions_verified: true,
      text_and_labels_corrected: true,
      symbols_and_doors_checked: true,
      client_notes_addressed: true,
      visual_quality_cleared: true,
    };
    let category: AmendCategoryType = (order.amend_category as AmendCategoryType) || 'Request';

    if (order.points_data) {
      try {
        const parsed = typeof order.points_data === 'string' ? JSON.parse(order.points_data) : order.points_data;
        if (parsed.direct_checklist || parsed.checklist) {
          existingChecklist = { ...existingChecklist, ...(parsed.direct_checklist || parsed.checklist) };
        }
        if (parsed.reviewer_comments) {
          existingReview = parsed.reviewer_comments;
        }
        if (parsed.amend_category) {
          category = parsed.amend_category;
        }
      } catch (e) {
        // ignore parse error
      }
    }

    setSelectedCategory(category);
    setDeliverChecklist(existingChecklist);
    setReviewerComments(existingReview);
    setDeliverModalOpen(true);
  };

  // Submit Direct Amender Deliver
  const handleDeliverSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderForDeliver) return;

    const targetProjectId =
      orderForDeliver.project_id || (selectedProjectId !== 'all' ? selectedProjectId : 15);

    setSubmittingDeliver(true);
    try {
      let existingParsed: any = {};
      if (orderForDeliver.points_data) {
        try {
          existingParsed = typeof orderForDeliver.points_data === 'string'
            ? JSON.parse(orderForDeliver.points_data)
            : orderForDeliver.points_data;
        } catch (e) {}
      }

      const pointsPayload = {
        ...existingParsed,
        amend_category: selectedCategory,
        direct_checklist: deliverChecklist,
        reviewer_comments: reviewerComments,
        delivered_by: user?.name,
        delivered_by_role: user?.role,
        delivered_at: new Date().toISOString(),
      };

      await amendService.deliver(targetProjectId, orderForDeliver.order_id, {
        amend_category: selectedCategory,
        points_data: pointsPayload,
        uploader_name: user?.name,
      });

      toast({
        title: 'Order Delivered',
        description: `Order #${orderForDeliver.order_id} verified (${selectedCategory}) and marked Delivered.`,
        type: 'success',
      });
      setDeliverModalOpen(false);
      loadOrders(selectedProjectId, true);
    } catch (error: any) {
      console.error('Failed to deliver amend:', error);
      toast({
        title: 'Delivery failed',
        description: error.response?.data?.message || 'Failed to deliver order.',
        type: 'error',
      });
    } finally {
      setSubmittingDeliver(false);
    }
  };

  // Status Filter Tabs
  const statusButtons = useMemo(
    () => [
      { key: 'all', label: 'All Amends', count: counts.total },
      { key: 'pending', label: 'Pending', count: counts.pending },
      { key: 'in_progress', label: 'In Progress', count: counts.in_progress },
      { key: 'amender_done', label: 'Amender Done', count: counts.amender_done },
      { key: 'delivered', label: 'Delivered', count: counts.delivered },
    ],
    [counts]
  );

  // Filtered Orders
  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      // Status filter
      if (statusFilter !== 'all') {
        if (statusFilter === 'pending' && order.amend_status !== 'pending') return false;
        if (statusFilter === 'in_progress' && order.amend_status !== 'in_progress') return false;
        if (statusFilter === 'amender_done' && order.amend_status !== 'amender_done') return false;
        if (statusFilter === 'delivered' && order.amend_status !== 'delivered') return false;
      }

      // Category filter
      if (categoryFilter !== 'all') {
        if (order.amend_category !== categoryFilter) return false;
      }

      // Date filter
      if (startDate || endDate) {
        const orderDateStr = order.amend_created_at || order.received_at;
        if (orderDateStr) {
          const dateOnly = orderDateStr.slice(0, 10);
          if (startDate && dateOnly < startDate) return false;
          if (endDate && dateOnly > endDate) return false;
        }
      }

      // Search query
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        const matchId = String(order.order_id).toLowerCase().includes(q);
        const matchOrderNum = (order.order_number || '').toLowerCase().includes(q);
        const matchAddress = (order.address || '').toLowerCase().includes(q);
        const matchClient = (order.client_name || '').toLowerCase().includes(q);
        const matchAmender = (order.amender_name || '').toLowerCase().includes(q);
        const matchDirect = (order.direct_amender_name || '').toLowerCase().includes(q);
        const matchUploader = (order.uploader_name || '').toLowerCase().includes(q);
        const matchPlan = (order.plan_type || '').toLowerCase().includes(q);
        const matchNotes = (order.amend_notes || '').toLowerCase().includes(q);
        const matchCat = (order.amend_category || '').toLowerCase().includes(q);
        const matchProj = (order.project_name || '').toLowerCase().includes(q);

        return (
          matchId ||
          matchOrderNum ||
          matchAddress ||
          matchClient ||
          matchAmender ||
          matchDirect ||
          matchUploader ||
          matchPlan ||
          matchNotes ||
          matchCat ||
          matchProj
        );
      }

      return true;
    });
  }, [orders, statusFilter, categoryFilter, searchQuery, startDate, endDate]);

  return (
    <AnimatedPage>
      <div className="p-4 space-y-3 min-w-0">
        {/* Header Row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200/80 shadow-sm">
          <div>
            <div className="flex items-center gap-2">
              <div className="p-2 bg-brand-50 text-brand-600 rounded-lg">
                <Layers className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
                  Amend Orders Hub
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-200">
                    {selectedProjectId === 'all' ? 'All Projects (Multi-Project)' : (selectedProjectData?.name || 'Project View')}
                  </span>
                </h1>
                <p className="text-xs text-slate-500">
                  Amender can work across all projects &bull; Direct Amender verifies &bull; Classifications: Team Mistake | Request | Amender Mistake
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right hidden md:block">
              <ClockDisplay timezone={projectTz} className="text-xs font-semibold text-slate-700 font-mono" />
            </div>

            <Button
              variant="secondary"
              icon={RefreshCw}
              onClick={() => loadOrders(selectedProjectId, true)}
              disabled={refreshing || loading}
            >
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </Button>

            <Button
              variant="primary"
              icon={UploadCloud}
              onClick={handleFetchClientPortal}
              disabled={fetchingPortal || loading}
            >
              {fetchingPortal ? 'Syncing...' : 'Fetch Client Portal'}
            </Button>
          </div>
        </div>

        {/* Info Banner */}
        <div className="bg-brand-50/60 border border-brand-100 rounded-xl p-3 flex items-start gap-3">
          <Info className="w-4 h-4 text-brand-600 mt-0.5 shrink-0" />
          <p className="text-xs text-brand-800">
            <span className="font-semibold">Universal Amender Hub:</span> Amenders har project ki amends dekh aur complete kar saktay hain.
            Aap dropdown se <span className="font-bold">"All Projects (Every Project)"</span> ya koi bhi specific project select kar saktay hain.
          </p>
        </div>

        {/* Project Selector & Filter Bar */}
        <div className="flex flex-wrap items-center gap-2 bg-white p-3 rounded-xl border border-slate-200/80 shadow-sm">
          {/* Project Select */}
          <select
            value={selectedProjectId}
            onChange={(e) => {
              const val = e.target.value;
              setSelectedProjectId(val === 'all' ? 'all' : Number(val));
            }}
            className="select text-xs min-w-[220px] font-semibold text-brand-700 bg-brand-50/40 border-brand-200"
            aria-label="Select Project"
          >
            <option value="all">🌟 All Projects (Every Project Amends)</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.department || 'Floorplan'} - {p.country || 'Global'})
              </option>
            ))}
          </select>

          {/* Status Filter Tabs */}
          <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5">
            {statusButtons.map((sb) => (
              <button
                key={sb.key}
                onClick={() => setStatusFilter(sb.key)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  statusFilter === sb.key
                    ? 'bg-brand-600 text-white shadow-sm font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {sb.label} <span className="opacity-80 font-bold">({sb.count})</span>
              </button>
            ))}
          </div>

          {/* Category Filter */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="select text-xs min-w-[140px]"
            aria-label="Filter by Category"
          >
            <option value="all">All Categories</option>
            <option value="Team Mistake">Team Mistake</option>
            <option value="Request">Request</option>
            <option value="Amender Mistake">Amender Mistake</option>
          </select>

          {/* Search Box */}
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search order, address, client, amender..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input pl-8 text-xs h-8"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Date Filters */}
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="input text-xs h-8 w-36"
            title="Start Date"
          />

          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="input text-xs h-8 w-36"
            title="End Date"
          />

          {(startDate || endDate || searchQuery || statusFilter !== 'all' || categoryFilter !== 'all') && (
            <button
              onClick={() => {
                setStartDate('');
                setEndDate('');
                setSearchQuery('');
                setStatusFilter('all');
                setCategoryFilter('all');
              }}
              className="text-xs text-brand-600 hover:underline font-medium px-2 py-1"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Orders Table */}
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50/90 text-slate-600 border-b border-slate-200 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-3.5"># Order Number</th>
                  <th className="py-3 px-3.5">Project & Client</th>
                  <th className="py-3 px-3.5">Address & Plan</th>
                  <th className="py-3 px-3.5">Classification</th>
                  <th className="py-3 px-3.5">Amend Notes</th>
                  <th className="py-3 px-3.5">Amender (Stage 1)</th>
                  <th className="py-3 px-3.5">Direct Amender / Uploader</th>
                  <th className="py-3 px-3.5 text-center">Quality Points (JSON)</th>
                  <th className="py-3 px-3.5">Status</th>
                  <th className="py-3 px-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-slate-400">
                      <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-brand-600" />
                      <span>Loading amend orders...</span>
                    </td>
                  </tr>
                ) : filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-slate-400">
                      <AlertCircle className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                      <p className="text-sm font-medium text-slate-600">No amend orders found</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Click "Fetch Client Portal" to sync new amendments from external supplier.
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredOrders.map((order) => {
                    const isDone = order.amend_status === 'amender_done';
                    const isDelivered = order.amend_status === 'delivered';

                    return (
                      <tr
                        key={`${order.project_id || 'p'}-${order.order_id}`}
                        className="hover:bg-slate-50/80 transition-colors duration-150"
                      >
                        {/* Order Number */}
                        <td className="py-2.5 px-3.5 font-bold text-slate-900 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span className="text-brand-700 font-mono">#{order.order_id}</span>
                            {order.order_number && (
                              <span className="text-[11px] font-normal text-slate-500">
                                ({order.order_number})
                              </span>
                            )}
                          </div>
                          {order.received_at && (
                            <div className="text-[10px] text-slate-400 font-normal mt-0.5 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              <span>{order.received_at}</span>
                            </div>
                          )}
                        </td>

                        {/* Project & Client */}
                        <td className="py-2.5 px-3.5 max-w-xs">
                          {order.project_name && (
                            <div className="mb-0.5">
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 text-[10px] font-bold border border-slate-200">
                                <Building className="w-3 h-3 text-slate-500" />
                                <span>{order.project_name}</span>
                              </span>
                            </div>
                          )}
                          <div className="font-semibold text-slate-800 truncate" title={order.client_name || ''}>
                            {order.client_name || 'N/A'}
                          </div>
                        </td>

                        {/* Address & Plan */}
                        <td className="py-2.5 px-3.5 max-w-xs">
                          <div
                            className="text-[11px] text-slate-700 font-medium truncate"
                            title={order.address || ''}
                          >
                            {order.address || 'No Address'}
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1.5">
                            <span>{order.plan_type || '-'}</span>
                            {order.priority && order.priority !== 'regular' && (
                              <span className="px-1 py-0.2 rounded text-[9px] font-bold uppercase bg-amber-50 text-amber-700 border border-amber-200">
                                {order.priority}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Classification (Team Mistake, Request, Amender Mistake) */}
                        <td className="py-2.5 px-3.5 whitespace-nowrap">
                          {order.amend_category ? (
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                                order.amend_category === 'Team Mistake'
                                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                                  : order.amend_category === 'Amender Mistake'
                                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                                  : 'bg-blue-50 text-blue-700 border-blue-200'
                              }`}
                            >
                              {order.amend_category}
                            </span>
                          ) : (
                            <span className="text-slate-400 italic text-[11px]">-</span>
                          )}
                        </td>

                        {/* Amend Notes */}
                        <td className="py-2.5 px-3.5 max-w-xs">
                          {order.amend_notes ? (
                            <div
                              onClick={() => {
                                setOrderForNotes(order);
                                setNotesModalOpen(true);
                              }}
                              className="cursor-pointer group/note bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded p-1.5 transition-all"
                            >
                              <p className="text-[11px] text-slate-700 line-clamp-2 italic">
                                "{order.amend_notes}"
                              </p>
                              <span className="text-[10px] text-brand-600 group-hover/note:underline flex items-center gap-1 mt-1 font-semibold">
                                <Eye className="w-3 h-3" /> View full note
                              </span>
                            </div>
                          ) : (
                            <span className="text-slate-400 italic text-[11px]">-</span>
                          )}
                        </td>

                        {/* Amender (Stage 1) */}
                        <td className="py-2.5 px-3.5">
                          {order.amender_name ? (
                            <div>
                              <div className="font-semibold text-slate-800 flex items-center gap-1">
                                <User className="w-3.5 h-3.5 text-brand-600" />
                                <span>{order.amender_name}</span>
                              </div>
                              {order.amender_done_at && (
                                <div className="text-[10px] text-emerald-600 font-medium flex items-center gap-0.5 mt-0.5">
                                  <CheckCircle className="w-3 h-3" /> Done: {order.amender_done_at.slice(11, 16)}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400 font-normal italic">Self-Service</span>
                          )}
                        </td>

                        {/* Direct Amender / Uploader (Stage 2) */}
                        <td className="py-2.5 px-3.5 space-y-0.5">
                          {order.direct_amender_name && (
                            <div className="text-indigo-700 font-medium flex items-center gap-1">
                              <ShieldCheck className="w-3.5 h-3.5 text-indigo-500" />
                              <span>Direct: {order.direct_amender_name}</span>
                            </div>
                          )}
                          {order.uploader_name && (
                            <div className="text-emerald-700 font-medium flex items-center gap-1">
                              <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                              <span>Uploader: {order.uploader_name}</span>
                            </div>
                          )}
                          {!order.direct_amender_name && !order.uploader_name && (
                            <span className="text-slate-400 italic">-</span>
                          )}
                        </td>

                        {/* Quality Points (JSON) */}
                        <td className="py-2.5 px-3.5 text-center">
                          {order.points_data ? (
                            <button
                              onClick={() => {
                                setOrderForPoints(order);
                                setPointsModalOpen(true);
                              }}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-[11px] font-semibold transition-all"
                              title="View saved quality points JSON"
                            >
                              <Sparkles className="w-3 h-3 text-indigo-500" />
                              <span>Points Saved</span>
                            </button>
                          ) : (
                            <span className="text-slate-300">-</span>
                          )}
                        </td>

                        {/* Status Badge */}
                        <td className="py-2.5 px-3.5">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                              order.amend_status === 'delivered'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : order.amend_status === 'amender_done'
                                ? 'bg-purple-50 text-purple-700 border-purple-200'
                                : order.amend_status === 'in_progress'
                                ? 'bg-blue-50 text-blue-700 border-blue-200'
                                : 'bg-amber-50 text-amber-700 border-amber-200'
                            }`}
                          >
                            {order.amend_status === 'amender_done'
                              ? 'Amender Done'
                              : order.amend_status === 'in_progress'
                              ? 'In Progress'
                              : order.amend_status.charAt(0).toUpperCase() + order.amend_status.slice(1)}
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Amender Mark as Done Button */}
                            {(isPrimaryAmender || isManagerOrDirector) && !isDone && !isDelivered && (
                              <button
                                onClick={() => openAmenderDoneModal(order)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-semibold shadow-sm transition-all active:scale-95"
                                title="Amender: Complete and add review points"
                              >
                                <CheckSquare className="w-3.5 h-3.5" />
                                <span>Mark Done</span>
                              </button>
                            )}

                            {/* Direct Amender Deliver Button */}
                            {(isDirectAmender || isManagerOrDirector) && !isDelivered && (
                              <button
                                onClick={() => openDeliverModal(order)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-semibold shadow-sm transition-all active:scale-95"
                                title="Direct Amender: Check checklist and Deliver"
                              >
                                <Send className="w-3.5 h-3.5" />
                                <span>Check & Deliver</span>
                              </button>
                            )}

                            {isDelivered && (
                              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 font-bold px-2 py-0.5 bg-emerald-50 rounded border border-emerald-200">
                                <CheckCircle className="w-3.5 h-3.5" /> Delivered
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* MODAL 1: Amender Mark Done & Add Points */}
        <Modal
          open={amenderDoneModalOpen}
          onClose={() => setAmenderDoneModalOpen(false)}
          title={`Amender Completion - Order #${orderForAmenderDone?.order_id} (${orderForAmenderDone?.project_name || 'Project'})`}
        >
          {orderForAmenderDone && (
            <form onSubmit={handleAmenderDoneSubmit} className="space-y-4 text-xs">
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1">
                {orderForAmenderDone.project_name && (
                  <div className="text-slate-700">
                    <span className="font-semibold text-slate-900">Project:</span>{' '}
                    <span className="font-bold text-brand-700">{orderForAmenderDone.project_name}</span>
                  </div>
                )}
                <div className="text-slate-700">
                  <span className="font-semibold text-slate-900">Client:</span> {orderForAmenderDone.client_name || 'N/A'}
                </div>
                <div className="text-slate-700">
                  <span className="font-semibold text-slate-900">Property:</span> {orderForAmenderDone.address || 'N/A'}
                </div>
                {orderForAmenderDone.amend_notes && (
                  <div className="mt-2 text-amber-800 bg-amber-50 p-2 rounded border border-amber-200">
                    <span className="font-bold">Client Amend Notes:</span> {orderForAmenderDone.amend_notes}
                  </div>
                )}
              </div>

              {/* THREE POINTS / CATEGORY SELECTION */}
              <div className="space-y-2 bg-slate-50 p-3.5 rounded-lg border border-slate-200">
                <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px] block">
                  Select Amend Category (Required for Submission):
                </span>

                <div className="grid grid-cols-3 gap-2">
                  {/* Team Mistake */}
                  <label
                    onClick={() => setSelectedCategory('Team Mistake')}
                    className={`flex flex-col items-center justify-center p-2.5 rounded-lg border cursor-pointer transition-all ${
                      selectedCategory === 'Team Mistake'
                        ? 'bg-rose-50 border-rose-400 ring-2 ring-rose-400/30 text-rose-800 font-bold'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={`w-3 h-3 rounded-full ${selectedCategory === 'Team Mistake' ? 'bg-rose-500' : 'border border-slate-300'}`} />
                      <span className="text-xs">Team Mistake</span>
                    </div>
                  </label>

                  {/* Request */}
                  <label
                    onClick={() => setSelectedCategory('Request')}
                    className={`flex flex-col items-center justify-center p-2.5 rounded-lg border cursor-pointer transition-all ${
                      selectedCategory === 'Request'
                        ? 'bg-blue-50 border-blue-400 ring-2 ring-blue-400/30 text-blue-800 font-bold'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={`w-3 h-3 rounded-full ${selectedCategory === 'Request' ? 'bg-blue-500' : 'border border-slate-300'}`} />
                      <span className="text-xs">Request</span>
                    </div>
                  </label>

                  {/* Amender Mistake */}
                  <label
                    onClick={() => setSelectedCategory('Amender Mistake')}
                    className={`flex flex-col items-center justify-center p-2.5 rounded-lg border cursor-pointer transition-all ${
                      selectedCategory === 'Amender Mistake'
                        ? 'bg-amber-50 border-amber-400 ring-2 ring-amber-400/30 text-amber-800 font-bold'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={`w-3 h-3 rounded-full ${selectedCategory === 'Amender Mistake' ? 'bg-amber-500' : 'border border-slate-300'}`} />
                      <span className="text-xs">Amender Mistake</span>
                    </div>
                  </label>
                </div>
              </div>

              {/* Checklist points */}
              <div className="space-y-2 bg-slate-50 p-3.5 rounded-lg border border-slate-200">
                <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px] block">
                  Amender Verification Checklist (Saved in JSON)
                </span>

                <label className="flex items-center gap-2.5 cursor-pointer text-slate-700 hover:text-slate-900">
                  <input
                    type="checkbox"
                    checked={amenderChecklist.dimensions_verified}
                    onChange={(e) =>
                      setAmenderChecklist({ ...amenderChecklist, dimensions_verified: e.target.checked })
                    }
                    className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 w-4 h-4"
                  />
                  <span>All room dimensions & measurements fixed and verified</span>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer text-slate-700 hover:text-slate-900">
                  <input
                    type="checkbox"
                    checked={amenderChecklist.text_and_labels_corrected}
                    onChange={(e) =>
                      setAmenderChecklist({ ...amenderChecklist, text_and_labels_corrected: e.target.checked })
                    }
                    className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 w-4 h-4"
                  />
                  <span>Room labels, text, and annotations corrected</span>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer text-slate-700 hover:text-slate-900">
                  <input
                    type="checkbox"
                    checked={amenderChecklist.symbols_and_doors_checked}
                    onChange={(e) =>
                      setAmenderChecklist({ ...amenderChecklist, symbols_and_doors_checked: e.target.checked })
                    }
                    className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 w-4 h-4"
                  />
                  <span>Doors, windows, orientation, and symbols confirmed</span>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer text-slate-700 hover:text-slate-900">
                  <input
                    type="checkbox"
                    checked={amenderChecklist.client_notes_addressed}
                    onChange={(e) =>
                      setAmenderChecklist({ ...amenderChecklist, client_notes_addressed: e.target.checked })
                    }
                    className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 w-4 h-4"
                  />
                  <span>Every point mentioned by the client resolved completely</span>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer text-slate-700 hover:text-slate-900">
                  <input
                    type="checkbox"
                    checked={amenderChecklist.visual_quality_cleared}
                    onChange={(e) =>
                      setAmenderChecklist({ ...amenderChecklist, visual_quality_cleared: e.target.checked })
                    }
                    className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 w-4 h-4"
                  />
                  <span>Visual presentation & template style cleared</span>
                </label>
              </div>

              {/* Amender Content & Notes */}
              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Amender Notes / Remarks (Saved in JSON & CSV Export):
                </label>
                <textarea
                  rows={3}
                  value={amenderNotesContent}
                  onChange={(e) => setAmenderNotesContent(e.target.value)}
                  placeholder="Enter details of changes made for the reviewer..."
                  className="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                <span className="text-[11px] text-slate-500">
                  Logged in as: <span className="font-semibold text-slate-800">{user?.name}</span>
                </span>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setAmenderDoneModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button variant="primary" type="submit" disabled={submittingDone}>
                    {submittingDone ? 'Saving...' : 'Confirm Mark Done'}
                  </Button>
                </div>
              </div>
            </form>
          )}
        </Modal>

        {/* MODAL 2: Direct Amender / Manager Check & Deliver */}
        <Modal
          open={deliverModalOpen}
          onClose={() => setDeliverModalOpen(false)}
          title={`Check & Deliver Amend - Order #${orderForDeliver?.order_id} (${orderForDeliver?.project_name || 'Project'})`}
        >
          {orderForDeliver && (
            <form onSubmit={handleDeliverSubmit} className="space-y-4 text-xs">
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1">
                {orderForDeliver.project_name && (
                  <div className="text-slate-700">
                    <span className="font-semibold text-slate-900">Project:</span>{' '}
                    <span className="font-bold text-brand-700">{orderForDeliver.project_name}</span>
                  </div>
                )}
                <div className="text-slate-700">
                  <span className="font-semibold text-slate-900">Amender:</span>{' '}
                  <span className="font-bold text-brand-700">{orderForDeliver.amender_name || user?.name}</span>
                </div>
                <div className="text-slate-700">
                  <span className="font-semibold text-slate-900">Property:</span> {orderForDeliver.address || 'N/A'}
                </div>
                {orderForDeliver.amend_notes && (
                  <div className="mt-2 text-amber-800 bg-amber-50 p-2 rounded border border-amber-200">
                    <span className="font-bold">Client Notes:</span> {orderForDeliver.amend_notes}
                  </div>
                )}
              </div>

              {/* THREE POINTS / CATEGORY CONFIRMATION */}
              <div className="space-y-2 bg-slate-50 p-3.5 rounded-lg border border-slate-200">
                <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px] block">
                  Verify Amend Category:
                </span>

                <div className="grid grid-cols-3 gap-2">
                  {/* Team Mistake */}
                  <label
                    onClick={() => setSelectedCategory('Team Mistake')}
                    className={`flex flex-col items-center justify-center p-2.5 rounded-lg border cursor-pointer transition-all ${
                      selectedCategory === 'Team Mistake'
                        ? 'bg-rose-50 border-rose-400 ring-2 ring-rose-400/30 text-rose-800 font-bold'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={`w-3 h-3 rounded-full ${selectedCategory === 'Team Mistake' ? 'bg-rose-500' : 'border border-slate-300'}`} />
                      <span className="text-xs">Team Mistake</span>
                    </div>
                  </label>

                  {/* Request */}
                  <label
                    onClick={() => setSelectedCategory('Request')}
                    className={`flex flex-col items-center justify-center p-2.5 rounded-lg border cursor-pointer transition-all ${
                      selectedCategory === 'Request'
                        ? 'bg-blue-50 border-blue-400 ring-2 ring-blue-400/30 text-blue-800 font-bold'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={`w-3 h-3 rounded-full ${selectedCategory === 'Request' ? 'bg-blue-500' : 'border border-slate-300'}`} />
                      <span className="text-xs">Request</span>
                    </div>
                  </label>

                  {/* Amender Mistake */}
                  <label
                    onClick={() => setSelectedCategory('Amender Mistake')}
                    className={`flex flex-col items-center justify-center p-2.5 rounded-lg border cursor-pointer transition-all ${
                      selectedCategory === 'Amender Mistake'
                        ? 'bg-amber-50 border-amber-400 ring-2 ring-amber-400/30 text-amber-800 font-bold'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={`w-3 h-3 rounded-full ${selectedCategory === 'Amender Mistake' ? 'bg-amber-500' : 'border border-slate-300'}`} />
                      <span className="text-xs">Amender Mistake</span>
                    </div>
                  </label>
                </div>
              </div>

              {/* Direct Amender Verification Checklist */}
              <div className="space-y-2 bg-slate-50 p-3.5 rounded-lg border border-slate-200">
                <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px] block">
                  Direct Amender Quality Verification
                </span>

                <label className="flex items-center gap-2.5 cursor-pointer text-slate-700 hover:text-slate-900">
                  <input
                    type="checkbox"
                    checked={deliverChecklist.dimensions_verified}
                    onChange={(e) =>
                      setDeliverChecklist({ ...deliverChecklist, dimensions_verified: e.target.checked })
                    }
                    className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 w-4 h-4"
                  />
                  <span>Dimensions & measurements accuracy confirmed</span>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer text-slate-700 hover:text-slate-900">
                  <input
                    type="checkbox"
                    checked={deliverChecklist.text_and_labels_corrected}
                    onChange={(e) =>
                      setDeliverChecklist({ ...deliverChecklist, text_and_labels_corrected: e.target.checked })
                    }
                    className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 w-4 h-4"
                  />
                  <span>All labels and text checked</span>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer text-slate-700 hover:text-slate-900">
                  <input
                    type="checkbox"
                    checked={deliverChecklist.symbols_and_doors_checked}
                    onChange={(e) =>
                      setDeliverChecklist({ ...deliverChecklist, symbols_and_doors_checked: e.target.checked })
                    }
                    className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 w-4 h-4"
                  />
                  <span>Doors, fixtures, and symbols inspected</span>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer text-slate-700 hover:text-slate-900">
                  <input
                    type="checkbox"
                    checked={deliverChecklist.client_notes_addressed}
                    onChange={(e) =>
                      setDeliverChecklist({ ...deliverChecklist, client_notes_addressed: e.target.checked })
                    }
                    className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 w-4 h-4"
                  />
                  <span>All amend requirements verified resolved</span>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer text-slate-700 hover:text-slate-900">
                  <input
                    type="checkbox"
                    checked={deliverChecklist.visual_quality_cleared}
                    onChange={(e) =>
                      setDeliverChecklist({ ...deliverChecklist, visual_quality_cleared: e.target.checked })
                    }
                    className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 w-4 h-4"
                  />
                  <span>Final delivery output ready for client</span>
                </label>
              </div>

              {/* Reviewer Comments */}
              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Direct Amender / Uploader Remarks (Saved in JSON & CSV):
                </label>
                <textarea
                  rows={3}
                  value={reviewerComments}
                  onChange={(e) => setReviewerComments(e.target.value)}
                  placeholder="Enter any quality remarks or delivery notes..."
                  className="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                <span className="text-[11px] text-slate-500">
                  Uploader: <span className="font-semibold text-emerald-700">{user?.name}</span> ({user?.role})
                </span>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setDeliverModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button variant="primary" type="submit" disabled={submittingDeliver}>
                    {submittingDeliver ? 'Delivering...' : 'Confirm Delivery'}
                  </Button>
                </div>
              </div>
            </form>
          )}
        </Modal>

        {/* MODAL 3: View Full Notes */}
        <Modal
          open={notesModalOpen}
          onClose={() => setNotesModalOpen(false)}
          title={`Amend Notes - Order #${orderForNotes?.order_id} (${orderForNotes?.project_name || 'Project'})`}
        >
          {orderForNotes && (
            <div className="space-y-3 text-xs">
              <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg text-amber-900 whitespace-pre-wrap font-mono leading-relaxed">
                {orderForNotes.amend_notes || 'No notes available'}
              </div>
              <div className="flex justify-end">
                <Button variant="secondary" onClick={() => setNotesModalOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </Modal>

        {/* MODAL 4: View JSON Points Data */}
        <Modal
          open={pointsModalOpen}
          onClose={() => setPointsModalOpen(false)}
          title={`Saved Quality Points (JSON) - Order #${orderForPoints?.order_id} (${orderForPoints?.project_name || 'Project'})`}
        >
          {orderForPoints && (
            <div className="space-y-3 text-xs">
              {(() => {
                let parsed: any = null;
                try {
                  parsed =
                    typeof orderForPoints.points_data === 'string'
                      ? JSON.parse(orderForPoints.points_data)
                      : orderForPoints.points_data;
                } catch (e) {
                  parsed = null;
                }

                const cat = orderForPoints.amend_category || parsed?.amend_category;

                return (
                  <div className="space-y-3">
                    {/* Project & Classification Highlight */}
                    <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg border bg-slate-50">
                      {orderForPoints.project_name && (
                        <div className="flex items-center gap-1.5">
                          <Building className="w-4 h-4 text-slate-500" />
                          <span className="font-bold text-slate-800">{orderForPoints.project_name}</span>
                        </div>
                      )}
                      {cat && (
                        <span
                          className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase border ${
                            cat === 'Team Mistake'
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : cat === 'Amender Mistake'
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : 'bg-blue-50 text-blue-700 border-blue-200'
                          }`}
                        >
                          {cat}
                        </span>
                      )}
                    </div>

                    {/* Amender Checklist */}
                    {(parsed?.amender_checklist || parsed?.checklist) && (
                      <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1.5">
                        <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px] block">
                          Verified Checklist Items
                        </span>
                        {Object.entries(parsed.amender_checklist || parsed.checklist).map(([k, v]) => (
                          <div key={k} className="flex items-center gap-2 text-slate-700">
                            <span className={v ? 'text-emerald-600 font-bold' : 'text-rose-500 font-bold'}>
                              {v ? '✓' : '✗'}
                            </span>
                            <span className="capitalize">{k.replace(/_/g, ' ')}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Amender Content */}
                    {parsed?.amender_content && (
                      <div className="p-3 bg-purple-50/60 rounded-lg border border-purple-200">
                        <span className="font-bold text-purple-900 block mb-1">Amender Remarks:</span>
                        <p className="text-purple-800 italic">{parsed.amender_content}</p>
                      </div>
                    )}

                    {/* Reviewer Comments */}
                    {parsed?.reviewer_comments && (
                      <div className="p-3 bg-emerald-50/60 rounded-lg border border-emerald-200">
                        <span className="font-bold text-emerald-900 block mb-1">Direct Amender Remarks:</span>
                        <p className="text-emerald-800 italic">{parsed.reviewer_comments}</p>
                      </div>
                    )}

                    {/* Submitter & Delivery Info */}
                    <div className="p-2.5 bg-slate-100 rounded-lg text-[11px] text-slate-600 space-y-1">
                      {parsed?.completed_by_amender && (
                        <div>
                          Amender: <span className="font-semibold text-slate-800">{parsed.completed_by_amender}</span> (
                          {parsed.completed_at ? new Date(parsed.completed_at).toLocaleString() : 'N/A'})
                        </div>
                      )}
                      {parsed?.delivered_by && (
                        <div>
                          Delivered By: <span className="font-semibold text-emerald-700">{parsed.delivered_by}</span> (
                          {parsed.delivered_at ? new Date(parsed.delivered_at).toLocaleString() : 'N/A'})
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              <div className="flex justify-end">
                <Button variant="secondary" onClick={() => setPointsModalOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </Modal>
      </div>
    </AnimatedPage>
  );
}
