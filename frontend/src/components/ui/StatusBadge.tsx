// StatusBadge component

interface StatusBadgeProps {
  status: string;
  size?: 'xs' | 'sm' | 'md';
  dot?: boolean;
}

const statusStyles: Record<string, { bg: string; text: string; dot: string }> = {
  // Workflow states
  RECEIVED:          { bg: 'bg-slate-100',   text: 'text-slate-700',   dot: 'bg-slate-400' },
  PENDING_QA_REVIEW: { bg: 'bg-purple-50',   text: 'text-purple-700',  dot: 'bg-purple-400' },
  QUEUED_DRAW:       { bg: 'bg-blue-50',     text: 'text-blue-700',    dot: 'bg-blue-400' },
  QUEUED_CHECK:      { bg: 'bg-blue-50',     text: 'text-blue-700',    dot: 'bg-blue-400' },
  QUEUED_FILLER:     { bg: 'bg-blue-50',     text: 'text-blue-700',    dot: 'bg-blue-400' },
  QUEUED_QA:         { bg: 'bg-blue-50',     text: 'text-blue-700',    dot: 'bg-blue-400' },
  QUEUED_DESIGN:     { bg: 'bg-blue-50',     text: 'text-blue-700',    dot: 'bg-blue-400' },
  IN_DRAW:           { bg: 'bg-amber-50',    text: 'text-amber-700',   dot: 'bg-amber-400' },
  IN_CHECK:          { bg: 'bg-amber-50',    text: 'text-amber-700',   dot: 'bg-amber-400' },
  IN_FILLER:         { bg: 'bg-amber-50',    text: 'text-amber-700',   dot: 'bg-amber-400' },
  IN_QA:             { bg: 'bg-amber-50',    text: 'text-amber-700',   dot: 'bg-amber-400' },
  IN_DESIGN:         { bg: 'bg-amber-50',    text: 'text-amber-700',   dot: 'bg-amber-400' },
  SUBMITTED_DRAW:    { bg: 'bg-cyan-50',     text: 'text-cyan-700',    dot: 'bg-cyan-400' },
  SUBMITTED_CHECK:   { bg: 'bg-cyan-50',     text: 'text-cyan-700',    dot: 'bg-cyan-400' },
  SUBMITTED_FILLER:  { bg: 'bg-cyan-50',     text: 'text-cyan-700',    dot: 'bg-cyan-400' },
  SUBMITTED_DESIGN:  { bg: 'bg-cyan-50',     text: 'text-cyan-700',    dot: 'bg-cyan-400' },
  REJECTED_BY_CHECK: { bg: 'bg-rose-50',     text: 'text-rose-700',    dot: 'bg-rose-400' },
  REJECTED_BY_QA:    { bg: 'bg-rose-50',     text: 'text-rose-700',    dot: 'bg-rose-400' },
  APPROVED_QA:       { bg: 'bg-brand-50',  text: 'text-brand-700', dot: 'bg-brand-400' },
  DELIVERED:         { bg: 'bg-brand-50',  text: 'text-brand-700', dot: 'bg-brand-500' },
  ON_HOLD:           { bg: 'bg-orange-50',   text: 'text-orange-700',  dot: 'bg-orange-400' },
  CANCELLED:         { bg: 'bg-slate-100',   text: 'text-slate-500',   dot: 'bg-slate-400' },
  // Invoice statuses
  draft:             { bg: 'bg-slate-100',   text: 'text-slate-700',   dot: 'bg-slate-400' },
  prepared:          { bg: 'bg-blue-50',     text: 'text-blue-700',    dot: 'bg-blue-400' },
  approved:          { bg: 'bg-brand-50',  text: 'text-brand-700', dot: 'bg-brand-400' },
  issued:            { bg: 'bg-brand-50',   text: 'text-brand-700',  dot: 'bg-brand-400' },
  sent:              { bg: 'bg-brand-50',     text: 'text-brand-700',    dot: 'bg-brand-500' },
  filler:            { bg: 'bg-sky-50',      text: 'text-sky-700',     dot: 'bg-sky-400' },
  // Generic
  active:            { bg: 'bg-brand-50',  text: 'text-brand-700', dot: 'bg-brand-500' },
  inactive:          { bg: 'bg-slate-100',   text: 'text-slate-500',   dot: 'bg-slate-400' },
  completed:         { bg: 'bg-brand-50',  text: 'text-brand-700', dot: 'bg-brand-500' },
  pending:           { bg: 'bg-amber-50',    text: 'text-amber-700',   dot: 'bg-amber-400' },
  high:              { bg: 'bg-rose-50',     text: 'text-rose-700',    dot: 'bg-rose-500' },
  medium:            { bg: 'bg-amber-50',    text: 'text-amber-700',   dot: 'bg-amber-400' },
  low:               { bg: 'bg-slate-100',   text: 'text-slate-600',   dot: 'bg-slate-400' },
  urgent:            { bg: 'bg-red-50',      text: 'text-red-700',     dot: 'bg-red-500' },
};

const defaultStyle = { bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-400' };

const sizeClasses = {
  xs: 'text-[11px] px-1.5 py-0.5',
  sm: 'text-xs px-2 py-0.5',
  md: 'text-xs px-2.5 py-1',
};

function formatLabel(status: string): string {
  return status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

export default function StatusBadge({ status, size = 'sm', dot = true }: StatusBadgeProps) {
  const st = statusStyles[status] || defaultStyle;

  return (
    <span className={`inline-flex items-center gap-1.5 font-medium rounded-full ${st.bg} ${st.text} ${sizeClasses[size]}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />}
      {formatLabel(status)}
    </span>
  );
}
