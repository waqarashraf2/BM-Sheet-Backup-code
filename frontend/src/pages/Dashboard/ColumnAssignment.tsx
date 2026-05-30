import { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  FolderKanban,
  GripVertical,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { AnimatedPage, Button, Input, PageHeader, useToast } from '../../components/ui';
import { columnService, pmService, projectService } from '../../services';
import type { ProjectColumn } from '../../types';
import type { RootState } from '../../store/store';

type ProjectOption = {
  id: number;
  name?: string;
  code?: string;
  country?: string;
  department?: string;
};

type ColumnFilter = 'all' | 'visible' | 'hidden';

type PMAssignmentUser = {
  id: number;
  managed_projects?: { id: number }[];
};

export default function ColumnAssignment() {
  const { toast } = useToast();
  const { user } = useSelector((state: RootState) => state.auth);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [columns, setColumns] = useState<ProjectColumn[]>([]);
  const [initialColumns, setInitialColumns] = useState<ProjectColumn[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<ColumnFilter>('all');
  const [showOnlyChanged, setShowOnlyChanged] = useState(false);

  const normalizeColumns = (cols: ProjectColumn[]) =>
    [...cols]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((col) => ({
        ...col,
        visible: col.visible ?? false,
        sortable: col.sortable ?? true,
        width: Number(col.width ?? 120),
      }));

  const fetchProjects = async () => {
    try {
      const res = await projectService.list();
      const allProjects = res.data.data || [];

      if (user?.role === 'project_manager' && user.id) {
        const pmRes = await pmService.list();
        const pmList = Array.isArray(pmRes.data) ? pmRes.data : [];
        const currentPm = pmList.find((pm: PMAssignmentUser) => pm.id === user.id);
        const assignedProjectIds = new Set((currentPm?.managed_projects || []).map((project: { id: number }) => project.id));
        const allowedProjects = allProjects.filter((project: ProjectOption) => assignedProjectIds.has(project.id));

        setProjects(allowedProjects);
        setSelectedProjectId((prev) => {
          if (prev && allowedProjects.some((project: ProjectOption) => project.id === prev)) return prev;
          return allowedProjects[0]?.id ?? null;
        });

        if (allowedProjects.length === 0) {
          toast({ title: 'No assigned projects', description: 'No projects are currently assigned to this PM.', type: 'error' });
        }

        return;
      }

      setProjects(allProjects);
      setSelectedProjectId((prev) => prev ?? allProjects[0]?.id ?? null);
    } catch (err) {
      console.error('Failed to load projects', err);
      toast({ title: 'Project load failed', description: 'Could not load projects.', type: 'error' });
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchColumns = async (projectId: number) => {
    try {
      setLoading(true);
      const res = await columnService.getAllColumns(projectId);

      if (res.data?.success) {
        const normalized = normalizeColumns(res.data.data || []);
        setColumns(normalized);
        setInitialColumns(normalized);
      } else {
        setColumns([]);
        setInitialColumns([]);
      }
    } catch (err) {
      console.error('Error fetching columns', err);
      setColumns([]);
      setInitialColumns([]);
      toast({ title: 'Column load failed', description: 'Could not load project columns.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedProjectId) {
      fetchColumns(selectedProjectId);
    } else {
      setColumns([]);
      setInitialColumns([]);
    }
  }, [selectedProjectId]);

  const updateColumnAt = (index: number, updater: (column: ProjectColumn) => ProjectColumn) => {
    setColumns((prev) => prev.map((col, i) => (i === index ? updater(col) : col)));
  };

  const toggleVisibility = (index: number) => {
    updateColumnAt(index, (col) => ({ ...col, visible: !col.visible }));
  };

  const toggleSortable = (index: number) => {
    updateColumnAt(index, (col) => ({ ...col, sortable: !col.sortable }));
  };

  const updateWidth = (index: number, value: number) => {
    const safeWidth = Number.isNaN(value) ? 120 : Math.max(60, value);
    updateColumnAt(index, (col) => ({ ...col, width: safeWidth }));
  };

  const updateLabel = (index: number, value: string) => {
    updateColumnAt(index, (col) => ({ ...col, label: value }));
  };

  const moveColumn = (from: number, to: number) => {
    setColumns((prev) => {
      if (to < 0 || to >= prev.length || from === to) return prev;
      const updated = [...prev];
      const [item] = updated.splice(from, 1);
      updated.splice(to, 0, item);
      return updated;
    });
  };

  const moveUp = (index: number) => moveColumn(index, index - 1);
  const moveDown = (index: number) => moveColumn(index, index + 1);

  const selectAll = () => {
    setColumns((prev) => prev.map((col) => ({ ...col, visible: true })));
  };

  const unselectAll = () => {
    setColumns((prev) => prev.map((col) => ({ ...col, visible: false })));
  };

  const setAllSortable = (sortable: boolean) => {
    setColumns((prev) => prev.map((col) => ({ ...col, sortable })));
  };

  const applyWidthPreset = (width: number) => {
    setColumns((prev) => prev.map((col) => ({ ...col, width })));
  };

  const resetChanges = () => {
    setColumns(initialColumns);
    toast({ title: 'Changes reset', description: 'Column settings were restored to the last loaded state.', type: 'success' });
  };

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

  const visibleCount = useMemo(() => columns.filter((col) => col.visible).length, [columns]);
  const sortableCount = useMemo(() => columns.filter((col) => col.sortable).length, [columns]);

  const hasUnsavedChanges = useMemo(() => {
    if (columns.length !== initialColumns.length) return true;
    return columns.some((col, index) => {
      const initial = initialColumns[index];
      return !initial ||
        col.field !== initial.field ||
        (col.label || '') !== (initial.label || '') ||
        !!col.visible !== !!initial.visible ||
        !!col.sortable !== !!initial.sortable ||
        Number(col.width ?? 120) !== Number(initial.width ?? 120) ||
        (index + 1) !== (initial.order ?? index + 1);
    });
  }, [columns, initialColumns]);

  const changedFieldSet = useMemo(() => {
    const changed = new Set<string>();

    columns.forEach((col, index) => {
      const initial = initialColumns.find((item) => item.field === col.field);
      if (!initial) {
        changed.add(col.field);
        return;
      }

      if (
        (col.label || '') !== (initial.label || '') ||
        !!col.visible !== !!initial.visible ||
        !!col.sortable !== !!initial.sortable ||
        Number(col.width ?? 120) !== Number(initial.width ?? 120) ||
        (index + 1) !== (initial.order ?? index + 1)
      ) {
        changed.add(col.field);
      }
    });

    return changed;
  }, [columns, initialColumns]);

  const filteredColumns = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return columns.filter((col) => {
      if (filterMode === 'visible' && !col.visible) return false;
      if (filterMode === 'hidden' && col.visible) return false;
      if (showOnlyChanged && !changedFieldSet.has(col.field)) return false;
      if (!query) return true;

      const haystack = `${col.label || ''} ${col.field} ${col.name}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [changedFieldSet, columns, filterMode, searchQuery, showOnlyChanged]);

  const visiblePreview = useMemo(
    () => columns.filter((col) => col.visible).slice(0, 8),
    [columns]
  );

  const handleSave = async () => {
    if (!selectedProjectId) {
      toast({ title: 'Select project', description: 'Choose a project before saving.', type: 'error' });
      return;
    }

    try {
      setSaving(true);

      const payload = columns.map((col, index) => ({
        ...col,
        project_id: selectedProjectId,
        order: index + 1,
      }));

      const res = await columnService.saveAllColumns(payload);

      if (res.data?.success) {
        toast({ title: 'Saved successfully', description: 'Column settings were updated.', type: 'success' });
        fetchColumns(selectedProjectId);
      } else {
        toast({ title: 'Save failed', description: 'Could not save column settings.', type: 'error' });
      }
    } catch (err) {
      console.error(err);
      toast({ title: 'Save failed', description: 'An error occurred while saving.', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatedPage>
      <div className="space-y-6">
        <PageHeader
          title="Column Assignment"
          subtitle="Configure project-specific visibility, ordering, sorting, and width preferences without changing your existing save and fetch logic."
          badge={
            hasUnsavedChanges ? (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
                Unsaved changes
              </span>
            ) : undefined
          }
          actions={
            <>
              <Button variant="ghost" size="sm" onClick={resetChanges} disabled={!hasUnsavedChanges || loading || saving}>
                Reset
              </Button>
              <Button onClick={handleSave} loading={saving} disabled={!selectedProjectId || loading}>
                Save Changes
              </Button>
            </>
          }
        />

        <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
          <div className="rounded-3xl border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(42,167,160,0.12),_transparent_55%),linear-gradient(180deg,_#ffffff,_#f8fafc)] p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-brand-50 p-3 text-brand-600">
                <FolderKanban className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">Project Scope</div>
                <div className="text-xs text-slate-500">Load one project at a time and tune its column profile.</div>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Select Project
                </label>
                <select
                  value={selectedProjectId || ''}
                  onChange={(e) => setSelectedProjectId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-100"
                >
                  <option value="">Choose a project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.code ? `${project.code} - ` : ''}{project.name || `Project ${project.id}`}
                    </option>
                  ))}
                </select>
              </div>

              {selectedProject ? (
                <div className="rounded-2xl border border-slate-200 bg-white/90 p-4">
                  <div className="text-sm font-semibold text-slate-900">
                    {selectedProject.code ? `${selectedProject.code} - ` : ''}{selectedProject.name || `Project ${selectedProject.id}`}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
                    {selectedProject.country && <span className="rounded-full bg-slate-100 px-2.5 py-1">{selectedProject.country}</span>}
                    {selectedProject.department && <span className="rounded-full bg-slate-100 px-2.5 py-1">{selectedProject.department}</span>}
                    <span className="rounded-full bg-brand-50 px-2.5 py-1 text-brand-700">{columns.length} columns</span>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 py-8 text-center text-sm text-slate-500">
                  Pick a project to manage its column setup.
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-slate-900 px-4 py-3 text-white">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Visible</div>
                  <div className="mt-1 text-2xl font-bold">{visibleCount}</div>
                </div>
                <div className="rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Sortable</div>
                  <div className="mt-1 text-2xl font-bold text-slate-900">{sortableCount}</div>
                </div>
              </div>

              <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-100">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
                  <Sparkles className="h-4 w-4" />
                  Advanced Tools
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="secondary" size="xs" onClick={selectAll} disabled={!columns.length || loading}>Select All</Button>
                  <Button variant="secondary" size="xs" onClick={unselectAll} disabled={!columns.length || loading}>Hide All</Button>
                  <Button variant="secondary" size="xs" onClick={() => setAllSortable(true)} disabled={!columns.length || loading}>Enable Sort</Button>
                  <Button variant="secondary" size="xs" onClick={() => setAllSortable(false)} disabled={!columns.length || loading}>Disable Sort</Button>
                  <Button variant="secondary" size="xs" onClick={() => applyWidthPreset(100)} disabled={!columns.length || loading}>Compact Width</Button>
                  <Button variant="secondary" size="xs" onClick={() => applyWidthPreset(140)} disabled={!columns.length || loading}>Comfort Width</Button>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="relative max-w-md flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by label, field, or name..."
                    className="pl-10"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {(['all', 'visible', 'hidden'] as ColumnFilter[]).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setFilterMode(mode)}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                        filterMode === mode
                          ? 'bg-brand-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {mode === 'all' ? 'All' : mode === 'visible' ? 'Visible' : 'Hidden'}
                    </button>
                  ))}

                  <button
                    onClick={() => setShowOnlyChanged((prev) => !prev)}
                    className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                      showOnlyChanged
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    Changed only
                  </button>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Visible order preview</span>
                {visiblePreview.length > 0 ? (
                  visiblePreview.map((col, index) => (
                    <span key={col.field} className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">
                      {index + 1}. {col.label || col.field}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-slate-500">No visible columns selected.</span>
                )}
                {visibleCount > visiblePreview.length && (
                  <span className="text-xs text-slate-400">+{visibleCount - visiblePreview.length} more</span>
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Column Designer</div>
                    <div className="text-xs text-slate-500">Reorder rows, tune width, and toggle display behavior.</div>
                  </div>
                  {hasUnsavedChanges && (
                    <div className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
                      {changedFieldSet.size} edited
                    </div>
                  )}
                </div>
              </div>

              {loading ? (
                <div className="px-5 py-14 text-center text-sm text-slate-500">Loading columns...</div>
              ) : !selectedProjectId ? (
                <div className="px-5 py-14 text-center text-sm text-slate-500">Select a project to begin.</div>
              ) : filteredColumns.length === 0 ? (
                <div className="px-5 py-14 text-center text-sm text-slate-500">No columns match the current filters.</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {filteredColumns.map((col) => {
                    const index = columns.findIndex((item) => item.field === col.field);
                    const isChanged = changedFieldSet.has(col.field);

                    return (
                      <div key={col.field} className="px-5 py-4 transition hover:bg-slate-50/80">
                        <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
                          <div className="flex min-w-0 flex-1 items-start gap-3">
                            <div className="mt-1 rounded-xl bg-slate-100 p-2 text-slate-400">
                              <GripVertical className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="truncate text-sm font-semibold text-slate-900">{col.label || col.field}</div>
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                                  #{index + 1}
                                </span>
                                {isChanged && (
                                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                                    Edited
                                  </span>
                                )}
                                {col.visible ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                                    <Eye className="h-3 w-3" />
                                    Visible
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                                    <EyeOff className="h-3 w-3" />
                                    Hidden
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                                <span className="rounded-full bg-slate-100 px-2.5 py-1 font-mono">{col.field}</span>
                                <span className="rounded-full bg-slate-100 px-2.5 py-1">Name: {col.name}</span>
                              </div>
                              <div className="mt-3 max-w-sm">
                                <Input
                                  label="Display Label"
                                  value={col.label || ''}
                                  onChange={(e) => updateLabel(index, e.target.value)}
                                  placeholder={col.field}
                                />
                              </div>
                            </div>
                          </div>

                          <div className="grid flex-[1.2] gap-3 sm:grid-cols-2 xl:grid-cols-[auto_auto_112px_auto] xl:items-center">
                            <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                              <span>Visible</span>
                              <input
                                type="checkbox"
                                checked={!!col.visible}
                                onChange={() => toggleVisibility(index)}
                                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-300"
                              />
                            </label>

                            <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                              <span>Sortable</span>
                              <input
                                type="checkbox"
                                checked={!!col.sortable}
                                onChange={() => toggleSortable(index)}
                                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-300"
                              />
                            </label>

                            <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Width</div>
                              <input
                                type="number"
                                min={60}
                                value={Number(col.width ?? 120)}
                                onChange={(e) => updateWidth(index, Number(e.target.value))}
                                className="w-full bg-transparent text-sm text-slate-900 outline-none"
                              />
                            </div>

                            <div className="flex items-center gap-2">
                              <Button variant="secondary" size="xs" onClick={() => moveUp(index)} disabled={index === 0}>
                                <ArrowUp className="h-4 w-4" />
                              </Button>
                              <Button variant="secondary" size="xs" onClick={() => moveDown(index)} disabled={index === columns.length - 1}>
                                <ArrowDown className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => updateColumnAt(index, (item) => ({ ...item, width: 120 }))}
                              >
                                <RotateCcw className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AnimatedPage>
  );
}
