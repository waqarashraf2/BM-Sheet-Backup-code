// types/workflow.ts
export interface Order {
    id: number;
    name: string;
    state: string;
    assigned_to: string;
    due_date?: string;
}

export interface WorkItem {
    id: number;
    order_id: number;
    started_at: string;
    stopped_at?: string;
}

export interface Batch {
    batch_no: string;
    received_time: string;
    remaining_time: string;
    plans: number;
    done: number;
    pending: number;
    fixing: number;
}

export interface BatchSummary {
    total_batches: number;
    total_plans: number;
    total_done: number;
    total_pending: number;
    total_fixing: number;
}

export interface BatchStatusResponse {
    success: boolean;
    data: Batch[];
    summary: BatchSummary;
}